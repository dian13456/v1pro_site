package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode"
)

const (
	defaultDeepSeekBaseURL = "https://api.deepseek.com"
	defaultDeepSeekModel   = "deepseek-chat"
	maxAIGuideCatalogItems = 80
	maxAIQuestionRunes     = 300
)

type DeepSeekClient struct {
	APIKey  string
	Model   string
	BaseURL string
	HTTP    *http.Client
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type deepSeekRequest struct {
	Model          string        `json:"model"`
	Messages       []ChatMessage `json:"messages"`
	ResponseFormat struct {
		Type string `json:"type"`
	} `json:"response_format"`
	Temperature float64 `json:"temperature"`
}

func NewDeepSeekClient(apiKey, model, baseURL string) *DeepSeekClient {
	model = strings.TrimSpace(model)
	if model == "" {
		model = defaultDeepSeekModel
	}
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		baseURL = defaultDeepSeekBaseURL
	}
	return &DeepSeekClient{
		APIKey:  strings.TrimSpace(apiKey),
		Model:   model,
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTP: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

type AIGuideCatalogItem struct {
	ID           int    `json:"id"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	MaterialType string `json:"materialType"`
	ColumnTag    string `json:"columnTag,omitempty"`
	Author       string `json:"author,omitempty"`
	UpdatedAt    string `json:"updatedAt,omitempty"`
}

type AIGuideResult struct {
	Answer      string `json:"answer"`
	ResourceIDs []int  `json:"resourceIds"`
}

func truncateRunes(value string, max int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return string(runes[:max]) + "…"
}

func tokenizeQuestion(question string) []string {
	question = strings.ToLower(strings.TrimSpace(question))
	if question == "" {
		return nil
	}
	var tokens []string
	var current strings.Builder
	flush := func() {
		if current.Len() == 0 {
			return
		}
		token := current.String()
		if len([]rune(token)) >= 1 {
			tokens = append(tokens, token)
		}
		current.Reset()
	}
	for _, r := range question {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			current.WriteRune(r)
			continue
		}
		flush()
	}
	flush()
	if len(tokens) == 0 {
		return []string{question}
	}
	return tokens
}

func scoreCatalogItem(item AIGuideCatalogItem, tokens []string) int {
	if len(tokens) == 0 {
		return 0
	}
	blob := strings.ToLower(strings.Join([]string{
		item.Title,
		item.Description,
		item.ColumnTag,
		item.Author,
		item.MaterialType,
	}, " "))
	score := 0
	for _, token := range tokens {
		if token == "" {
			continue
		}
		if strings.Contains(blob, token) {
			score += 2
		}
		if strings.Contains(strings.ToLower(item.Title), token) {
			score += 3
		}
		if strings.Contains(strings.ToLower(item.ColumnTag), token) {
			score += 2
		}
	}
	return score
}

func BuildAIGuideCatalog(rawResources []map[string]any, question string) []AIGuideCatalogItem {
	items := make([]AIGuideCatalogItem, 0, len(rawResources))
	for _, raw := range rawResources {
		id := toInt(raw["id"])
		title := strings.TrimSpace(fmt.Sprint(raw["title"]))
		description := strings.TrimSpace(fmt.Sprint(raw["description"]))
		if id <= 0 || title == "" {
			continue
		}
		items = append(items, AIGuideCatalogItem{
			ID:           id,
			Title:        title,
			Description:  truncateRunes(description, 80),
			MaterialType: strings.TrimSpace(fmt.Sprint(raw["materialType"])),
			ColumnTag:    strings.TrimSpace(fmt.Sprint(raw["columnTag"])),
			Author:       strings.TrimSpace(fmt.Sprint(raw["author"])),
			UpdatedAt:    strings.TrimSpace(fmt.Sprint(raw["updatedAt"])),
		})
	}

	tokens := tokenizeQuestion(question)
	type scored struct {
		item  AIGuideCatalogItem
		score int
		index int
	}
	scoredItems := make([]scored, 0, len(items))
	for index, item := range items {
		scoredItems = append(scoredItems, scored{
			item:  item,
			score: scoreCatalogItem(item, tokens),
			index: index,
		})
	}
	sort.Slice(scoredItems, func(i, j int) bool {
		if scoredItems[i].score != scoredItems[j].score {
			return scoredItems[i].score > scoredItems[j].score
		}
		return scoredItems[i].index < scoredItems[j].index
	})

	limit := maxAIGuideCatalogItems
	if len(scoredItems) < limit {
		limit = len(scoredItems)
	}
	result := make([]AIGuideCatalogItem, 0, limit)
	for i := 0; i < limit; i++ {
		result = append(result, scoredItems[i].item)
	}
	return result
}

func BuildColumnTagSummary(rawTags []map[string]any) string {
	if len(rawTags) == 0 {
		return "暂无专栏标签"
	}
	lines := make([]string, 0, len(rawTags))
	for _, raw := range rawTags {
		label := strings.TrimSpace(fmt.Sprint(raw["label"]))
		if label == "" {
			continue
		}
		keywords := make([]string, 0)
		switch typed := raw["keywords"].(type) {
		case []any:
			for _, item := range typed {
				value := strings.TrimSpace(fmt.Sprint(item))
				if value != "" {
					keywords = append(keywords, value)
				}
			}
		}
		if len(keywords) > 0 {
			lines = append(lines, fmt.Sprintf("- %s（关键词：%s）", label, strings.Join(keywords, "、")))
			continue
		}
		lines = append(lines, "- "+label)
	}
	return strings.Join(lines, "\n")
}

func (client *DeepSeekClient) GenerateGuide(ctx context.Context, question string, catalog []AIGuideCatalogItem, columnSummary string) (*AIGuideResult, error) {
	if client == nil || client.APIKey == "" {
		return nil, fmt.Errorf("deepseek api key not configured")
	}

	question = truncateRunes(question, maxAIQuestionRunes)
	catalogJSON, err := json.Marshal(catalog)
	if err != nil {
		return nil, err
	}

	systemPrompt := strings.Join([]string{
		"你是「佳点 HUB 素材中心」的 AI 内容导览助手。",
		"用户设备为 1.9 寸横屏（320×170），素材类型含图片、视频、GIF、V1PRO 素材包。",
		"请基于提供的素材目录回答用户问题，推荐合适素材，并简要说明推荐理由。",
		"只能推荐目录 JSON 中存在的 id，最多推荐 6 个。",
		"若用户问题与素材无关，礼貌引导其描述想要的主题、角色、风格或素材类型。",
		"必须严格输出 JSON，格式：{\"answer\":\"中文回复\",\"resourceIds\":[数字ID数组]}",
		"专栏标签：",
		columnSummary,
	}, "\n")

	userPrompt := fmt.Sprintf("用户问题：%s\n\n候选素材目录 JSON：\n%s", question, string(catalogJSON))

	payload := deepSeekRequest{
		Model: client.Model,
		Messages: []ChatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		Temperature: 0.4,
	}
	payload.ResponseFormat.Type = "json_object"

	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, client.BaseURL+"/chat/completions", bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+client.APIKey)

	resp, err := client.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("deepseek http %d: %s", resp.StatusCode, truncateRunes(string(body), 200))
	}

	var apiResp struct {
		Choices []struct {
			Message ChatMessage `json:"message"`
		} `json:"choices"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, err
	}
	if apiResp.Error != nil && apiResp.Error.Message != "" {
		return nil, fmt.Errorf("deepseek error: %s", apiResp.Error.Message)
	}
	if len(apiResp.Choices) == 0 {
		return nil, fmt.Errorf("deepseek empty response")
	}

	content := strings.TrimSpace(apiResp.Choices[0].Message.Content)
	return parseAIGuideResult(content)
}

func parseAIGuideResult(content string) (*AIGuideResult, error) {
	content = strings.TrimSpace(content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)

	var parsed struct {
		Answer      string `json:"answer"`
		ResourceIDs []any  `json:"resourceIds"`
	}
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return nil, fmt.Errorf("parse ai json failed: %w", err)
	}

	answer := strings.TrimSpace(parsed.Answer)
	if answer == "" {
		answer = "已为你整理相关素材，请查看下方推荐。"
	}

	ids := make([]int, 0, len(parsed.ResourceIDs))
	seen := map[int]bool{}
	for _, rawID := range parsed.ResourceIDs {
		id := toInt(rawID)
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
		if len(ids) >= 6 {
			break
		}
	}

	return &AIGuideResult{
		Answer:      answer,
		ResourceIDs: ids,
	}, nil
}

