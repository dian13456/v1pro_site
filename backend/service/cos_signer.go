package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/tencentyun/cos-go-sdk-v5"
)

type COSSigner struct {
	client   *cos.Client
	secretID string
	secretKey string
}

func NewCOSSigner(bucket, region, secretID, secretKey string) (*COSSigner, error) {
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
		client:    client,
		secretID:  secretID,
		secretKey: secretKey,
	}, nil
}

func (s *COSSigner) UploadObject(ctx context.Context, objectKey, contentType string, data []byte) error {
	if len(data) == 0 {
		return fmt.Errorf("empty upload payload")
	}
	_, err := s.client.Object.Put(ctx, objectKey, bytes.NewReader(data), &cos.ObjectPutOptions{
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
	_, err := s.client.Object.Delete(ctx, objectKey, nil)
	return err
}

func (s *COSSigner) GetObject(ctx context.Context, objectKey string) ([]byte, error) {
	objectKey = strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if objectKey == "" {
		return nil, fmt.Errorf("empty object key")
	}
	resp, err := s.client.Object.Get(ctx, objectKey, nil)
	if err != nil {
		return nil, err
	}
	if resp == nil || resp.Body == nil {
		return nil, fmt.Errorf("empty get response")
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

func (s *COSSigner) GenerateReadURL(ctx context.Context, objectKey string, ttl time.Duration) (string, error) {
	signedURL, err := s.client.Object.GetPresignedURL(
		ctx,
		http.MethodGet,
		objectKey,
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
		objectKey,
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
	resp, err := s.client.Object.Head(ctx, objectKey, nil)
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
