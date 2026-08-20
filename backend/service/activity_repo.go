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

type ActivityRepo struct {
	backend string
	path    string
	mysql   *activityMySQLStore
	mu      sync.Mutex
	cache   ActivityDataStore
	loaded  bool
}

type ActivityJoinConflict string

const (
	ActivityJoinConflictNone ActivityJoinConflict = ""
	ActivityJoinConflictSN   ActivityJoinConflict = "sn"
	ActivityJoinConflictIP   ActivityJoinConflict = "ip"
)

func NewActivityRepo(configDir string) (*ActivityRepo, error) {
	if strings.TrimSpace(configDir) == "" {
		configDir = "config"
	}
	backend := strings.ToLower(strings.TrimSpace(os.Getenv("STORAGE_BACKEND")))
	if backend == "" {
		backend = "json"
	}
	repo := &ActivityRepo{
		backend: backend,
		path:    filepath.Join(configDir, "activity_lottery.json"),
	}
	if backend == "mysql" {
		store, err := openActivityMySQLStore(os.Getenv("MYSQL_DSN"))
		if err != nil {
			return nil, err
		}
		repo.mysql = store
	}
	return repo, nil
}

func (r *ActivityRepo) Close() error {
	if r == nil || r.mysql == nil {
		return nil
	}
	return r.mysql.Close()
}

func (r *ActivityRepo) UsesMySQL() bool {
	return r != nil && r.backend == "mysql" && r.mysql != nil
}

func (r *ActivityRepo) ctx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 12*time.Second)
}

func (r *ActivityRepo) loadJSONLocked() error {
	if r.loaded {
		return nil
	}
	raw, err := os.ReadFile(r.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			r.cache = ActivityDataStore{
				Activities: []Activity{DefaultActivity()},
				Joins:      []ActivityJoin{},
				Winners:    []Winner{},
				WinnerInfo: []WinnerInfo{},
				Devices:    []DeviceRegistryEntry{},
				DrawLog:    []DrawLogEntry{},
			}
			r.loaded = true
			return r.saveJSONLocked()
		}
		return err
	}
	if strings.TrimSpace(string(raw)) == "" {
		r.cache = ActivityDataStore{
			Activities: []Activity{DefaultActivity()},
			Joins:      []ActivityJoin{},
			Winners:    []Winner{},
			WinnerInfo: []WinnerInfo{},
			Devices:    []DeviceRegistryEntry{},
			DrawLog:    []DrawLogEntry{},
		}
		r.loaded = true
		return r.saveJSONLocked()
	}
	var store ActivityDataStore
	if err := json.Unmarshal(raw, &store); err != nil {
		return err
	}
	if len(store.Activities) == 0 {
		store.Activities = []Activity{DefaultActivity()}
	}
	if store.Joins == nil {
		store.Joins = []ActivityJoin{}
	}
	if store.Winners == nil {
		store.Winners = []Winner{}
	}
	if store.WinnerInfo == nil {
		store.WinnerInfo = []WinnerInfo{}
	}
	if store.Devices == nil {
		store.Devices = []DeviceRegistryEntry{}
	}
	if store.DrawLog == nil {
		store.DrawLog = []DrawLogEntry{}
	}
	r.cache = store
	r.loaded = true
	return nil
}

func (r *ActivityRepo) saveJSONLocked() error {
	if err := os.MkdirAll(filepath.Dir(r.path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(r.cache, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(r.path, raw, 0o644)
}

func (r *ActivityRepo) withJSON(mutate func(*ActivityDataStore) error) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.loadJSONLocked(); err != nil {
		return err
	}
	if err := mutate(&r.cache); err != nil {
		return err
	}
	return r.saveJSONLocked()
}

func (r *ActivityRepo) ListActivities() ([]Activity, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.listActivities(ctx)
	}
	var out []Activity
	err := r.withJSON(func(store *ActivityDataStore) error {
		out = append([]Activity(nil), store.Activities...)
		return nil
	})
	return out, err
}

func (r *ActivityRepo) GetActivity(id string) (Activity, bool, error) {
	id = strings.TrimSpace(id)
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.getActivity(ctx, id)
	}
	var activity Activity
	found := false
	err := r.withJSON(func(store *ActivityDataStore) error {
		for _, item := range store.Activities {
			if item.ID == id {
				activity = item
				found = true
				return nil
			}
		}
		return nil
	})
	return activity, found, err
}

