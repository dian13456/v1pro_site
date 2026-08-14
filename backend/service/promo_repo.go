package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type PromoRepo struct {
	backend string
	path    string
	mysql   *promoMySQLStore
	mu      sync.Mutex
	cache   PromoDataStore
	loaded  bool
}

func NewPromoRepo(configDir string) (*PromoRepo, error) {
	if strings.TrimSpace(configDir) == "" {
		configDir = "config"
	}
	backend := strings.ToLower(strings.TrimSpace(os.Getenv("STORAGE_BACKEND")))
	if backend == "" {
		backend = "json"
	}
	repo := &PromoRepo{
		backend: backend,
		path:    filepath.Join(configDir, "promo_submissions.json"),
	}
	if backend == "mysql" {
		store, err := openPromoMySQLStore(os.Getenv("MYSQL_DSN"))
		if err != nil {
			return nil, err
		}
		repo.mysql = store
	}
	return repo, nil
}

func (r *PromoRepo) Close() error {
	if r == nil || r.mysql == nil {
		return nil
	}
	return r.mysql.Close()
}

func (r *PromoRepo) UsesMySQL() bool {
	return r != nil && r.backend == "mysql" && r.mysql != nil
}

func (r *PromoRepo) ctx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 12*time.Second)
}

func (r *PromoRepo) loadJSONLocked() error {
	if r.loaded {
		return nil
	}
	raw, err := os.ReadFile(r.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			r.cache = PromoDataStore{Submissions: []PromoSubmission{}}
			r.loaded = true
			return r.saveJSONLocked()
		}
		return err
	}
	if strings.TrimSpace(string(raw)) == "" {
		r.cache = PromoDataStore{Submissions: []PromoSubmission{}}
		r.loaded = true
		return r.saveJSONLocked()
	}
	var store PromoDataStore
	if err := json.Unmarshal(raw, &store); err != nil {
		return err
	}
	if store.Submissions == nil {
		store.Submissions = []PromoSubmission{}
	}
	r.cache = store
	r.loaded = true
	return nil
}

func (r *PromoRepo) saveJSONLocked() error {
	raw, err := json.MarshalIndent(r.cache, "", "  ")
	if err != nil {
		return err
	}
	tmp := r.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, r.path)
}

func newPromoSubmissionID() (string, error) {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return fmt.Sprintf("promo_%d_%s", time.Now().UnixMilli(), hex.EncodeToString(buf)), nil
}

func (r *PromoRepo) FindByUserAndGroup(userSerial, choiceGroup string) (*PromoSubmission, error) {
	userSerial = strings.TrimSpace(userSerial)
	choiceGroup = strings.TrimSpace(choiceGroup)
	if userSerial == "" || choiceGroup == "" {
		return nil, nil
	}
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.findByUserAndGroup(ctx, userSerial, choiceGroup)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.loadJSONLocked(); err != nil {
		return nil, err
	}
	for i := range r.cache.Submissions {
		item := r.cache.Submissions[i]
		if item.UserSerial == userSerial && item.ChoiceGroup == choiceGroup {
			copy := item
			return &copy, nil
		}
	}
	return nil, nil
}

func (r *PromoRepo) CreateSubmission(item PromoSubmission) (PromoSubmission, error) {
	if strings.TrimSpace(item.ID) == "" {
		id, err := newPromoSubmissionID()
		if err != nil {
			return PromoSubmission{}, err
		}
		item.ID = id
	}
	now := time.Now().UnixMilli()
	if item.CreatedAt == 0 {
		item.CreatedAt = now
	}
	item.UpdatedAt = now
	if item.Status == "" {
		item.Status = PromoStatusPending
	}
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.insertSubmission(ctx, item)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.loadJSONLocked(); err != nil {
		return PromoSubmission{}, err
	}
	r.cache.Submissions = append(r.cache.Submissions, item)
	if err := r.saveJSONLocked(); err != nil {
		return PromoSubmission{}, err
	}
	return item, nil
}

