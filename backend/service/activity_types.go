package service

import (
	"strings"
	"time"
)

const (
	ActivityStatusDraft  = "draft"
	ActivityStatusActive = "active"
	ActivityStatusEnded  = "ended"

	JoinStatusActive = "active"
	JoinStatusDrawn  = "drawn"
	JoinStatusWon    = "won"
	JoinStatusLost   = "lost"

	ContactStatusPending = "pending"
	ContactStatusFilled  = "filled"

	ShippingStatusPending  = "pending"
	ShippingStatusShipped  = "shipped"

	JoinErrorSNNotFound     = "SN不存在"
	JoinErrorAlreadyJoined  = "该设备已经参与"
	JoinErrorSNFormat       = "SN格式错误"
	JoinErrorActivityEnded  = "活动已结束"
	JoinErrorActivityNotYet = "活动尚未开始"
)

type Activity struct {
	ID               string `json:"id"`
	Title            string `json:"title"`
	Description      string `json:"description"`
	Rule             string `json:"rule"`
	StartTime        int64  `json:"startTime"`
	EndTime          int64  `json:"endTime"`
	Status           string `json:"status"`
	PrizeTitle       string `json:"prizeTitle"`
	PrizeDescription string `json:"prizeDescription"`
	PrizeImage       string `json:"prizeImage,omitempty"`
	DrawHour         int    `json:"drawHour"`
	DrawMinute       int    `json:"drawMinute"`
	WinnersPerDraw   int    `json:"winnersPerDraw"`
	ShippingDays     int    `json:"shippingDays"`
	CreatedAt        int64  `json:"createdAt"`
	UpdatedAt        int64  `json:"updatedAt"`
}

type ActivityJoin struct {
	ID         string `json:"id"`
	ActivityID string `json:"activityId"`
	SN         string `json:"sn"`
	DeviceID   string `json:"deviceId"`
	UserSerial string `json:"userSerial"`
	UserIP     string `json:"userIp"`
	JoinTime   int64  `json:"joinTime"`
	DrawPeriod string `json:"drawPeriod"`
	Status     string `json:"status"`
}

type Winner struct {
	ID             string `json:"id"`
	ActivityID     string `json:"activityId"`
	JoinID         string `json:"joinId"`
	SN             string `json:"sn"`
	UserSerial     string `json:"userSerial"`
	WinnerTime     int64  `json:"winnerTime"`
	SeedHash       string `json:"seedHash"`
	ContactStatus  string `json:"contactStatus"`
	ShippingStatus string `json:"shippingStatus"`
	DrawPeriod     string `json:"drawPeriod"`
}

type WinnerInfo struct {
	ID         string `json:"id"`
	WinnerID   string `json:"winnerId"`
	NameEnc    string `json:"nameEnc"`
	PhoneEnc   string `json:"phoneEnc"`
	WechatEnc  string `json:"wechatEnc"`
	QQEnc      string `json:"qqEnc"`
	Province   string `json:"province"`
	City       string `json:"city"`
	AddressEnc string `json:"addressEnc"`
	CreatedAt  int64  `json:"createdAt"`
}

type WinnerInfoPlain struct {
	Name     string `json:"name"`
	Phone    string `json:"phone"`
	Wechat   string `json:"wechat"`
	QQ       string `json:"qq"`
	Province string `json:"province"`
	City     string `json:"city"`
	Address  string `json:"address"`
}

type DeviceRegistryEntry struct {
	Serial    string `json:"serial"`
	Source    string `json:"source,omitempty"`
	CreatedAt int64  `json:"createdAt"`
}

type ActivityDataStore struct {
	Activities []Activity            `json:"activities"`
	Joins      []ActivityJoin        `json:"joins"`
	Winners    []Winner              `json:"winners"`
	WinnerInfo []WinnerInfo          `json:"winnerInfo"`
	Devices    []DeviceRegistryEntry `json:"devices"`
	DrawLog    []DrawLogEntry        `json:"drawLog"`
}

