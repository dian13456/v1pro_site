package service

import (
	"fmt"
	"sync"
	"testing"
)

func TestAddJoinIfEligibleRejectsConcurrentIPDuplicates(t *testing.T) {
	t.Setenv("STORAGE_BACKEND", "json")
	repo, err := NewActivityRepo(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()

	const requests = 24
	start := make(chan struct{})
	results := make(chan ActivityJoinConflict, requests)
	errors := make(chan error, requests)
	var wg sync.WaitGroup
	for i := 0; i < requests; i++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			<-start
			conflict, addErr := repo.AddJoinIfEligible(ActivityJoin{
				ID:         fmt.Sprintf("join-%d", index),
				ActivityID: "activity-ip-limit",
				SN:         fmt.Sprintf("SN-%d", index),
				UserIP:     "203.0.113.10",
				DrawPeriod: "2026-08-14",
			})
			if addErr != nil {
				errors <- addErr
				return
			}
			results <- conflict
		}(i)
	}
	close(start)
	wg.Wait()
	close(results)
	close(errors)

	for addErr := range errors {
		t.Fatalf("concurrent add failed: %v", addErr)
	}
	added := 0
	ipConflicts := 0
	for conflict := range results {
		switch conflict {
		case ActivityJoinConflictNone:
			added++
		case ActivityJoinConflictIP:
			ipConflicts++
		default:
			t.Fatalf("unexpected conflict: %q", conflict)
		}
	}
	if added != 1 || ipConflicts != requests-1 {
		t.Fatalf("got added=%d ipConflicts=%d, want 1 and %d", added, ipConflicts, requests-1)
	}
}

func TestAddJoinIfEligibleSeparatesSNAndIPLimitsByPeriod(t *testing.T) {
	t.Setenv("STORAGE_BACKEND", "json")
	repo, err := NewActivityRepo(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()

	base := ActivityJoin{ID: "one", ActivityID: "activity", SN: "SN-A", UserIP: "198.51.100.8", DrawPeriod: "2026-08-14"}
	if conflict, err := repo.AddJoinIfEligible(base); err != nil || conflict != ActivityJoinConflictNone {
		t.Fatalf("first add conflict=%q err=%v", conflict, err)
	}
	if conflict, err := repo.AddJoinIfEligible(ActivityJoin{ID: "two", ActivityID: "activity", SN: "SN-A", UserIP: "198.51.100.9", DrawPeriod: "2026-08-14"}); err != nil || conflict != ActivityJoinConflictSN {
		t.Fatalf("same SN conflict=%q err=%v", conflict, err)
	}
	if conflict, err := repo.AddJoinIfEligible(ActivityJoin{ID: "three", ActivityID: "activity", SN: "SN-B", UserIP: "198.51.100.8", DrawPeriod: "2026-08-14"}); err != nil || conflict != ActivityJoinConflictIP {
		t.Fatalf("same IP conflict=%q err=%v", conflict, err)
	}
	if conflict, err := repo.AddJoinIfEligible(ActivityJoin{ID: "four", ActivityID: "activity", SN: "SN-A", UserIP: "198.51.100.8", DrawPeriod: "2026-08-15"}); err != nil || conflict != ActivityJoinConflictNone {
		t.Fatalf("next period conflict=%q err=%v", conflict, err)
	}
}

func TestNormalizeActivityIP(t *testing.T) {
	tests := map[string]string{
		" 203.0.113.9:443 ":  "203.0.113.9",
		"::ffff:192.0.2.4":   "192.0.2.4",
		"[2001:db8::1]:8080": "2001:db8::1",
		"":                   "",
	}
	for input, want := range tests {
		if got := NormalizeActivityIP(input); got != want {
			t.Errorf("NormalizeActivityIP(%q)=%q, want %q", input, got, want)
		}
	}
}
