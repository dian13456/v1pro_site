package service

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/url"
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
		&http.Client{Timeout: 10 * time.Second},
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
			ContentType: contentType,
			ContentLength: int64(len(data)),
		},
	})
	return err
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