type DrawLogEntry struct {
	ActivityID  string `json:"activityId"`
	DrawPeriod  string `json:"drawPeriod"`
	DrawnAt     int64  `json:"drawnAt"`
	JoinCount   int    `json:"joinCount"`
	WinnerCount int    `json:"winnerCount"`
	SeedHash    string `json:"seedHash"`
}

type ActivityAdminUpsertInput struct {
	ID               string
	Title            string
	Description      string
	Rule             string
	StartTime        int64
	EndTime          int64
	Status           string
	PrizeTitle       string
	PrizeDescription string
	PrizeImage       string
	DrawHour         int
	DrawMinute       int
	WinnersPerDraw   int
	ShippingDays     int
}

type ActivityPublicView struct {
	Activity
	ParticipantCount int64 `json:"participantCount"`
	NextDrawAt     int64 `json:"nextDrawAt"`
	HasJoined      bool  `json:"hasJoined,omitempty"`
	JoinedSN       string `json:"joinedSn,omitempty"`
	IsWinner       bool  `json:"isWinner,omitempty"`
	WinnerID       string `json:"winnerId,omitempty"`
	ContactStatus  string `json:"contactStatus,omitempty"`
}

type WinnerPublicRecord struct {
	DrawPeriod string `json:"drawPeriod"`
	SNMasked   string `json:"snMasked"`
	PrizeTitle string `json:"prizeTitle"`
	WinnerTime int64  `json:"winnerTime"`
}

type PublicWinnersView struct {
	ActivityID    string               `json:"activityId"`
	ActivityTitle string               `json:"activityTitle"`
	PrizeTitle    string               `json:"prizeTitle"`
	Winners       []WinnerPublicRecord `json:"winners"`
}

func NormalizeSN(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	out := make([]rune, 0, len(raw))
	for _, r := range raw {
		switch {
		case r >= 'a' && r <= 'z':
			out = append(out, r-'a'+'A')
		case (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_':
			out = append(out, r)
		}
	}
	return string(out)
}

func ValidateSNFormat(sn string) bool {
	sn = NormalizeSN(sn)
	if len(sn) < 6 || len(sn) > 64 {
		return false
	}
	for _, r := range sn {
		if !((r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_') {
			return false
		}
	}
	return true
}

func MaskSNForPublic(sn string) string {
	sn = NormalizeSN(sn)
	if sn == "" {
		return "***"
	}
	n := len(sn)
	if n <= 4 {
		return sn[:1] + "***"
	}
	if n <= 6 {
		return sn[:2] + "***" + sn[n-1:]
	}
	return sn[:3] + "***" + sn[n-2:]
}

func DrawPeriodKey(t time.Time) string {
	return t.Format("2006-01-02")
}

func NextDrawTime(activity Activity, now time.Time) time.Time {
	loc := now.Location()
	candidate := time.Date(now.Year(), now.Month(), now.Day(), activity.DrawHour, activity.DrawMinute, 0, 0, loc)
	if !candidate.After(now) {
		candidate = candidate.Add(24 * time.Hour)
	}
	return candidate
}

func DefaultActivity() Activity {
	now := time.Now()
	return Activity{
		ID:               "lottery-default",
		Title:            "设备用户专属抽奖活动",
		Description:      "购买设备即可使用 SN 码参与",
		Rule:             "每24小时自动开奖一次；每个有效设备 SN 每24小时只能参与一次；一个 SN 只能获得一次中奖资格。",
		StartTime:        now.Add(-24 * time.Hour).UnixMilli(),
		EndTime:          now.Add(365 * 24 * time.Hour).UnixMilli(),
		Status:           ActivityStatusActive,
		PrizeTitle:       "V1PRO 限定周边礼包",
		PrizeDescription: "含定制壳子、贴纸与品牌周边，具体以活动页展示为准。",
		DrawHour:         20,
		DrawMinute:       0,
		WinnersPerDraw:   1,
		ShippingDays:     7,
		CreatedAt:        now.UnixMilli(),
		UpdatedAt:        now.UnixMilli(),
	}
}
