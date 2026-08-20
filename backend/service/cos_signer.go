package service

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/tencentyun/cos-go-sdk-v5"
)

type COSSigner struct {
	client       *cos.Client
	secretID     string
	secretKey    string
	objectPrefix string
	cdnBaseURL   *url.URL
	cdnAuthKey   string
	cdnSignParam string
}

type COSObjectReader struct {
	Body          io.ReadCloser
	ContentLength int64
	ContentType   string
}

func NewCOSSigner(bucket, region, secretID, secretKey string) (*COSSigner, error) {
	return NewCOSSignerWithPrefix(bucket, region, secretID, secretKey, "")
}

func NewCOSSignerWithPrefix(bucket, region, secretID, secretKey, objectPrefix string) (*COSSigner, error) {
	if bucket == "" || region == "" || secretID == "" || secretKey == "" {
		return nil, fmt.Errorf("missing COS config")
	}

	baseURL := fmt.Sprintf("https://%s.cos.%s.myqcloud.com", bucket, region)
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return nil, err
	}

	client := cos.NewClient(
		&cos.BaseURL{BucketURL: parsed},
		&http.Client{
			Timeout: 60 * time.Second,
			Transport: &cos.AuthorizationTransport{
				SecretID:  secretID,
				SecretKey: secretKey,
			},
		},
	)

	return &COSSigner{
		client:       client,
		secretID:     secretID,
		secretKey:    secretKey,
		objectPrefix: normalizeObjectPrefix(objectPrefix),
	}, nil
}

func normalizeObjectPrefix(prefix string) string {
	prefix = strings.Trim(strings.TrimSpace(prefix), "/")
	if prefix == "" {
		return ""
	}
	return prefix + "/"
}

func (s *COSSigner) objectName(objectKey string) string {
	return s.objectPrefix + strings.TrimLeft(strings.TrimSpace(objectKey), "/")
}

// ConfigureReadCDN switches generated read URLs to Tencent CDN Type-A signed
// URLs. Direct COS reads, uploads and deletes continue to use the private bucket.
func (s *COSSigner) ConfigureReadCDN(baseURL, authKey, signParam string) error {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		return nil
	}
	if strings.TrimSpace(authKey) == "" {
		return fmt.Errorf("CDN auth key is required")
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("invalid CDN base URL")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return fmt.Errorf("CDN base URL must not contain a path")
	}
	parsed.Path = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""
	if strings.TrimSpace(signParam) == "" {
		signParam = "sign"
	}
	s.cdnBaseURL = parsed
	s.cdnAuthKey = strings.TrimSpace(authKey)
	s.cdnSignParam = strings.TrimSpace(signParam)
	return nil
}

func (s *COSSigner) UploadObject(ctx context.Context, objectKey, contentType string, data []byte) error {
	if len(data) == 0 {
		return fmt.Errorf("empty upload payload")
	}
	_, err := s.client.Object.Put(ctx, s.objectName(objectKey), bytes.NewReader(data), &cos.ObjectPutOptions{
		ObjectPutHeaderOptions: &cos.ObjectPutHeaderOptions{
			ContentType:   contentType,
			ContentLength: int64(len(data)),
		},
	})
	return err
}

func (s *COSSigner) DeleteObject(ctx context.Context, objectKey string) error {
	objectKey = strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if objectKey == "" {
		return nil
	}
	_, err := s.client.Object.Delete(ctx, s.objectName(objectKey), nil)
	return err
}

func (s *COSSigner) GetObject(ctx context.Context, objectKey string) ([]byte, error) {
	reader, err := s.OpenObject(ctx, objectKey)
	if err != nil {
		return nil, err
	}
	defer reader.Body.Close()
	return io.ReadAll(reader.Body)
}

func (s *COSSigner) OpenObject(ctx context.Context, objectKey string) (*COSObjectReader, error) {
	objectKey = strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if objectKey == "" {
		return nil, fmt.Errorf("empty object key")
	}
	resp, err := s.client.Object.Get(ctx, s.objectName(objectKey), nil)
	if err != nil {
		return nil, err
	}
	if resp == nil || resp.Body == nil {
		return nil, fmt.Errorf("empty get response")
	}
	return &COSObjectReader{
		Body:          resp.Body,
		ContentLength: resp.ContentLength,
		ContentType:   resp.Header.Get("Content-Type"),
	}, nil
}

func (s *COSSigner) GenerateReadURL(ctx context.Context, objectKey string, ttl time.Duration) (string, error) {
	if s.cdnBaseURL != nil {
		return s.generateCDNReadURL(objectKey)
	}
	signedURL, err := s.client.Object.GetPresignedURL(
		ctx,
		http.MethodGet,
		s.objectName(objectKey),
		s.secretID,
		s.secretKey,
		ttl,
		nil,
	)
	if err != nil {
		return "", err
	}
	return signedURL.String(), nil
}

func (s *COSSigner) generateCDNReadURL(objectKey string) (string, error) {
	objectName := s.objectName(objectKey)
	if objectName == s.objectPrefix || strings.TrimSpace(objectName) == "" {
		return "", fmt.Errorf("empty object key")
	}
	pathURL := &url.URL{Path: "/" + objectName}
	escapedPath := pathURL.EscapedPath()
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	randomBytes := make([]byte, 8)
	if _, err := rand.Read(randomBytes); err != nil {
		return "", fmt.Errorf("generate CDN nonce: %w", err)
	}
	randomValue := hex.EncodeToString(randomBytes)
	digest := md5.Sum([]byte(strings.Join([]string{
		escapedPath,
		timestamp,
		randomValue,
		"0",
		s.cdnAuthKey,
	}, "-")))
	signature := strings.Join([]string{
		timestamp,
		randomValue,
		"0",
		hex.EncodeToString(digest[:]),
	}, "-")

	result := *s.cdnBaseURL
	result.Path = "/" + objectName
	result.RawPath = escapedPath
	query := result.Query()
	query.Set(s.cdnSignParam, signature)
	result.RawQuery = query.Encode()
	return result.String(), nil
}

func (s *COSSigner) GeneratePutURL(
	ctx context.Context,
	objectKey string,
	contentType string,
	ttl time.Duration,
) (string, error) {
	objectKey = strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if objectKey == "" {
		return "", fmt.Errorf("empty object key")
	}
	header := &http.Header{}
	if strings.TrimSpace(contentType) != "" {
		header.Set("Content-Type", contentType)
	}
	signedURL, err := s.client.Object.GetPresignedURL(
		ctx,
		http.MethodPut,
		s.objectName(objectKey),
		s.secretID,
		s.secretKey,
		ttl,
		&cos.PresignedURLOptions{Header: header},
	)
	if err != nil {
		return "", err
	}
	return signedURL.String(), nil
}

type ObjectHeadInfo struct {
	ContentLength int64
	ContentType   string
}

func (s *COSSigner) HeadObject(ctx context.Context, objectKey string) (ObjectHeadInfo, error) {
	objectKey = strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if objectKey == "" {
		return ObjectHeadInfo{}, fmt.Errorf("empty object key")
	}
	resp, err := s.client.Object.Head(ctx, s.objectName(objectKey), nil)
	if err != nil {
		return ObjectHeadInfo{}, err
	}
	if resp == nil {
		return ObjectHeadInfo{}, fmt.Errorf("empty head response")
	}
	return ObjectHeadInfo{
		ContentLength: resp.ContentLength,
		ContentType:   resp.Header.Get("Content-Type"),
	}, nil
}
