package service

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"
)

type UserDataPaths struct {
	LikesPath       string
	FavoritesPath   string
	DownloadsPath   string
	MessagesPath    string
	ProfilesPath    string
	PromptPrefsPath string
	CreditsPath     string
	SharesPath      string
}

type UserDataRepo struct {
	backend string
	paths   UserDataPaths
	mysql   *mysqlStore
}

func NewUserDataRepo(paths UserDataPaths) (*UserDataRepo, error) {
	backend := strings.ToLower(strings.TrimSpace(os.Getenv("STORAGE_BACKEND")))
	if backend == "" {
		backend = "json"
	}
	repo := &UserDataRepo{
		backend: backend,
		paths:   paths,
	}
	if backend == "mysql" {
		mysqlStore, err := openMySQLStore(os.Getenv("MYSQL_DSN"))
		if err != nil {
			return nil, err
		}
		repo.mysql = mysqlStore
	}
	return repo, nil
}

func (r *UserDataRepo) Close() error {
	if r == nil || r.mysql == nil {
		return nil
	}
	return r.mysql.Close()
}

func (r *UserDataRepo) UsesMySQL() bool {
	return r != nil && r.backend == "mysql" && r.mysql != nil
}

func (r *UserDataRepo) ctx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 10*time.Second)
}

func (r *UserDataRepo) LoadLikes() (LikesStore, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.loadLikes(ctx)
	}
	return loadLikesJSON(r.paths.LikesPath)
}

func (r *UserDataRepo) SaveLikes(store LikesStore) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.saveLikes(ctx, store)
	}
	return saveLikesJSON(r.paths.LikesPath, store)
}

// ApplyDeviceLike atomically records one device like and returns the updated count.
func (r *UserDataRepo) ApplyDeviceLike(serial, resourceID string) (DeviceLikeResult, error) {
	serial = NormalizeLikeSerial(serial)
	resourceID = strings.TrimSpace(resourceID)
	if serial == "" || resourceID == "" {
		return DeviceLikeResult{}, fmt.Errorf("serial or resourceId empty")
	}
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.applyDeviceLike(ctx, serial, resourceID)
	}
	return DeviceLikeResult{}, fmt.Errorf("ApplyDeviceLike requires mysql backend")
}

func (r *UserDataRepo) LoadFavorites() (FavoritesStore, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.loadFavorites(ctx)
	}
	return loadFavoritesJSON(r.paths.FavoritesPath)
}

func (r *UserDataRepo) SaveFavorites(store FavoritesStore) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.saveFavorites(ctx, store)
	}
	return saveFavoritesJSON(r.paths.FavoritesPath, store)
}

func (r *UserDataRepo) LoadDownloads() (DownloadsStore, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.loadDownloads(ctx)
	}
	return loadDownloadsJSON(r.paths.DownloadsPath)
}

func (r *UserDataRepo) SaveDownloads(store DownloadsStore) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.saveDownloads(ctx, store)
	}
	return saveDownloadsJSON(r.paths.DownloadsPath, store)
}

func (r *UserDataRepo) LoadMessages() (MessagesStore, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.loadMessages(ctx)
	}
	return loadMessagesJSON(r.paths.MessagesPath)
}

func (r *UserDataRepo) SaveMessages(store MessagesStore) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.saveMessages(ctx, store)
	}
	return saveMessagesJSON(r.paths.MessagesPath, store)
}

func (r *UserDataRepo) LoadUserProfiles() (UserProfilesStore, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.loadUserProfiles(ctx)
	}
	return LoadUserProfiles(r.paths.ProfilesPath)
}

func (r *UserDataRepo) SaveUserProfiles(store UserProfilesStore) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.saveUserProfiles(ctx, store)
	}
	return SaveUserProfiles(r.paths.ProfilesPath, store)
}

func (r *UserDataRepo) LoadUserPromptPrefs() (UserPromptPrefsStore, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.loadUserPromptPrefs(ctx)
	}
	return LoadUserPromptPrefs(r.paths.PromptPrefsPath)
}

