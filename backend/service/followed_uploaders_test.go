package service

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestFollowedUploaderSerialsForDeviceNewestFirst(t *testing.T) {
	store := FollowedUploadersStore{DeviceFollowed: map[string]map[string]int64{
		"VIEWER": {
			"SN-OLDER": 10,
			"SN-NEWER": 20,
		},
	}}
	want := []string{"SN-NEWER", "SN-OLDER"}
	if got := FollowedUploaderSerialsForDevice(store, "VIEWER"); !reflect.DeepEqual(got, want) {
		t.Fatalf("followed uploaders = %#v, want %#v", got, want)
	}
}

func TestUserDataRepoJSONUploaderFollows(t *testing.T) {
	repo, err := NewUserDataRepo(UserDataPaths{
		FollowedUploadersPath: filepath.Join(t.TempDir(), "followed_uploaders.json"),
	})
	if err != nil {
		t.Fatal(err)
	}

	got, err := repo.SetUploaderFollowed("viewer", "uploader-a", true)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []string{"UPLOADER-A"}) {
		t.Fatalf("after follow = %#v", got)
	}

	got, err = repo.SetUploaderFollowed("viewer", "uploader-a", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("after unfollow = %#v, want empty", got)
	}
}
