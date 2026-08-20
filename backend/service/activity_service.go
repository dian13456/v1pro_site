package service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"math/big"
	"strings"
	"time"
)

type ActivityService struct {
	repo        *ActivityRepo
	secret      string
	knownSN     func(sn string) bool
	displayName func(userSerial string) string
}

func NewActivityService(repo *ActivityRepo, secret string, knownSN func(sn string) bool, displayName func(userSerial string) string) *ActivityService {
	return &ActivityService{repo: repo, secret: secret, knownSN: knownSN, displayName: displayName}
}

func (s *ActivityService) resolvePublicDisplayName(userSerial string) string {
	userSerial = strings.TrimSpace(userSerial)
	if userSerial == "" {
		return "用户"
	}
	if s.displayName != nil {
		if name := strings.TrimSpace(s.displayName(userSerial)); name != "" {
			return name
		}
	}
	return DisplayUsernameFromSerial(userSerial)
}

func (s *ActivityService) GetCurrentPublic(userSerial string) (ActivityPublicView, error) {
	activity, ok, err := s.repo.GetActiveActivity()
	if err != nil {
		return ActivityPublicView{}, err
	}
	if !ok {
		return ActivityPublicView{}, errors.New("当前没有进行中的活动")
	}
	return s.buildPublicView(activity, userSerial)
}

func (s *ActivityService) buildPublicView(activity Activity, userSerial string) (ActivityPublicView, error) {
	count, err := s.repo.CountJoins(activity.ID)
	if err != nil {
		return ActivityPublicView{}, err
	}
	now := time.Now()
	view := ActivityPublicView{
		Activity:            activity,
		ParticipantCount:    count,
		NextDrawAt:          NextDrawTime(activity, now).UnixMilli(),
		RegistrationOpen:    LotteryRegistrationOpen(activity, now),
		RegistrationMessage: "",
	}
	if !view.RegistrationOpen {
		view.RegistrationMessage = JoinErrorRegistrationClosed
	}
	if userSerial == "" {
		return view, nil
	}
	period := DrawPeriodKey(now)
	if userSerial != "" {
		has, joinedSN, joinErr := s.repo.HasUserJoinedInPeriod(activity.ID, userSerial, period)
		if joinErr != nil {
			return ActivityPublicView{}, joinErr
		}
		if has {
			view.HasJoined = true
			view.JoinedSN = joinedSN
		}
	}
	winner, found, err := s.repo.GetWinnerByUser(activity.ID, userSerial)
	if err != nil {
		return ActivityPublicView{}, err
	}
	if found {
		view.IsWinner = true
		view.WinnerID = winner.ID
		view.ContactStatus = winner.ContactStatus
	}
	return view, nil
}

type JoinActivityInput struct {
	ActivityID string
	SN         string
	UserSerial string
	UserIP     string
}

type JoinActivityResult struct {
	Message    string `json:"message"`
	JoinID     string `json:"joinId,omitempty"`
	DrawPeriod string `json:"drawPeriod,omitempty"`
}

func (s *ActivityService) Join(input JoinActivityInput) (JoinActivityResult, error) {
	sn := NormalizeSN(input.SN)
	if !ValidateSNFormat(sn) {
		return JoinActivityResult{}, errors.New(JoinErrorSNFormat)
	}
	activity, ok, err := s.resolveActivity(input.ActivityID)
	if err != nil {
		return JoinActivityResult{}, err
	}
	if !ok {
		return JoinActivityResult{}, errors.New("活动不存在")
	}
	now := time.Now()
	nowMs := now.UnixMilli()
	if activity.StartTime > nowMs {
		return JoinActivityResult{}, errors.New(JoinErrorActivityNotYet)
	}
	if activity.EndTime > 0 && activity.EndTime < nowMs {
		return JoinActivityResult{}, errors.New(JoinErrorActivityEnded)
	}
	if activity.Status != ActivityStatusActive {
		return JoinActivityResult{}, errors.New(JoinErrorActivityEnded)
	}
	if !LotteryRegistrationOpen(activity, now) {
		return JoinActivityResult{}, errors.New(JoinErrorRegistrationClosed)
	}
	period := DrawPeriodKey(now)
	drawn, err := s.repo.HasDrawnPeriod(activity.ID, period)
	if err != nil {
		return JoinActivityResult{}, err
	}
	if drawn {
		return JoinActivityResult{}, errors.New(JoinErrorRegistrationClosed)
	}
	if !s.isKnownDevice(sn, input.UserSerial) {
		return JoinActivityResult{}, errors.New(JoinErrorSNNotFound)
	}
	has, err := s.repo.HasJoinInPeriod(activity.ID, sn, period)
	if err != nil {
		return JoinActivityResult{}, err
	}
	if has {
		return JoinActivityResult{}, errors.New(JoinErrorAlreadyJoined)
	}
	join := ActivityJoin{
		ID:         NewActivityID(),
		ActivityID: activity.ID,
		SN:         sn,
		DeviceID:   sn,
		UserSerial: strings.TrimSpace(input.UserSerial),
		UserIP:     strings.TrimSpace(input.UserIP),
		JoinTime:   nowMs,
		DrawPeriod: period,
		Status:     JoinStatusActive,
	}
	if err := s.repo.AddJoin(join); err != nil {
		return JoinActivityResult{}, err
	}
	return JoinActivityResult{
		Message:    "报名成功，开奖后系统会自动通知",
		JoinID:     join.ID,
		DrawPeriod: period,
	}, nil
}

