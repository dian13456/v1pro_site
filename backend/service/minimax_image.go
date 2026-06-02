package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	defaultMiniMaxBaseURL = "https://api.minimaxi.com"
	defaultMiniMaxModel   = "image-01"
	maxAIImagePromptRunes = 1500
	maxAIImageCount       = 4
)

var allowedAspectRatios = map[string]struct{}{
	"1:1":  {},
	"16:9": {},
	"4:3":  {},
	"3:2":  {},
	"2:3":  {},
	"3:4":  {},
	"9:16": {},
	"21:9": {},
}

type MiniMaxClient struct {
	APIKey  string
	Model   string
	BaseURL string
	GroupID string
	HTTP    *http.Client
}

type AIImageResult struct {
	Images []string `json:"images"`
}

type miniMaxImageRequest struct {
	Model          string `json:"model"`
	Prompt         string `json:"prompt"`
	AspectRatio    string `json:"aspect_ratio"`
	ResponseFormat string `json:"response_format"`
	N              int    `json:"n,omitempty"`
}

type miniMaxImageResponse struct {
	Data struct {
		ImageBase64 []string `json:"image_base64"`
		ImageURLs   []string `json:"image_urls"`
	} `json:"data"`
	BaseResp struct {
		StatusCode int    `json:"status_code"`
		StatusMsg  string `json:"status_msg"`
	} `json:"base_resp"`
}

func NewMiniMaxClient(apiKey, model, baseURL, groupID string) *MiniMaxClient {
	model = strings.TrimSpace(model)
	if model == "" {
		model = defaultMiniMaxModel
	}
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		baseURL = defaultMiniMaxBaseURL
	}
	return &MiniMaxClient{
		APIKey:  strings.TrimSpace(apiKey),
		Model:   model,
		BaseURL: strings.TrimRight(baseURL, "/"),
		GroupID: strings.TrimSpace(groupID),
		HTTP: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

func NormalizeAIImagePrompt(prompt string) (string, error) {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return "", fmt.Errorf("prompt 不能为空")
	}
	if len([]rune(prompt)) > maxAIImagePromptRunes {
		return "", fmt.Errorf("prompt 最多 %d 字", maxAIImagePromptRunes)
	}
	return prompt, nil
}

func NormalizeAspectRatio(raw string) string {
	raw = strings.TrimSpace(raw)
	if _, ok := allowedAspectRatios[raw]; ok {
		return raw
	}
	return "9:16"
}

func NormalizeImageCount(raw int) int {
	if raw <= 0 {
		return 1
	}
	if raw > maxAIImageCount {
		return maxAIImageCount
	}
	return raw
}

func (client *MiniMaxClient) GenerateImages(ctx context.Context, prompt, aspectRatio string, count int) (*AIImageResult, error) {
	if client == nil || client.APIKey == "" {
		return nil, fmt.Errorf("MiniMax API 未配置")
	}

	normalizedPrompt, err := NormalizeAIImagePrompt(prompt)
	if err != nil {
		return nil, err
	}
	aspectRatio = NormalizeAspectRatio(aspectRatio)
	count = NormalizeImageCount(count)

	payload := miniMaxImageRequest{
		Model:          client.Model,
		Prompt:         normalizedPrompt,
		AspectRatio:    aspectRatio,
		ResponseFormat: "base64",
	}
	if count > 1 {
		payload.N = count
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("encode minimax request failed: %w", err)
	}

	endpoint := client.BaseURL + "/v1/image_generation"
	if client.GroupID != "" {
		endpoint = endpoint + "?" + url.Values{"GroupId": {client.GroupID}}.Encode()
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create minimax request failed: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+client.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("minimax request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read minimax response failed: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("minimax HTTP %d: %s", resp.StatusCode, truncateForError(string(raw)))
	}

	var parsed miniMaxImageResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("decode minimax response failed: %w", err)
	}
	if parsed.BaseResp.StatusCode != 0 {
		msg := strings.TrimSpace(parsed.BaseResp.StatusMsg)
		if msg == "" {
			msg = fmt.Sprintf("MiniMax 错误码 %d", parsed.BaseResp.StatusCode)
		}
		return nil, fmt.Errorf("%s", msg)
	}

	images := parsed.Data.ImageBase64
	if len(images) == 0 && len(parsed.Data.ImageURLs) > 0 {
		images, err = fetchRemoteImagesAsBase64(ctx, client.HTTP, parsed.Data.ImageURLs)
		if err != nil {
			return nil, err
		}
	}
	if len(images) == 0 {
		return nil, fmt.Errorf("MiniMax 未返回图片")
	}

	return &AIImageResult{Images: images}, nil
}

func fetchRemoteImagesAsBase64(ctx context.Context, httpClient *http.Client, urls []string) ([]string, error) {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	out := make([]string, 0, len(urls))
	for _, imageURL := range urls {
		imageURL = strings.TrimSpace(imageURL)
		if imageURL == "" {
			continue
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
		if err != nil {
			return nil, fmt.Errorf("create image download request failed: %w", err)
		}
		resp, err := httpClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("download generated image failed: %w", err)
		}
		raw, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return nil, fmt.Errorf("read generated image failed: %w", readErr)
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, fmt.Errorf("download generated image HTTP %d", resp.StatusCode)
		}
		out = append(out, base64.StdEncoding.EncodeToString(raw))
	}
	return out, nil
}

func truncateForError(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 240 {
		return value
	}
	return value[:240] + "..."
}
