package service

import (
	"errors"
	"net/url"
	"strings"
	"time"
)

type PromoService struct {
	repo      *PromoRepo
	jwtSecret string
}

const (
	maxPromoOrderNoRunes   = 128
	maxPromoURLRunes       = 2048
	maxPromoColorNoteRunes = 200
	maxPromoAddressRunes   = 500
	maxPromoAdminNoteRunes = 1000
)

func validatePromoHTTPURL(raw string) bool {
	if len([]rune(raw)) > maxPromoURLRunes {
		return false
	}
	parsed, err := url.ParseRequestURI(raw)
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return false
	}
	scheme := strings.ToLower(parsed.Scheme)
	return scheme == "https" || scheme == "http"
}

func NewPromoService(repo *PromoRepo, jwtSecret string) *PromoService {
	return &PromoService{repo: repo, jwtSecret: jwtSecret}
}

func (s *PromoService) loadCampaignsWithStats(now time.Time) ([]PromoCampaignDefinition, error) {
	campaigns := DefaultPromoCampaigns(now)
	out := make([]PromoCampaignDefinition, 0, len(campaigns))
	for _, campaign := range campaigns {
		count, err := s.repo.CountSubmissionsByCampaign(campaign.ID)
		if err != nil {
			return nil, err
		}
		out = append(out, PromoCampaignWithStats(campaign, count))
	}
	return out, nil
}

func (s *PromoService) GetOverview(userSerial string) (PromoOverview, error) {
	now := time.Now()
	campaigns, err := s.loadCampaignsWithStats(now)
	if err != nil {
		return PromoOverview{}, err
	}
	choiceGroup := PromoChoiceGroupSpring2026
	overview := PromoOverview{
		ChoiceGroup: choiceGroup,
		Rule:        "以下两个活动只能二选一参与，提交后不可更改或同时报名另一个活动。各活动限 260 份，报满即止。",
		Campaigns:   campaigns,
	}
	existing, err := s.repo.FindByUserAndGroup(userSerial, choiceGroup)
	if err != nil {
		return overview, err
	}
	if existing != nil {
		overview.Current = &PromoUserSubmissionView{
			ID:         existing.ID,
			CampaignID: existing.CampaignID,
			Status:     existing.Status,
			AdminNote:  existing.AdminNote,
			CreatedAt:  existing.CreatedAt,
			UpdatedAt:  existing.UpdatedAt,
		}
		overview.LockedCampaignID = existing.CampaignID
	}
	return overview, nil
}

func (s *PromoService) Submit(userSerial string, input PromoSubmissionInput) (PromoUserSubmissionView, error) {
	campaign, ok := FindPromoCampaign(strings.TrimSpace(input.CampaignID))
	if !ok {
		return PromoUserSubmissionView{}, errors.New("活动不存在")
	}
	if !PromoCampaignActive(campaign, time.Now()) {
		return PromoUserSubmissionView{}, errors.New("活动未开始或已结束")
	}
	existing, err := s.repo.FindByUserAndGroup(userSerial, campaign.ChoiceGroup)
	if err != nil {
		return PromoUserSubmissionView{}, err
	}
	if existing != nil {
		return PromoUserSubmissionView{}, errors.New("你已参与本组活动，不可重复报名或改选另一活动")
	}
	count, err := s.repo.CountSubmissionsByCampaign(campaign.ID)
	if err != nil {
		return PromoUserSubmissionView{}, err
	}
	if count >= PromoCampaignQuotaLimit {
		return PromoUserSubmissionView{}, errors.New("该活动报名人数已满（260份），请选择另一活动或稍后再试")
	}

	orderNo := strings.TrimSpace(input.OrderNo)
	orderScreenshot := strings.TrimSpace(input.OrderScreenshotURL)
	if orderScreenshot == "" {
		return PromoUserSubmissionView{}, errors.New("请上传订单截图")
	}
	if !validatePromoHTTPURL(orderScreenshot) {
		return PromoUserSubmissionView{}, errors.New("订单截图地址无效")
	}
	if orderNo == "" && campaign.ID != PromoCampaignCNCRrepurchase {
		return PromoUserSubmissionView{}, errors.New("请填写订单号")
	}
	if len([]rune(orderNo)) > maxPromoOrderNoRunes {
		return PromoUserSubmissionView{}, errors.New("订单号过长")
	}

	item := PromoSubmission{
		CampaignID:         campaign.ID,
		ChoiceGroup:        campaign.ChoiceGroup,
		UserSerial:         userSerial,
		OrderNo:            orderNo,
		OrderScreenshotURL: orderScreenshot,
		Status:             PromoStatusPending,
	}

	switch campaign.ID {
	case PromoCampaignCNCRrepurchase:
		colorNote := strings.TrimSpace(input.InjectionColorNote)
		address := strings.TrimSpace(input.ShippingAddress)
		if colorNote == "" {
			return PromoUserSubmissionView{}, errors.New("请填写注塑 V1PRO 颜色备注")
		}
		if len([]rune(colorNote)) > maxPromoColorNoteRunes {
			return PromoUserSubmissionView{}, errors.New("颜色备注过长")
		}
		if address == "" {
			return PromoUserSubmissionView{}, errors.New("请填写收货地址")
		}
		if len([]rune(address)) > maxPromoAddressRunes {
			return PromoUserSubmissionView{}, errors.New("收货地址过长")
		}
		addressEnc, err := EncryptActivityField(s.jwtSecret, address)
		if err != nil {
			return PromoUserSubmissionView{}, errors.New("保存收货地址失败")
		}
		item.InjectionColorNote = colorNote
		item.ShippingAddressEnc = addressEnc
	case PromoCampaignVideoLikeFreeOrder:
		videoLink := strings.TrimSpace(input.VideoLink)
		paymentQr := strings.TrimSpace(input.PaymentQrURL)
		if videoLink == "" {
			return PromoUserSubmissionView{}, errors.New("请填写视频链接")
		}
		if !validatePromoHTTPURL(videoLink) {
			return PromoUserSubmissionView{}, errors.New("视频链接格式不正确")
		}
		if paymentQr == "" {
			return PromoUserSubmissionView{}, errors.New("请上传收款码")
		}
		if !validatePromoHTTPURL(paymentQr) {
			return PromoUserSubmissionView{}, errors.New("收款码地址无效")
		}
		qrEnc, err := EncryptActivityField(s.jwtSecret, paymentQr)
		if err != nil {
			return PromoUserSubmissionView{}, errors.New("保存收款码失败")
		}
		item.VideoLink = videoLink
		item.PaymentQrURLEnc = qrEnc
	default:
		return PromoUserSubmissionView{}, errors.New("暂不支持该活动")
	}

	created, err := s.repo.CreateSubmission(item)
	if err != nil {
		return PromoUserSubmissionView{}, err
	}
	return PromoUserSubmissionView{
		ID:         created.ID,
		CampaignID: created.CampaignID,
		Status:     created.Status,
		CreatedAt:  created.CreatedAt,
		UpdatedAt:  created.UpdatedAt,
	}, nil
}