func (s *ActivityService) isKnownDevice(sn, userSerial string) bool {
	if sn == "" {
		return false
	}
	if userSerial != "" && sn == NormalizeSN(userSerial) {
		return true
	}
	if s.knownSN != nil && s.knownSN(sn) {
		return true
	}
	ok, err := s.repo.IsRegisteredDevice(sn)
	return err == nil && ok
}

func (s *ActivityService) resolveActivity(activityID string) (Activity, bool, error) {
	activityID = strings.TrimSpace(activityID)
	if activityID != "" {
		return s.repo.GetActivity(activityID)
	}
	return s.repo.GetActiveActivity()
}

type DrawResult struct {
	ActivityID  string   `json:"activityId"`
	DrawPeriod  string   `json:"drawPeriod"`
	WinnerCount int      `json:"winnerCount"`
	JoinCount   int      `json:"joinCount"`
	SeedHash    string   `json:"seedHash"`
	WinnerIDs   []string `json:"winnerIds"`
}

func (s *ActivityService) DrawForPeriod(activityID, period string, force bool) (DrawResult, error) {
	activity, ok, err := s.resolveActivity(activityID)
	if err != nil {
		return DrawResult{}, err
	}
	if !ok {
		return DrawResult{}, errors.New("活动不存在")
	}
	period = strings.TrimSpace(period)
	if period == "" {
		period = DrawPeriodKey(time.Now())
	}
	drawn, err := s.repo.HasDrawnPeriod(activity.ID, period)
	if err != nil {
		return DrawResult{}, err
	}
	if drawn && !force {
		return DrawResult{}, fmt.Errorf("period %s already drawn", period)
	}
	joins, err := s.repo.ListJoinsByPeriod(activity.ID, period)
	if err != nil {
		return DrawResult{}, err
	}
	eligible := make([]ActivityJoin, 0, len(joins))
	for _, join := range joins {
		hasWon, winErr := s.repo.HasWinnerSN(activity.ID, join.SN)
		if winErr != nil {
			return DrawResult{}, winErr
		}
		if !hasWon {
			eligible = append(eligible, join)
		}
	}
	if len(eligible) == 0 {
		entry := DrawLogEntry{
			ActivityID:  activity.ID,
			DrawPeriod:  period,
			DrawnAt:     time.Now().UnixMilli(),
			JoinCount:   len(joins),
			WinnerCount: 0,
			SeedHash:    hashSeed("empty"),
		}
		if err := s.repo.AddDrawLog(entry); err != nil {
			return DrawResult{}, err
		}
		return DrawResult{
			ActivityID:  activity.ID,
			DrawPeriod:  period,
			WinnerCount: 0,
			JoinCount:   len(joins),
			SeedHash:    entry.SeedHash,
		}, nil
	}
	winnersCount := activity.WinnersPerDraw
	if winnersCount <= 0 {
		winnersCount = 1
	}
	if winnersCount > len(eligible) {
		winnersCount = len(eligible)
	}
	seedBytes := make([]byte, 32)
	if _, err := rand.Read(seedBytes); err != nil {
		return DrawResult{}, err
	}
	seedHash := hashSeed(hex.EncodeToString(seedBytes))
	picked := securePickIndices(len(eligible), winnersCount, seedBytes)
	winnerJoinIDs := map[string]struct{}{}
	winnerIDs := make([]string, 0, winnersCount)
	nowMs := time.Now().UnixMilli()
	for _, idx := range picked {
		join := eligible[idx]
		winner := Winner{
			ID:             NewActivityID(),
			ActivityID:     activity.ID,
			JoinID:         join.ID,
			SN:             join.SN,
			UserSerial:     join.UserSerial,
			WinnerTime:     nowMs,
			SeedHash:       seedHash,
			ContactStatus:  ContactStatusPending,
			ShippingStatus: ShippingStatusPending,
			DrawPeriod:     period,
		}
		if err := s.repo.AddWinner(winner); err != nil {
			return DrawResult{}, err
		}
		winnerJoinIDs[join.ID] = struct{}{}
		winnerIDs = append(winnerIDs, winner.ID)
		notifyInput := WinnerNotificationInput{
			ActivityID:    activity.ID,
			ActivityTitle: activity.Title,
			SN:            join.SN,
			UserSerial:    join.UserSerial,
			WinnerID:      winner.ID,
			WinnerTime:    nowMs,
		}
		NotifyWinnerAllChannels(notifyInput, "", "", "")
	}
	if err := s.repo.MarkJoinsLost(activity.ID, period, winnerJoinIDs); err != nil {
		return DrawResult{}, err
	}
	entry := DrawLogEntry{
		ActivityID:  activity.ID,
		DrawPeriod:  period,
		DrawnAt:     nowMs,
		JoinCount:   len(joins),
		WinnerCount: len(winnerIDs),
		SeedHash:    seedHash,
	}
	if err := s.repo.AddDrawLog(entry); err != nil {
		return DrawResult{}, err
	}
	log.Printf("[activity-draw] activity=%s period=%s winners=%d joins=%d seedHash=%s", activity.ID, period, len(winnerIDs), len(joins), seedHash)
	return DrawResult{
		ActivityID:  activity.ID,
		DrawPeriod:  period,
		WinnerCount: len(winnerIDs),
		JoinCount:   len(joins),
		SeedHash:    seedHash,
		WinnerIDs:   winnerIDs,
	}, nil
}

