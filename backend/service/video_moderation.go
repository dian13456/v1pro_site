package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common"
	tcerr "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/errors"
	"github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/common/profile"
	vm "github.com/tencentcloud/tencentcloud-sdk-go/tencentcloud/vm/v20210922"
)

const (
	defaultVMRegion       = "ap-guangzhou"
	defaultVMPollInterval = 2 * time.Second
	defaultVMPollTimeout  = 3 * time.Minute
	vmRequestTimeoutSec   = 30
)

type VideoModerationClient struct {
	SecretID     string
	SecretKey    string
	Region       string
	BizType      string
	Enabled      bool
	PollInterval time.Duration
	PollTimeout  time.Duration
	client       *vm.Client
}

func ParseVideoModerationPollConfig(intervalSecRaw, timeoutSecRaw string) (time.Duration, time.Duration) {
	interval := defaultVMPollInterval
	timeout := defaultVMPollTimeout
	if value, err := parsePositiveInt64(strings.TrimSpace(intervalSecRaw)); err == nil && value > 0 {
		interval = time.Duration(value) * time.Second
	}
	if value, err := parsePositiveInt64(strings.TrimSpace(timeoutSecRaw)); err == nil && value > 0 {
		timeout = time.Duration(value) * time.Second
	}
	return interval, timeout
}

func NewVideoModerationClient(
	secretID, secretKey, region, bizType string,
	enabled bool,
	pollInterval, pollTimeout time.Duration,
) (*VideoModerationClient, error) {
	secretID = strings.TrimSpace(secretID)
	secretKey = strings.TrimSpace(secretKey)
	region = strings.TrimSpace(region)
	if region == "" {
		region = defaultVMRegion
	}
	bizType = strings.TrimSpace(bizType)
	if pollInterval <= 0 {
		pollInterval = defaultVMPollInterval
	}
	if pollTimeout <= 0 {
		pollTimeout = defaultVMPollTimeout
	}

	client := &VideoModerationClient{
		SecretID:     secretID,
		SecretKey:    secretKey,
		Region:       region,
		BizType:      bizType,
		Enabled:      enabled,
		PollInterval: pollInterval,
		PollTimeout:  pollTimeout,
	}
	if !enabled || secretID == "" || secretKey == "" || bizType == "" {
		return client, nil
	}

	credential := common.NewCredential(secretID, secretKey)
	cpf := profile.NewClientProfile()
	cpf.HttpProfile.Endpoint = "vm.tencentcloudapi.com"
	cpf.HttpProfile.ReqTimeout = vmRequestTimeoutSec

	vmClient, err := vm.NewClient(credential, region, cpf)
	if err != nil {
		return nil, fmt.Errorf("init vm client failed: %w", err)
	}
	client.client = vmClient
	return client, nil
}

func (client *VideoModerationClient) Available() bool {
	return client != nil &&
		client.Enabled &&
		client.SecretID != "" &&
		client.SecretKey != "" &&
		client.BizType != "" &&
		client.client != nil
}

func (client *VideoModerationClient) ModerateVideoObjectDetailed(
	ctx context.Context,
	videoSigner *COSSigner,
	objectKey string,
	dataID string,
) (ImageModerationOutcome, error) {
	outcome := ImageModerationOutcome{Suggestion: "PASS"}
	if client == nil || !client.Available() {
		return outcome, nil
	}
	if videoSigner == nil {
		return outcome, fmt.Errorf("视频存储未配置")
	}
	objectKey = strings.TrimSpace(objectKey)
	if objectKey == "" {
		return outcome, fmt.Errorf("视频路径无效")
	}

	head, err := videoSigner.HeadObject(ctx, objectKey)
	if err != nil {
		return outcome, fmt.Errorf("读取视频文件信息失败")
	}
	if head.ContentLength <= 0 {
		return outcome, fmt.Errorf("视频文件为空")
	}
	if head.ContentLength > MaxUserVideoUploadBytes {
		return outcome, fmt.Errorf("视频文件超过大小限制")
	}

	signedURL, err := videoSigner.GenerateReadURL(ctx, objectKey, 30*time.Minute)
	if err != nil {
		return outcome, fmt.Errorf("生成视频审核地址失败")
	}

	taskID, err := client.createVideoModerationTask(ctx, sanitizeIMSDataID(dataID), signedURL)
	if err != nil {
		return outcome, err
	}
	return client.waitVideoModerationTask(ctx, taskID)
}

func (client *VideoModerationClient) createVideoModerationTask(
	ctx context.Context,
	dataID string,
	videoURL string,
) (string, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	request := vm.NewCreateVideoModerationTaskRequest()
	request.BizType = common.StringPtr(client.BizType)
	request.Type = common.StringPtr("VIDEO")
	request.Tasks = []*vm.TaskInput{
		{
			DataId: common.StringPtr(dataID),
			Input: &vm.StorageInfo{
				Type: common.StringPtr("URL"),
				Url:  common.StringPtr(videoURL),
			},
		},
	}

	response, err := client.client.CreateVideoModerationTaskWithContext(ctx, request)
	if err != nil {
		if sdkErr, ok := err.(*tcerr.TencentCloudSDKError); ok {
			return "", mapVMError(sdkErr)
		}
		return "", fmt.Errorf("创建视频审核任务失败: %w", err)
	}
	if response == nil || response.Response == nil || len(response.Response.Results) == 0 {
		return "", fmt.Errorf("创建视频审核任务失败: 空响应")
	}

	result := response.Response.Results[0]
	if result == nil {
		return "", fmt.Errorf("创建视频审核任务失败: 空结果")
	}
	if code := strings.ToUpper(strings.TrimSpace(stringValue(result.Code))); code != "" && code != "OK" {
		message := strings.TrimSpace(stringValue(result.Message))
		if message == "" {
			message = "创建视频审核任务失败"
		}
		return "", fmt.Errorf("%s", message)
	}
	taskID := strings.TrimSpace(stringValue(result.TaskId))
	if taskID == "" {
		return "", fmt.Errorf("创建视频审核任务失败: 未返回 TaskId")
	}
	return taskID, nil
}