func (r *UserDataRepo) SaveUserPromptPrefs(store UserPromptPrefsStore) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.saveUserPromptPrefs(ctx, store)
	}
	return SaveUserPromptPrefs(r.paths.PromptPrefsPath, store)
}

func (r *UserDataRepo) LoadAICredits() (AICreditsStore, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.loadAICredits(ctx)
	}
	return LoadAICreditsStore(r.paths.CreditsPath)
}

func (r *UserDataRepo) SaveAICredits(store AICreditsStore) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.saveAICredits(ctx, store)
	}
	return SaveAICreditsStore(r.paths.CreditsPath, store)
}

func (r *UserDataRepo) LoadAIShareQuota() (AIShareQuotaStore, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.loadAIShareQuota(ctx)
	}
	return LoadAIShareQuotaStore(r.paths.SharesPath)
}

func (r *UserDataRepo) SaveAIShareQuota(store AIShareQuotaStore) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.saveAIShareQuota(ctx, store)
	}
	return SaveAIShareQuotaStore(r.paths.SharesPath, store)
}

func (r *UserDataRepo) TryReloadAICredits(current *AICreditsStore) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		latest, err := r.mysql.loadAICredits(ctx)
		if err != nil {
			return err
		}
		*current = latest
		return nil
	}
	var lastMod time.Time
	return TryReloadAICreditsStore(r.paths.CreditsPath, current, &lastMod)
}

func (r *UserDataRepo) TryReloadAIShareQuota(current *AIShareQuotaStore) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		latest, err := r.mysql.loadAIShareQuota(ctx)
		if err != nil {
			return err
		}
		*current = latest
		return nil
	}
	var lastMod time.Time
	return TryReloadAIShareQuotaStore(r.paths.SharesPath, current, &lastMod)
}

// ImportJSONFiles imports existing JSON config files into MySQL (one-time migration).
func (r *UserDataRepo) ImportJSONFiles() error {
	if !r.UsesMySQL() {
		return fmt.Errorf("STORAGE_BACKEND 不是 mysql")
	}
	likes, err := loadLikesJSON(r.paths.LikesPath)
	if err != nil {
		return fmt.Errorf("likes: %w", err)
	}
	if err := r.SaveLikes(likes); err != nil {
		return fmt.Errorf("save likes: %w", err)
	}
	favorites, err := loadFavoritesJSON(r.paths.FavoritesPath)
	if err != nil {
		return fmt.Errorf("favorites: %w", err)
	}
	if err := r.SaveFavorites(favorites); err != nil {
		return fmt.Errorf("save favorites: %w", err)
	}
	downloads, err := loadDownloadsJSON(r.paths.DownloadsPath)
	if err != nil {
		return fmt.Errorf("downloads: %w", err)
	}
	if err := r.SaveDownloads(downloads); err != nil {
		return fmt.Errorf("save downloads: %w", err)
	}
	messages, err := loadMessagesJSON(r.paths.MessagesPath)
	if err != nil {
		return fmt.Errorf("messages: %w", err)
	}
	if err := r.SaveMessages(messages); err != nil {
		return fmt.Errorf("save messages: %w", err)
	}
	profiles, err := LoadUserProfiles(r.paths.ProfilesPath)
	if err != nil {
		return fmt.Errorf("profiles: %w", err)
	}
	if err := r.SaveUserProfiles(profiles); err != nil {
		return fmt.Errorf("save profiles: %w", err)
	}
	credits, err := LoadAICreditsStore(r.paths.CreditsPath)
	if err != nil {
		return fmt.Errorf("credits: %w", err)
	}
	if err := r.SaveAICredits(credits); err != nil {
		return fmt.Errorf("save credits: %w", err)
	}
	shares, err := LoadAIShareQuotaStore(r.paths.SharesPath)
	if err != nil {
		return fmt.Errorf("shares: %w", err)
	}
	if err := r.SaveAIShareQuota(shares); err != nil {
		return fmt.Errorf("save shares: %w", err)
	}
	return nil
}