// GetMySubmission returns the complete submission only to its authenticated
// owner. Sensitive fields are decrypted for this response so the applicant can
// verify and correct what they entered.
func (s *PromoService) GetMySubmission(userSerial string) (PromoSubmissionPlain, error) {
	item, err := s.repo.FindByUserAndGroup(strings.TrimSpace(userSerial), PromoChoiceGroupSpring2026)
	if err != nil {
		return PromoSubmissionPlain{}, err
	}
	if item == nil {
		return PromoSubmissionPlain{}, errors.New("暂无报名记录")
	}
	return s.toPlain(*item, true)
}

// UpdateSubmission keeps the chosen campaign immutable. Pending and rejected
// submissions may be corrected; a correction always re-enters pending review.
func (s *PromoService) UpdateSubmission(userSerial string, input PromoSubmissionInput) (PromoSubmissionPlain, error) {
	userSerial = strings.TrimSpace(userSerial)
	existing, err := s.repo.FindByUserAndGroup(userSerial, PromoChoiceGroupSpring2026)
	if err != nil {
		return PromoSubmissionPlain{}, err
	}
	if existing == nil {
		return PromoSubmissionPlain{}, errors.New("暂无可修改的报名记录")
	}
	if existing.Status != PromoStatusPending && existing.Status != PromoStatusRejected {
		return PromoSubmissionPlain{}, errors.New("该报名已审核通过，不能再修改")
	}
	if campaignID := strings.TrimSpace(input.CampaignID); campaignID != "" && campaignID != existing.CampaignID {
		return PromoSubmissionPlain{}, errors.New("已报名的活动不能更换")
	}
	campaign, ok := FindPromoCampaign(existing.CampaignID)
	if !ok {
		return PromoSubmissionPlain{}, errors.New("活动不存在")
	}
	if !PromoCampaignActive(campaign, time.Now()) {
		return PromoSubmissionPlain{}, errors.New("活动已结束，不能再修改")
	}

	content, err := s.validateSubmissionContent(campaign, input)
	if err != nil {
		return PromoSubmissionPlain{}, err
	}
	updated, err := s.repo.UpdateSubmissionContent(existing.ID, userSerial, content)
	if err != nil {
		return PromoSubmissionPlain{}, err
	}
	return s.toPlain(*updated, true)
}