func hashSeed(seed string) string {
	sum := sha256.Sum256([]byte(seed))
	return hex.EncodeToString(sum[:])
}

func securePickIndices(poolSize, pickCount int, seed []byte) []int {
	if pickCount <= 0 || poolSize <= 0 {
		return nil
	}
	indices := make([]int, poolSize)
	for i := range indices {
		indices[i] = i
	}
	// Fisher-Yates shuffle using crypto/rand
	for i := poolSize - 1; i > 0; i-- {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(i+1)))
		if err != nil {
			break
		}
		j := int(n.Int64())
		indices[i], indices[j] = indices[j], indices[i]
	}
	_ = seed
	return indices[:pickCount]
}

type SubmitPrizeInfoInput struct {
	WinnerID   string
	UserSerial string
	Info       WinnerInfoPlain
}

type SubmitPrizeInfoResult struct {
	Message      string `json:"message"`
	ShippingDays int    `json:"shippingDays"`
}

func (s *ActivityService) SubmitPrizeInfo(input SubmitPrizeInfoInput) (SubmitPrizeInfoResult, error) {
	winner, ok, err := s.repo.GetWinner(input.WinnerID)
	if err != nil {
		return SubmitPrizeInfoResult{}, err
	}
	if !ok {
		return SubmitPrizeInfoResult{}, errors.New("中奖记录不存在")
	}
	if strings.TrimSpace(input.UserSerial) != "" && winner.UserSerial != strings.TrimSpace(input.UserSerial) {
		return SubmitPrizeInfoResult{}, errors.New("无权填写该中奖信息")
	}
	hasInfo, err := s.repo.HasWinnerInfo(winner.ID)
	if err != nil {
		return SubmitPrizeInfoResult{}, err
	}
	if hasInfo || winner.ContactStatus == ContactStatusFilled {
		return SubmitPrizeInfoResult{}, errors.New("信息已提交，不可修改")
	}
	info := strings.TrimSpace(input.Info.Name)
	if info == "" {
		return SubmitPrizeInfoResult{}, errors.New("姓名不能为空")
	}
	if !ValidateChinaMobilePhone(input.Info.Phone) {
		return SubmitPrizeInfoResult{}, errors.New("手机号格式不正确")
	}
	if strings.TrimSpace(input.Info.Province) == "" || strings.TrimSpace(input.Info.City) == "" || strings.TrimSpace(input.Info.Address) == "" {
		return SubmitPrizeInfoResult{}, errors.New("收货地址不完整")
	}
	if !ValidateQQNumber(input.Info.QQ) {
		return SubmitPrizeInfoResult{}, errors.New("QQ号格式不正确")
	}
	nameEnc, err := EncryptActivityField(s.secret, input.Info.Name)
	if err != nil {
		return SubmitPrizeInfoResult{}, err
	}
	phoneEnc, err := EncryptActivityField(s.secret, input.Info.Phone)
	if err != nil {
		return SubmitPrizeInfoResult{}, err
	}
	wechatEnc, err := EncryptActivityField(s.secret, input.Info.Wechat)
	if err != nil {
		return SubmitPrizeInfoResult{}, err
	}
	qqEnc, err := EncryptActivityField(s.secret, input.Info.QQ)
	if err != nil {
		return SubmitPrizeInfoResult{}, err
	}
	addressEnc, err := EncryptActivityField(s.secret, input.Info.Address)
	if err != nil {
		return SubmitPrizeInfoResult{}, err
	}
	record := WinnerInfo{
		ID:         NewActivityID(),
		WinnerID:   winner.ID,
		NameEnc:    nameEnc,
		PhoneEnc:   phoneEnc,
		WechatEnc:  wechatEnc,
		QQEnc:      qqEnc,
		Province:   strings.TrimSpace(input.Info.Province),
		City:       strings.TrimSpace(input.Info.City),
		AddressEnc: addressEnc,
		CreatedAt:  time.Now().UnixMilli(),
	}
	if err := s.repo.AddWinnerInfo(record); err != nil {
		return SubmitPrizeInfoResult{}, err
	}
	if err := s.repo.UpdateWinnerContact(winner.ID, ContactStatusFilled); err != nil {
		return SubmitPrizeInfoResult{}, err
	}
	activity, found, err := s.repo.GetActivity(winner.ActivityID)
	shippingDays := 7
	if err == nil && found && activity.ShippingDays > 0 {
		shippingDays = activity.ShippingDays
	}
	return SubmitPrizeInfoResult{
		Message:      fmt.Sprintf("信息提交成功，我们将在%d个工作日内发货", shippingDays),
		ShippingDays: shippingDays,
	}, nil
}