func (r *PromoRepo) CountSubmissionsByCampaign(campaignID string) (int64, error) {
	campaignID = strings.TrimSpace(campaignID)
	if campaignID == "" {
		return 0, nil
	}
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.countSubmissionsByCampaign(ctx, campaignID)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.loadJSONLocked(); err != nil {
		return 0, err
	}
	var count int64
	for _, item := range r.cache.Submissions {
		if item.CampaignID == campaignID {
			count++
		}
	}
	return count, nil
}

func (r *PromoRepo) ListSubmissions(campaignID, status string) ([]PromoSubmission, error) {
	campaignID = strings.TrimSpace(campaignID)
	status = strings.TrimSpace(status)
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.listSubmissions(ctx, campaignID, status)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.loadJSONLocked(); err != nil {
		return nil, err
	}
	out := make([]PromoSubmission, 0, len(r.cache.Submissions))
	for _, item := range r.cache.Submissions {
		if campaignID != "" && item.CampaignID != campaignID {
			continue
		}
		if status != "" && item.Status != status {
			continue
		}
		out = append(out, item)
	}
	return out, nil
}

func (r *PromoRepo) GetSubmission(id string) (*PromoSubmission, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, errors.New("记录不存在")
	}
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.getSubmission(ctx, id)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.loadJSONLocked(); err != nil {
		return nil, err
	}
	for i := range r.cache.Submissions {
		if r.cache.Submissions[i].ID == id {
			copy := r.cache.Submissions[i]
			return &copy, nil
		}
	}
	return nil, errors.New("记录不存在")
}

func (r *PromoRepo) UpdateSubmissionStatus(id, status, adminNote string) (*PromoSubmission, error) {
	id = strings.TrimSpace(id)
	status = strings.TrimSpace(status)
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.updateSubmissionStatus(ctx, id, status, adminNote)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.loadJSONLocked(); err != nil {
		return nil, err
	}
	for i := range r.cache.Submissions {
		if r.cache.Submissions[i].ID != id {
			continue
		}
		r.cache.Submissions[i].Status = status
		r.cache.Submissions[i].AdminNote = strings.TrimSpace(adminNote)
		r.cache.Submissions[i].UpdatedAt = time.Now().UnixMilli()
		copy := r.cache.Submissions[i]
		if err := r.saveJSONLocked(); err != nil {
			return nil, err
		}
		return &copy, nil
	}
	return nil, errors.New("记录不存在")
}

// UpdateSubmissionContent updates fields owned by the applicant. Campaign and
// ownership fields are intentionally immutable. A reviewed/approved submission
// cannot be changed through this path.
func (r *PromoRepo) UpdateSubmissionContent(id, userSerial string, content PromoSubmission) (*PromoSubmission, error) {
	id = strings.TrimSpace(id)
	userSerial = strings.TrimSpace(userSerial)
	if id == "" || userSerial == "" {
		return nil, errors.New("报名记录不存在")
	}
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.updateSubmissionContent(ctx, id, userSerial, content)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.loadJSONLocked(); err != nil {
		return nil, err
	}
	for i := range r.cache.Submissions {
		item := &r.cache.Submissions[i]
		if item.ID != id || item.UserSerial != userSerial {
			continue
		}
		if item.Status != PromoStatusPending && item.Status != PromoStatusRejected {
			return nil, errors.New("该报名已审核通过，不能再修改")
		}
		item.OrderNo = content.OrderNo
		item.OrderScreenshotURL = content.OrderScreenshotURL
		item.InjectionColorNote = content.InjectionColorNote
		item.ShippingAddressEnc = content.ShippingAddressEnc
		item.VideoLink = content.VideoLink
		item.PaymentQrURLEnc = content.PaymentQrURLEnc
		item.Status = PromoStatusPending
		item.AdminNote = ""
		item.UpdatedAt = time.Now().UnixMilli()
		copy := *item
		if err := r.saveJSONLocked(); err != nil {
			return nil, err
		}
		return &copy, nil
	}
	return nil, errors.New("报名记录不存在")
}
