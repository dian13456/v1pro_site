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

func NewPromoService(repo *PromoRepo, jwtSecret string) *PromoService {
	return &PromoService{repo: repo, jwtSecret: jwtSecret}
}

func (s *PromoService) GetOverview(userSerial string) (PromoOverview, error) {
	now := time.Now()
	campaigns := DefaultPromoCampaigns(now)
	choiceGroup := PromoChoiceGroupSpring2026
	overview := PromoOverview{
		ChoiceGroup: choiceGroup,
		Rule:        "以下两个活动只能二选一参与，提交后不可更改或同时报名另一个活动。",
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

	orderNo := strings.TrimSpace(input.OrderNo)
	orderScreenshot := strings.TrimSpace(input.OrderScreenshotURL)
	if orderScreenshot == "" {
		return PromoUserSubmissionView{}, errors.New("请上传订单截图")
	}
	if orderNo == "" && campaign.ID != PromoCampaignCNCRrepurchase {
		return PromoUserSubmissionView{}, errors.New("请填写订单号")
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
		if address == "" {
			return PromoUserSubmissionView{}, errors.New("请填写收货地址")
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
		if _, err := url.ParseRequestURI(videoLink); err != nil {
			return PromoUserSubmissionView{}, errors.New("视频链接格式不正确")
		}
		if paymentQr == "" {
			return PromoUserSubmissionView{}, errors.New("请上传收款码")
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