func (r *ActivityRepo) GetActiveActivity() (Activity, bool, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.getActiveActivity(ctx)
	}
	now := time.Now().UnixMilli()
	var activity Activity
	found := false
	err := r.withJSON(func(store *ActivityDataStore) error {
		for _, item := range store.Activities {
			if item.Status != ActivityStatusActive {
				continue
			}
			if item.StartTime > now || (item.EndTime > 0 && item.EndTime < now) {
				continue
			}
			activity = item
			found = true
			return nil
		}
		return nil
	})
	return activity, found, err
}

func (r *ActivityRepo) SaveActivity(activity Activity) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.saveActivity(ctx, activity)
	}
	return r.withJSON(func(store *ActivityDataStore) error {
		for i, item := range store.Activities {
			if item.ID == activity.ID {
				store.Activities[i] = activity
				return nil
			}
		}
		store.Activities = append(store.Activities, activity)
		return nil
	})
}

func (r *ActivityRepo) CountJoins(activityID string) (int64, error) {
	return r.CountJoinsByPeriod(activityID, DrawPeriodKey(time.Now()))
}

func (r *ActivityRepo) CountJoinsByPeriod(activityID, period string) (int64, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.countJoinsByPeriod(ctx, activityID, period)
	}
	var count int64
	err := r.withJSON(func(store *ActivityDataStore) error {
		for _, join := range store.Joins {
			if join.ActivityID == activityID && join.DrawPeriod == period {
				count++
			}
		}
		return nil
	})
	return count, err
}

func (r *ActivityRepo) ClearJoinsExceptPeriod(activityID, period string) (int64, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.clearJoinsExceptPeriod(ctx, activityID, period)
	}
	var removed int64
	err := r.withJSON(func(store *ActivityDataStore) error {
		kept := make([]ActivityJoin, 0, len(store.Joins))
		for _, join := range store.Joins {
			if join.ActivityID == activityID && join.DrawPeriod != period {
				removed++
				continue
			}
			kept = append(kept, join)
		}
		store.Joins = kept
		return nil
	})
	return removed, err
}

func (r *ActivityRepo) HasJoinInPeriod(activityID, sn, period string) (bool, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.hasJoinInPeriod(ctx, activityID, sn, period)
	}
	found := false
	err := r.withJSON(func(store *ActivityDataStore) error {
		for _, join := range store.Joins {
			if join.ActivityID == activityID && join.SN == sn && join.DrawPeriod == period {
				found = true
				return nil
			}
		}
		return nil
	})
	return found, err
}

func (r *ActivityRepo) HasUserJoinedInPeriod(activityID, userSerial, period string) (bool, string, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.hasUserJoinedInPeriod(ctx, activityID, userSerial, period)
	}
	var joinedSN string
	found := false
	err := r.withJSON(func(store *ActivityDataStore) error {
		for _, join := range store.Joins {
			if join.ActivityID == activityID && join.UserSerial == userSerial && join.DrawPeriod == period {
				found = true
				joinedSN = join.SN
				return nil
			}
		}
		return nil
	})
	return found, joinedSN, err
}

func (r *ActivityRepo) AddJoin(join ActivityJoin) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.addJoin(ctx, join)
	}
	return r.withJSON(func(store *ActivityDataStore) error {
		store.Joins = append(store.Joins, join)
		return nil
	})
}

// AddJoinIfEligible performs the duplicate checks and insert under one lock so
// concurrent requests cannot bypass the per-period SN or IP limits.
func (r *ActivityRepo) AddJoinIfEligible(join ActivityJoin) (ActivityJoinConflict, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		hasSN, err := r.mysql.hasJoinInPeriod(ctx, join.ActivityID, join.SN, join.DrawPeriod)
		if err != nil {
			return ActivityJoinConflictNone, err
		}
		if hasSN {
			return ActivityJoinConflictSN, nil
		}
		if join.UserIP != "" {
			hasIP, err := r.mysql.hasIPJoinInPeriod(ctx, join.ActivityID, join.UserIP, join.DrawPeriod)
			if err != nil {
				return ActivityJoinConflictNone, err
			}
			if hasIP {
				return ActivityJoinConflictIP, nil
			}
		}
		if err := r.mysql.addJoin(ctx, join); err != nil {
			return ActivityJoinConflictNone, err
		}
		return ActivityJoinConflictNone, nil
	}

	if err := r.loadJSONLocked(); err != nil {
		return ActivityJoinConflictNone, err
	}
	for _, existing := range r.cache.Joins {
		if existing.ActivityID != join.ActivityID || existing.DrawPeriod != join.DrawPeriod {
			continue
		}
		if existing.SN == join.SN {
			return ActivityJoinConflictSN, nil
		}
		if join.UserIP != "" && existing.UserIP == join.UserIP {
			return ActivityJoinConflictIP, nil
		}
	}
	r.cache.Joins = append(r.cache.Joins, join)
	if err := r.saveJSONLocked(); err != nil {
		return ActivityJoinConflictNone, err
	}
	return ActivityJoinConflictNone, nil
}

