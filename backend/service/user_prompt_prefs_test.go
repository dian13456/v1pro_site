package service

import "testing"

func TestSoftwarePromptDismissedID(t *testing.T) {
	store := UserPromptPrefsStore{SoftwareDismissed: map[string]int64{}}
	if got := GetSoftwarePromptDismissedID(store, "ABC"); got != 0 {
		t.Fatalf("expected 0, got %d", got)
	}
	if got := SetSoftwarePromptDismissedID(&store, "ABC", 2605310147021006); got != 2605310147021006 {
		t.Fatalf("unexpected set result: %d", got)
	}
	if got := GetSoftwarePromptDismissedID(store, "ABC"); got != 2605310147021006 {
		t.Fatalf("expected stored id, got %d", got)
	}
}