func (s *ActivityService) GetPrizeInfoStatus(userSerial string) (map[string]any, error) {
	activity, ok, err := s.repo.GetActiveActivity()
	if err != nil {
		return nil, err
	}
	if !ok {
		return map[string]any{"isWinner": false}, nil
	}
	winner, found, err := s.repo.GetWinnerByUser(activity.ID, userSerial)
	if err != nil {
		return nil, err
	}
	if !found {
		return map[string]any{"isWinner": false, "activityId": activity.ID}, nil
	}
	hasInfo, err := s.repo.HasWinnerInfo(winner.ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"isWinner":       true,
		"winnerId":       winner.ID,
		"activityId":     activity.ID,
		"activityTitle":  activity.Title,
		"contactStatus":  winner.ContactStatus,
		"shippingStatus": winner.ShippingStatus,
		"trackingNo":     winner.TrackingNo,
		"hasSubmitted":   hasInfo,
		"shippingDays":   activity.ShippingDays,
	}, nil
}

func (s *ActivityService) DecryptWinnerInfo(winnerID string) (WinnerInfoPlain, error) {
	info, ok, err := s.repo.GetWinnerInfo(winnerID)
	if err != nil {
		return WinnerInfoPlain{}, err
	}
	if !ok {
		return WinnerInfoPlain{}, errors.New("联系信息不存在")
	}
	name, err := DecryptActivityField(s.secret, info.NameEnc)
	if err != nil {
		return WinnerInfoPlain{}, err
	}
	phone, err := DecryptActivityField(s.secret, info.PhoneEnc)
	if err != nil {
		return WinnerInfoPlain{}, err
	}
	wechat, err := DecryptActivityField(s.secret, info.WechatEnc)
	if err != nil {
		return WinnerInfoPlain{}, err
	}
	qq, err := DecryptActivityField(s.secret, info.QQEnc)
	if err != nil {
		return WinnerInfoPlain{}, err
	}
	address, err := DecryptActivityField(s.secret, info.AddressEnc)
	if err != nil {
		return WinnerInfoPlain{}, err
	}
	return WinnerInfoPlain{
		Name:     name,
		Phone:    phone,
		Wechat:   wechat,
		QQ:       qq,
		Province: info.Province,
		City:     info.City,
		Address:  address,
	}, nil
}

func (s *ActivityService) EnsureDefaultActivity() error {
	_, ok, err := s.repo.GetActiveActivity()
	if err != nil {
		return err
	}
	if ok {
		return s.EnsureLotterySchedule()
	}
	activity := DefaultActivity()
	if err := s.repo.SaveActivity(activity); err != nil {
		return err
	}
	return nil
}