func (r *ActivityRepo) ListJoins(activityID string, limit int) ([]ActivityJoin, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.listJoins(ctx, activityID, limit)
	}
	var out []ActivityJoin
	err := r.withJSON(func(store *ActivityDataStore) error {
		for i := len(store.Joins) - 1; i >= 0; i-- {
			if store.Joins[i].ActivityID != activityID {
				continue
			}
			out = append(out, store.Joins[i])
			if limit > 0 && len(out) >= limit {
				break
			}
		}
		return nil
	})
	return out, err
}

func (r *ActivityRepo) ListJoinsByPeriod(activityID, period string) ([]ActivityJoin, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.listJoinsByPeriod(ctx, activityID, period)
	}
	var out []ActivityJoin
	err := r.withJSON(func(store *ActivityDataStore) error {
		for _, join := range store.Joins {
			if join.ActivityID == activityID && join.DrawPeriod == period && join.Status == JoinStatusActive {
				out = append(out, join)
			}
		}
		return nil
	})
	return out, err
}

func (r *ActivityRepo) HasWinnerSN(activityID, sn string) (bool, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.hasWinnerSN(ctx, activityID, sn)
	}
	found := false
	err := r.withJSON(func(store *ActivityDataStore) error {
		for _, winner := range store.Winners {
			if winner.ActivityID == activityID && winner.SN == sn {
				found = true
				return nil
			}
		}
		return nil
	})
	return found, err
}

func (r *ActivityRepo) AddWinner(winner Winner) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.addWinner(ctx, winner)
	}
	return r.withJSON(func(store *ActivityDataStore) error {
		store.Winners = append(store.Winners, winner)
		return nil
	})
}

func (r *ActivityRepo) UpdateJoinStatus(joinID, status string) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.updateJoinStatus(ctx, joinID, status)
	}
	return r.withJSON(func(store *ActivityDataStore) error {
		for i, join := range store.Joins {
			if join.ID == joinID {
				store.Joins[i].Status = status
				return nil
			}
		}
		return nil
	})
}

func (r *ActivityRepo) MarkJoinsLost(activityID, period string, winnerJoinIDs map[string]struct{}) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.markJoinsLost(ctx, activityID, period, winnerJoinIDs)
	}
	return r.withJSON(func(store *ActivityDataStore) error {
		for i, join := range store.Joins {
			if join.ActivityID != activityID || join.DrawPeriod != period {
				continue
			}
			if _, ok := winnerJoinIDs[join.ID]; ok {
				store.Joins[i].Status = JoinStatusWon
				continue
			}
			if join.Status == JoinStatusActive {
				store.Joins[i].Status = JoinStatusLost
			}
		}
		return nil
	})
}

func (r *ActivityRepo) HasDrawnPeriod(activityID, period string) (bool, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.hasDrawnPeriod(ctx, activityID, period)
	}
	found := false
	err := r.withJSON(func(store *ActivityDataStore) error {
		for _, entry := range store.DrawLog {
			if entry.ActivityID == activityID && entry.DrawPeriod == period {
				found = true
				return nil
			}
		}
		return nil
	})
	return found, err
}

func (r *ActivityRepo) AddDrawLog(entry DrawLogEntry) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.addDrawLog(ctx, entry)
	}
	return r.withJSON(func(store *ActivityDataStore) error {
		store.DrawLog = append(store.DrawLog, entry)
		return nil
	})
}

func (r *ActivityRepo) GetWinnerByUser(activityID, userSerial string) (Winner, bool, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.getWinnerByUser(ctx, activityID, userSerial)
	}
	var winner Winner
	found := false
	err := r.withJSON(func(store *ActivityDataStore) error {
		for _, item := range store.Winners {
			if item.ActivityID == activityID && item.UserSerial == userSerial {
				winner = item
				found = true
				return nil
			}
		}
		return nil
	})
	return winner, found, err
}

func (r *ActivityRepo) GetWinner(id string) (Winner, bool, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.getWinner(ctx, id)
	}
	var winner Winner
	found := false
	err := r.withJSON(func(store *ActivityDataStore) error {
		for _, item := range store.Winners {
			if item.ID == id {
				winner = item
				found = true
				return nil
			}
		}
		return nil
	})
	return winner, found, err
}

