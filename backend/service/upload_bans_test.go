package service

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestUploadBanStoreNormalizeAndRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "upload_bans.json")
	store := NewEmptyUploadBanStore()
	entry, err := store.SetBanned("  e339abcd  ", true, "违规上传", "operator")
	if err != nil {
		t.Fatalf("set ban: %v", err)
	}
	if entry.Serial != "E339ABCD" || !store.IsBanned("e339abcd") {
		t.Fatalf("expected normalized active ban, entry=%+v store=%+v", entry, store)
	}
	if err := SaveUploadBanStore(path, store); err != nil {
		t.Fatalf("save: %v", err)
	}
	loaded, err := LoadUploadBanStore(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	loadedEntry, ok := loaded.Get("E339ABCD")
	if !ok || loadedEntry.Reason != "违规上传" || loadedEntry.AdminActor != "operator" {
		t.Fatalf("round trip lost metadata: %+v, ok=%v", loadedEntry, ok)
	}
	if _, err := loaded.SetBanned("e339abcd", false, "", ""); err != nil {
		t.Fatalf("unban: %v", err)
	}
	if loaded.IsBanned("E339ABCD") {
		t.Fatal("expected unban to remove active entry")
	}
	if err := SaveUploadBanStore(path, loaded); err != nil {
		t.Fatalf("save unban: %v", err)
	}
	loaded, err = LoadUploadBanStore(path)
	if err != nil {
		t.Fatalf("reload unban: %v", err)
	}
	if loaded.IsBanned("e339abcd") {
		t.Fatal("unban was not persisted")
	}
}

func TestUploadBanStoreMissingAndMalformed(t *testing.T) {
	missing, err := LoadUploadBanStore(filepath.Join(t.TempDir(), "missing.json"))
	if err != nil {
		t.Fatalf("missing file should be empty: %v", err)
	}
	if missing.IsBanned("SN") {
		t.Fatal("missing file unexpectedly contains a ban")
	}
	path := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(path, []byte("not-json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadUploadBanStore(path); err == nil {
		t.Fatal("malformed file should return an error")
	}
}

func TestUserDataRepoUploaderBanJSONIsIdempotentAndConcurrent(t *testing.T) {
	t.Setenv("STORAGE_BACKEND", "json")
	path := filepath.Join(t.TempDir(), "upload_bans.json")
	repo, err := NewUserDataRepo(UserDataPaths{UploadBansPath: path})
	if err != nil {
		t.Fatalf("new repo: %v", err)
	}
	defer repo.Close()
	if banned, err := repo.IsUploaderBanned("sn-1"); err != nil || banned {
		t.Fatalf("new repo should allow uploader: banned=%v err=%v", banned, err)
	}
	if err := repo.SetUploaderBanWithMetadata(" sn-1 ", true, "test", "admin"); err != nil {
		t.Fatalf("set ban: %v", err)
	}
	if banned, err := repo.IsUploaderBanned("SN-1"); err != nil || !banned {
		t.Fatalf("expected active ban: banned=%v err=%v", banned, err)
	}
	entry, ok, err := repo.GetUploaderBan("sn-1")
	if err != nil || !ok || entry.Reason != "test" {
		t.Fatalf("get metadata: entry=%+v ok=%v err=%v", entry, ok, err)
	}
	// Repeating the same operation must not create duplicate map entries.
	if err := repo.SetUploaderBanned("SN-1", true); err != nil {
		t.Fatalf("idempotent set: %v", err)
	}
	store, err := LoadUploadBanStore(path)
	if err != nil {
		t.Fatalf("load store: %v", err)
	}
	if len(store.Bans) != 1 {
		t.Fatalf("expected one active ban, got %d", len(store.Bans))
	}

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := repo.SetUploaderBanned("sn-1", true); err != nil {
				t.Errorf("concurrent set: %v", err)
			}
		}()
	}
	wg.Wait()
	if banned, err := repo.IsUploaderBanned("SN-1"); err != nil || !banned {
		t.Fatalf("concurrent set lost ban: banned=%v err=%v", banned, err)
	}
	if err := repo.SetUploaderBanned("sn-1", false); err != nil {
		t.Fatalf("unban: %v", err)
	}
	if banned, err := repo.IsUploaderBanned("SN-1"); err != nil || banned {
		t.Fatalf("expected unbanned: banned=%v err=%v", banned, err)
	}
}

func TestUserDataRepoUploaderBanRejectsEmptySerial(t *testing.T) {
	t.Setenv("STORAGE_BACKEND", "json")
	repo, err := NewUserDataRepo(UserDataPaths{UploadBansPath: filepath.Join(t.TempDir(), "upload_bans.json")})
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	if _, err := repo.IsUploaderBanned(" "); err == nil {
		t.Fatal("empty serial should fail IsUploaderBanned")
	}
	if err := repo.SetUploaderBanned(" ", true); err == nil {
		t.Fatal("empty serial should fail SetUploaderBanned")
	}
}
