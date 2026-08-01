package service

import "time"

const (
	PromoCampaignCNCRrepurchase      = "cnc-repurchase-bonus"
	PromoCampaignVideoLikeFreeOrder    = "video-like-free-order"
	PromoChoiceGroupSpring2026       = "promo-choice-2026-spring"
	PromoCampaignQuotaLimit          = 260

	PromoStatusPending  = "pending"
	PromoStatusApproved = "approved"
	PromoStatusRejected = "rejected"
)

type PromoCampaignDefinition struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Summary     string `json:"summary"`
	Description string `json:"description"`
	ChoiceGroup string `json:"choiceGroup"`
	Status      string `json:"status"`
	StartTime      int64  `json:"startTime"`
	EndTime        int64  `json:"endTime"`
	QuotaLimit     int    `json:"quotaLimit"`
	SubmittedCount int    `json:"submittedCount"`
	QuotaFull      bool   `json:"quotaFull"`
}

type PromoSubmission struct {
	ID                 string `json:"id"`
	CampaignID         string `json:"campaignId"`
	ChoiceGroup        string `json:"choiceGroup"`
	UserSerial         string `json:"userSerial"`
	OrderNo            string `json:"orderNo"`
	OrderScreenshotURL string `json:"orderScreenshotUrl"`
	InjectionColorNote string `json:"injectionColorNote,omitempty"`
	ShippingAddressEnc string `json:"shippingAddressEnc,omitempty"`
	VideoLink          string `json:"videoLink,omitempty"`
	PaymentQrURLEnc    string `json:"paymentQrUrlEnc,omitempty"`
	Status             string `json:"status"`
	AdminNote          string `json:"adminNote,omitempty"`
	CreatedAt          int64  `json:"createdAt"`
	UpdatedAt          int64  `json:"updatedAt"`
}

type PromoSubmissionPlain struct {
	ID                 string `json:"id"`
	CampaignID         string `json:"campaignId"`
	ChoiceGroup        string `json:"choiceGroup"`
	UserSerial         string `json:"userSerial"`
	OrderNo            string `json:"orderNo"`
	OrderScreenshotURL string `json:"orderScreenshotUrl"`
	InjectionColorNote string `json:"injectionColorNote,omitempty"`
	ShippingAddress    string `json:"shippingAddress,omitempty"`
	VideoLink          string `json:"videoLink,omitempty"`
	PaymentQrURL       string `json:"paymentQrUrl,omitempty"`
	Status             string `json:"status"`
	AdminNote          string `json:"adminNote,omitempty"`
	CreatedAt          int64  `json:"createdAt"`
	UpdatedAt          int64  `json:"updatedAt"`
}

type PromoSubmissionInput struct {
	CampaignID         string
	UserSerial         string
	OrderNo            string
	OrderScreenshotURL string
	InjectionColorNote string
	ShippingAddress    string
	VideoLink          string
	PaymentQrURL       string
}

type PromoUserSubmissionView struct {
	ID         string `json:"id"`
	CampaignID string `json:"campaignId"`
	Status     string `json:"status"`
	AdminNote  string `json:"adminNote,omitempty"`
	CreatedAt  int64  `json:"createdAt"`
	UpdatedAt  int64  `json:"updatedAt"`
}

type PromoOverview struct {
	ChoiceGroup      string                    `json:"choiceGroup"`
	Rule             string                    `json:"rule"`
	Campaigns        []PromoCampaignDefinition `json:"campaigns"`
	Current          *PromoUserSubmissionView  `json:"current,omitempty"`
	LockedCampaignID string                    `json:"lockedCampaignId,omitempty"`
}

type PromoDataStore struct {
	Submissions []PromoSubmission `json:"submissions"`
}

func DefaultPromoCampaigns(now time.Time) []PromoCampaignDefinition {
	start := time.Date(2026, 8, 1, 0, 0, 0, 0, now.Location())
	end := time.Date(2026, 12, 31, 23, 59, 59, 0, now.Location())
	return []PromoCampaignDefinition{
		{
			ID:          PromoCampaignCNCRrepurchase,
			Title:       "CNC用户复购加送注塑V1PRO",
			Summary:     "原有 CNC 用户复购注塑 V1PRO，凭订单号加送一个注塑 V1PRO。",
			Description: "活动说明：原有 CNC 用户，复购注塑 V1PRO，凭订单号加送一个注塑 V1PRO。\n\n资料填写：CNC 订单号（直购用户发支付截图）、订单截图、注塑 V1PRO 颜色备注和收货地址。审核通过后安排加送发货。",
			ChoiceGroup: PromoChoiceGroupSpring2026,
			Status:      ActivityStatusActive,
			StartTime:   start.UnixMilli(),
			EndTime:     end.UnixMilli(),
		},
		{
			ID:          PromoCampaignVideoLikeFreeOrder,
			Title:       "视频点赞免单活动",
			Summary:     "发布视频获赞达标，可申请订单免单。",
			Description: "提交订单号、订单截图、视频链接与收款码，工作人员审核点赞情况后处理免单。",
			ChoiceGroup: PromoChoiceGroupSpring2026,
			Status:      ActivityStatusActive,
			StartTime:   start.UnixMilli(),
			EndTime:     end.UnixMilli(),
		},
	}
}

func PromoCampaignWithStats(campaign PromoCampaignDefinition, submittedCount int64) PromoCampaignDefinition {
	campaign.QuotaLimit = PromoCampaignQuotaLimit
	if submittedCount < 0 {
		submittedCount = 0
	}
	campaign.SubmittedCount = int(submittedCount)
	campaign.QuotaFull = submittedCount >= PromoCampaignQuotaLimit
	return campaign
}

func FindPromoCampaign(id string) (PromoCampaignDefinition, bool) {
	for _, item := range DefaultPromoCampaigns(time.Now()) {
		if item.ID == id {
			return item, true
		}
	}
	return PromoCampaignDefinition{}, false
}

func PromoCampaignActive(c PromoCampaignDefinition, now time.Time) bool {
	if c.Status != ActivityStatusActive {
		return false
	}
	ms := now.UnixMilli()
	return ms >= c.StartTime && ms <= c.EndTime
}