func toInt(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		parsed, _ := typed.Int64()
		return int(parsed)
	default:
		text := strings.TrimSpace(fmt.Sprint(value))
		if text == "" {
			return 0
		}
		var parsed int
		fmt.Sscanf(text, "%d", &parsed)
		return parsed
	}
}

func LocalAIGuideFallback(question string, catalog []AIGuideCatalogItem) *AIGuideResult {
	tokens := tokenizeQuestion(question)
	type scored struct {
		item  AIGuideCatalogItem
		score int
	}
	ranked := make([]scored, 0, len(catalog))
	for _, item := range catalog {
		score := scoreCatalogItem(item, tokens)
		if score <= 0 {
			continue
		}
		ranked = append(ranked, scored{item: item, score: score})
	}
	sort.Slice(ranked, func(i, j int) bool {
		return ranked[i].score > ranked[j].score
	})

	ids := make([]int, 0, 6)
	names := make([]string, 0, 6)
	for _, entry := range ranked {
		ids = append(ids, entry.item.ID)
		names = append(names, entry.item.Title)
		if len(ids) >= 6 {
			break
		}
	}

	answer := "你可以尝试在素材中心使用关键词搜索，或浏览专栏与类型筛选。"
	if len(names) > 0 {
		answer = fmt.Sprintf("根据关键词为你找到 %d 个可能相关的素材：%s。", len(names), strings.Join(names, "、"))
	} else if strings.TrimSpace(question) != "" {
		answer = fmt.Sprintf("暂未精确匹配「%s」，建议换个描述，或试试「视频」「GIF」「月薪喵」等关键词。", truncateRunes(question, 40))
	}

	return &AIGuideResult{
		Answer:      answer,
		ResourceIDs: ids,
	}
}