func (s *PromoService) validateSubmissionContent(campaign PromoCampaignDefinition, input PromoSubmissionInput) (PromoSubmission, error) {
	orderNo := strings.TrimSpace(input.OrderNo)
	orderScreenshot := strings.TrimSpace(input.OrderScreenshotURL)
	if orderScreenshot == "" {
		return PromoSubmission{}, errors.New("请上传订单截图")
	}
	if orderNo == "" && campaign.ID != PromoCampaignCNCRrepurchase {
		return PromoSubmission{}, errors.New("请填写订单号")
	}
	content := PromoSubmission{
		OrderNo:            orderNo,
		OrderScreenshotURL: orderScreenshot,
	}
	switch campaign.ID {
	case PromoCampaignCNCRrepurchase:
		colorNote := strings.TrimSpace(input.InjectionColorNote)
		address := strings.TrimSpace(input.ShippingAddress)
		if colorNote == "" {
			return PromoSubmission{}, errors.New("请填写注塑 V1PRO 颜色备注")
		}
		if address == "" {
			return PromoSubmission{}, errors.New("请填写收货地址")
		}
		addressEnc, err := EncryptActivityField(s.jwtSecret, address)
		if err != nil {
			return PromoSubmission{}, errors.New("保存收货地址失败")
		}
		content.InjectionColorNote = colorNote
		content.ShippingAddressEnc = addressEnc
	case PromoCampaignVideoLikeFreeOrder:
		videoLink := strings.TrimSpace(input.VideoLink)
		paymentQr := strings.TrimSpace(input.PaymentQrURL)
		if videoLink == "" {
			return PromoSubmission{}, errors.New("请填写视频链接")
		}
		if _, err := url.ParseRequestURI(videoLink); err != nil {
			return PromoSubmission{}, errors.New("视频链接格式不正确")
		}
		if paymentQr == "" {
			return PromoSubmission{}, errors.New("请上传收款码")
		}
		qrEnc, err := EncryptActivityField(s.jwtSecret, paymentQr)
		if err != nil {
			return PromoSubmission{}, errors.New("保存收款码失败")
		}
		content.VideoLink = videoLink
		content.PaymentQrURLEnc = qrEnc
	default:
		return PromoSubmission{}, errors.New("暂不支持该活动")
	}
	return content, nil
}

func (s *PromoService) ListAdminSubmissions(campaignID, status string) ([]PromoSubmissionPlain, error) {
	items, err := s.repo.ListSubmissions(campaignID, status)
	if err != nil {
		return nil, err
	}
	out := make([]PromoSubmissionPlain, 0, len(items))
	for _, item := range items {
		plain, err := s.toPlain(item, false)
		if err != nil {
			return nil, err
		}
		out = append(out, plain)
	}
	return out, nil
}

func (s *PromoService) GetAdminSubmission(id string) (PromoSubmissionPlain, error) {
	item, err := s.repo.GetSubmission(id)
	if err != nil {
		return PromoSubmissionPlain{}, err
	}
	return s.toPlain(*item, true)
}

func (s *PromoService) ReviewSubmission(id, status, adminNote string) (PromoSubmissionPlain, error) {
	status = strings.TrimSpace(status)
	adminNote = strings.TrimSpace(adminNote)
	if len([]rune(adminNote)) > maxPromoAdminNoteRunes {
		return PromoSubmissionPlain{}, errors.New("管理员备注过长")
	}
	switch status {
	case PromoStatusApproved, PromoStatusRejected, PromoStatusPending:
	default:
		return PromoSubmissionPlain{}, errors.New("状态无效")
	}
	updated, err := s.repo.UpdateSubmissionStatus(id, status, adminNote)
	if err != nil {
		return PromoSubmissionPlain{}, err
	}
	return s.toPlain(*updated, true)
}

func (s *PromoService) toPlain(item PromoSubmission, decryptSensitive bool) (PromoSubmissionPlain, error) {
	plain := PromoSubmissionPlain{
		ID:                 item.ID,
		CampaignID:         item.CampaignID,
		ChoiceGroup:        item.ChoiceGroup,
		UserSerial:         item.UserSerial,
		OrderNo:            item.OrderNo,
		OrderScreenshotURL: item.OrderScreenshotURL,
		InjectionColorNote: item.InjectionColorNote,
		VideoLink:          item.VideoLink,
		Status:             item.Status,
		AdminNote:          item.AdminNote,
		CreatedAt:          item.CreatedAt,
		UpdatedAt:          item.UpdatedAt,
	}
	if decryptSensitive {
		if item.ShippingAddressEnc != "" {
			address, err := DecryptActivityField(s.jwtSecret, item.ShippingAddressEnc)
			if err != nil {
				return PromoSubmissionPlain{}, err
			}
			plain.ShippingAddress = address
		}
		if item.PaymentQrURLEnc != "" {
			qr, err := DecryptActivityField(s.jwtSecret, item.PaymentQrURLEnc)
			if err != nil {
				return PromoSubmissionPlain{}, err
			}
			plain.PaymentQrURL = qr
		}
	}
	return plain, nil
}