func (client *VideoModerationClient) waitVideoModerationTask(
	ctx context.Context,
	taskID string,
) (ImageModerationOutcome, error) {
	outcome := ImageModerationOutcome{Suggestion: "PASS"}
	if ctx == nil {
		ctx = context.Background()
	}

	deadline := time.Now().Add(client.PollTimeout)
	for {
		if err := ctx.Err(); err != nil {
			return outcome, err
		}
		if time.Now().After(deadline) {
			return outcome, fmt.Errorf("视频审核超时，请稍后重试")
		}

		detail, err := client.describeTaskDetail(ctx, taskID)
		if err != nil {
			return outcome, err
		}

		status := strings.ToUpper(strings.TrimSpace(stringValue(detail.Status)))
		switch status {
		case "FINISH":
			return vmTaskDetailToOutcome(detail), nil
		case "ERROR", "CANCELLED":
			message := strings.TrimSpace(stringValue(detail.ErrorDescription))
			if message == "" {
				message = strings.TrimSpace(stringValue(detail.ErrorType))
			}
			if message == "" {
				message = "视频审核失败"
			}
			return outcome, fmt.Errorf("视频审核失败: %s", message)
		case "PENDING", "RUNNING", "":
			wait := client.PollInterval
			if detail.TryInSeconds != nil && *detail.TryInSeconds > 0 {
				wait = time.Duration(*detail.TryInSeconds) * time.Second
			}
			timer := time.NewTimer(wait)
			select {
			case <-ctx.Done():
				timer.Stop()
				return outcome, ctx.Err()
			case <-timer.C:
			}
		default:
			return outcome, fmt.Errorf("视频审核状态异常: %s", status)
		}
	}
}

func (client *VideoModerationClient) describeTaskDetail(
	ctx context.Context,
	taskID string,
) (*vm.DescribeTaskDetailResponseParams, error) {
	request := vm.NewDescribeTaskDetailRequest()
	request.TaskId = common.StringPtr(taskID)

	response, err := client.client.DescribeTaskDetailWithContext(ctx, request)
	if err != nil {
		if sdkErr, ok := err.(*tcerr.TencentCloudSDKError); ok {
			return nil, mapVMError(sdkErr)
		}
		return nil, fmt.Errorf("查询视频审核任务失败: %w", err)
	}
	if response == nil || response.Response == nil {
		return nil, fmt.Errorf("查询视频审核任务失败: 空响应")
	}
	return response.Response, nil
}

func vmTaskDetailToOutcome(detail *vm.DescribeTaskDetailResponseParams) ImageModerationOutcome {
	outcome := ImageModerationOutcome{Suggestion: "PASS"}
	if detail == nil {
		return outcome
	}

	outcome.Suggestion = normalizeModerationSuggestion(stringValue(detail.Suggestion))
	outcome.Label = strings.TrimSpace(stringValue(detail.Label))
	outcome.SubLabel = pickVMSubLabel(detail)
	if detail.Labels != nil {
		for _, label := range detail.Labels {
			if label == nil {
				continue
			}
			if outcome.Label == "" {
				outcome.Label = strings.TrimSpace(stringValue(label.Label))
			}
			if outcome.SubLabel == "" {
				outcome.SubLabel = strings.TrimSpace(stringValue(label.SubLabel))
			}
			if label.Score != nil && int(*label.Score) > outcome.Score {
				outcome.Score = int(*label.Score)
			}
		}
	}
	if outcome.Suggestion == "" {
		outcome.Suggestion = "PASS"
	}
	return outcome
}

func normalizeModerationSuggestion(raw string) string {
	switch strings.ToUpper(strings.TrimSpace(raw)) {
	case "PASS":
		return "PASS"
	case "REVIEW":
		return "REVIEW"
	case "BLOCK":
		return "BLOCK"
	default:
		return strings.ToUpper(strings.TrimSpace(raw))
	}
}

func pickVMSubLabel(detail *vm.DescribeTaskDetailResponseParams) string {
	if detail == nil || detail.Labels == nil {
		return ""
	}
	for _, label := range detail.Labels {
		if label == nil {
			continue
		}
		if sub := strings.TrimSpace(stringValue(label.SubLabel)); sub != "" {
			return sub
		}
	}
	return ""
}

func mapVMError(err *tcerr.TencentCloudSDKError) error {
	code := strings.TrimSpace(err.GetCode())
	message := strings.TrimSpace(err.GetMessage())
	switch code {
	case "UnauthorizedOperation", "UnauthorizedOperation.Unauthorized":
		return fmt.Errorf("视频审核服务未开通或账号欠费")
	case "RequestLimitExceeded":
		return fmt.Errorf("视频审核请求过于频繁，请稍后重试")
	default:
		if message != "" {
			return fmt.Errorf("视频审核失败: %s", message)
		}
		return fmt.Errorf("视频审核失败")
	}
}
