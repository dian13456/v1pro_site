package service

import "log"

// Notification stubs — wire real providers later.

type WinnerNotificationInput struct {
	ActivityID   string
	ActivityTitle string
	SN           string
	UserSerial   string
	WinnerID     string
	WinnerTime   int64
}

type NotificationResult struct {
	Channel string `json:"channel"`
	Sent    bool   `json:"sent"`
	Message string `json:"message,omitempty"`
}

func NotifyWinnerByEmail(input WinnerNotificationInput, email string) NotificationResult {
	log.Printf("[activity-notify] email stub activity=%s winner=%s sn=%s email=%s", input.ActivityID, input.WinnerID, input.SN, email)
	return NotificationResult{Channel: "email", Sent: false, Message: "邮件通知接口已预留，尚未接入"}
}

func NotifyWinnerBySMS(input WinnerNotificationInput, phone string) NotificationResult {
	log.Printf("[activity-notify] sms stub activity=%s winner=%s sn=%s phone=%s", input.ActivityID, input.WinnerID, input.SN, phone)
	return NotificationResult{Channel: "sms", Sent: false, Message: "短信通知接口已预留，尚未接入"}
}

func NotifyWinnerByWechat(input WinnerNotificationInput, openID string) NotificationResult {
	log.Printf("[activity-notify] wechat stub activity=%s winner=%s sn=%s openId=%s", input.ActivityID, input.WinnerID, input.SN, openID)
	return NotificationResult{Channel: "wechat", Sent: false, Message: "微信通知接口已预留，尚未接入"}
}

func NotifyWinnerAllChannels(input WinnerNotificationInput, email, phone, wechatOpenID string) []NotificationResult {
	return []NotificationResult{
		NotifyWinnerByEmail(input, email),
		NotifyWinnerBySMS(input, phone),
		NotifyWinnerByWechat(input, wechatOpenID),
	}
}