func (s *ActivityService) EnsureLotterySchedule() error {
	activity, ok, err := s.repo.GetActiveActivity()
	if err != nil || !ok {
		return err
	}
	defaults := DefaultActivity()
	changed := false
	if activity.DrawHour != defaults.DrawHour {
		activity.DrawHour = defaults.DrawHour
		changed = true
	}
	if activity.DrawMinute != defaults.DrawMinute {
		activity.DrawMinute = defaults.DrawMinute
		changed = true
	}
	if strings.TrimSpace(activity.Rule) != defaults.Rule {
		activity.Rule = defaults.Rule
		changed = true
	}
	if !changed {
		return nil
	}
	activity.UpdatedAt = time.Now().UnixMilli()
	return s.repo.SaveActivity(activity)
}

func (s *ActivityService) ResetDailyJoins(activityID string, now time.Time) (int64, error) {
	period := DrawPeriodKey(now)
	return s.repo.ClearJoinsExceptPeriod(activityID, period)
}

func (s *ActivityService) RegisterAuthenticatedDevice(serial, source string) error {
	sn := NormalizeSN(serial)
	if !ValidateSNFormat(sn) {
		return nil
	}
	return s.repo.RegisterDevice(DeviceRegistryEntry{
		Serial:    sn,
		Source:    source,
		CreatedAt: time.Now().UnixMilli(),
	})
}

func (s *ActivityService) RepoListActivities() ([]Activity, error) {
	return s.repo.ListActivities()
}

func (s *ActivityService) RepoListJoins(activityID string, limit int) ([]ActivityJoin, error) {
	return s.repo.ListJoins(activityID, limit)
}

func (s *ActivityService) RepoListWinners(activityID string) ([]Winner, error) {
	return s.repo.ListWinners(activityID)
}

func (s *ActivityService) ListPublicWinners(activityID string) (PublicWinnersView, error) {
	activity, ok, err := s.resolveActivity(activityID)
	if err != nil {
		return PublicWinnersView{}, err
	}
	if !ok {
		return PublicWinnersView{}, errors.New("活动不存在")
	}
	winners, err := s.repo.ListWinners(activity.ID)
	if err != nil {
		return PublicWinnersView{}, err
	}
	records := make([]WinnerPublicRecord, 0, len(winners))
	for _, winner := range winners {
		records = append(records, WinnerPublicRecord{
			DrawPeriod:  winner.DrawPeriod,
			DisplayName: s.resolvePublicDisplayName(winner.UserSerial),
			SNMasked:    MaskSNForPublic(winner.SN),
			PrizeTitle:  activity.PrizeTitle,
			WinnerTime:  winner.WinnerTime,
		})
	}
	return PublicWinnersView{
		ActivityID:    activity.ID,
		ActivityTitle: activity.Title,
		PrizeTitle:    activity.PrizeTitle,
		Winners:       records,
	}, nil
}

func (s *ActivityService) RepoUpdateWinnerShipping(winnerID, status, trackingNo string) error {
	return s.repo.UpdateWinnerShipping(winnerID, status, trackingNo)
}

func (s *ActivityService) RepoListDevices(limit int) ([]DeviceRegistryEntry, error) {
	return s.repo.ListDevices(limit)
}

func (s *ActivityService) AdminUpsertActivity(req ActivityAdminUpsertInput) (Activity, error) {
	now := time.Now().UnixMilli()
	id := strings.TrimSpace(req.ID)
	if id == "" {
		id = NewActivityID()
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		return Activity{}, errors.New("活动标题不能为空")
	}
	status := strings.TrimSpace(req.Status)
	if status == "" {
		status = ActivityStatusActive
	}
	activity := Activity{
		ID:               id,
		Title:            title,
		Description:      strings.TrimSpace(req.Description),
		Rule:             strings.TrimSpace(req.Rule),
		StartTime:        req.StartTime,
		EndTime:          req.EndTime,
		Status:           status,
		PrizeTitle:       strings.TrimSpace(req.PrizeTitle),
		PrizeDescription: strings.TrimSpace(req.PrizeDescription),
		PrizeImage:       strings.TrimSpace(req.PrizeImage),
		DrawHour:         req.DrawHour,
		DrawMinute:       req.DrawMinute,
		WinnersPerDraw:   req.WinnersPerDraw,
		ShippingDays:     req.ShippingDays,
		UpdatedAt:        now,
	}
	if existing, ok, err := s.repo.GetActivity(id); err == nil && ok {
		activity.CreatedAt = existing.CreatedAt
	} else {
		activity.CreatedAt = now
	}
	if activity.WinnersPerDraw <= 0 {
		activity.WinnersPerDraw = 1
	}
	if activity.ShippingDays <= 0 {
		activity.ShippingDays = 7
	}
	if err := s.repo.SaveActivity(activity); err != nil {
		return Activity{}, err
	}
	return activity, nil
}