func (r *ActivityRepo) ListWinners(activityID string) ([]Winner, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.listWinners(ctx, activityID)
	}
	var out []Winner
	err := r.withJSON(func(store *ActivityDataStore) error {
		for i := len(store.Winners) - 1; i >= 0; i-- {
			if store.Winners[i].ActivityID == activityID {
				out = append(out, store.Winners[i])
			}
		}
		return nil
	})
	return out, err
}

func (r *ActivityRepo) UpdateWinnerShipping(id, shippingStatus, trackingNo string) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.updateWinnerShipping(ctx, id, shippingStatus, trackingNo)
	}
	return r.withJSON(func(store *ActivityDataStore) error {
		for i, winner := range store.Winners {
			if winner.ID == id {
				store.Winners[i].ShippingStatus = shippingStatus
				if strings.TrimSpace(trackingNo) != "" {
					store.Winners[i].TrackingNo = trackingNo
				}
				return nil
			}
		}
		return nil
	})
}

func (r *ActivityRepo) UpdateWinnerContact(id, contactStatus string) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.updateWinnerContact(ctx, id, contactStatus)
	}
	return r.withJSON(func(store *ActivityDataStore) error {
		for i, winner := range store.Winners {
			if winner.ID == id {
				store.Winners[i].ContactStatus = contactStatus
				return nil
			}
		}
		return nil
	})
}

func (r *ActivityRepo) HasWinnerInfo(winnerID string) (bool, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.hasWinnerInfo(ctx, winnerID)
	}
	found := false
	err := r.withJSON(func(store *ActivityDataStore) error {
		for _, info := range store.WinnerInfo {
			if info.WinnerID == winnerID {
				found = true
				return nil
			}
		}
		return nil
	})
	return found, err
}

func (r *ActivityRepo) AddWinnerInfo(info WinnerInfo) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.addWinnerInfo(ctx, info)
	}
	return r.withJSON(func(store *ActivityDataStore) error {
		store.WinnerInfo = append(store.WinnerInfo, info)
		return nil
	})
}

func (r *ActivityRepo) GetWinnerInfo(winnerID string) (WinnerInfo, bool, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.getWinnerInfo(ctx, winnerID)
	}
	var info WinnerInfo
	found := false
	err := r.withJSON(func(store *ActivityDataStore) error {
		for _, item := range store.WinnerInfo {
			if item.WinnerID == winnerID {
				info = item
				found = true
				return nil
			}
		}
		return nil
	})
	return info, found, err
}

func (r *ActivityRepo) IsRegisteredDevice(sn string) (bool, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.isRegisteredDevice(ctx, sn)
	}
	found := false
	err := r.withJSON(func(store *ActivityDataStore) error {
		for _, device := range store.Devices {
			if device.Serial == sn {
				found = true
				return nil
			}
		}
		return nil
	})
	return found, err
}

func (r *ActivityRepo) RegisterDevice(entry DeviceRegistryEntry) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.registerDevice(ctx, entry)
	}
	return r.withJSON(func(store *ActivityDataStore) error {
		for _, device := range store.Devices {
			if device.Serial == entry.Serial {
				return nil
			}
		}
		store.Devices = append(store.Devices, entry)
		return nil
	})
}

func (r *ActivityRepo) GetDevice(sn string) (DeviceRegistryEntry, bool, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.getDevice(ctx, sn)
	}
	var entry DeviceRegistryEntry
	found := false
	err := r.withJSON(func(store *ActivityDataStore) error {
		for _, device := range store.Devices {
			if device.Serial == sn {
				entry = device
				found = true
				break
			}
		}
		return nil
	})
	return entry, found, err
}

func (r *ActivityRepo) ActivateDeviceFeatures(sn string, activatedAt int64) error {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.activateDeviceFeatures(ctx, sn, activatedAt)
	}
	return r.withJSON(func(store *ActivityDataStore) error {
		for i := range store.Devices {
			if store.Devices[i].Serial == sn {
				if store.Devices[i].ActivatedAt <= 0 {
					store.Devices[i].ActivatedAt = activatedAt
				}
				return nil
			}
		}
		return errors.New("设备尚未登记")
	})
}

func (r *ActivityRepo) ListDevices(limit int) ([]DeviceRegistryEntry, error) {
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.listDevices(ctx, limit)
	}
	var out []DeviceRegistryEntry
	err := r.withJSON(func(store *ActivityDataStore) error {
		for i := len(store.Devices) - 1; i >= 0; i-- {
			out = append(out, store.Devices[i])
			if limit > 0 && len(out) >= limit {
				break
			}
		}
		return nil
	})
	return out, err
}

func NewActivityID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}
