package service

import "testing"

func TestFindUploaderSerial(t *testing.T) {
	items := []map[string]any{
		{"id": 2605310117326672, "uploaderSerial": "abc123"},
		{"id": "42", "uploaderSerial": "sn-001"},
	}
	if got := FindUploaderSerial(items, "2605310117326672"); got != "ABC123" {
		t.Fatalf("expected ABC123, got %q", got)
	}
	if got := FindUploaderSerial(items, "42"); got != "SN-001" {
		t.Fatalf("expected SN-001, got %q", got)
	}
	if got := FindUploaderSerial(items, "999"); got != "" {
		t.Fatalf("expected empty, got %q", got)
	}
}

func TestResourceIDsByUploaderSerials(t *testing.T) {
	items := []map[string]any{
		{"id": 1, "uploaderSerial": "sn-a"},
		{"id": "2", "uploaderSerial": "SN-B"},
		{"id": 3, "uploaderSerial": "SN-A"},
		{"id": 4},
	}
	got := ResourceIDsByUploaderSerials(items, []string{"sn-a"})
	if len(got) != 2 || got[0] != "1" || got[1] != "3" {
		t.Fatalf("expected uploader SN-A resource ids [1 3], got %#v", got)
	}
}

func TestPrimaryCatalogAuthorsByUploaderSerialUsesMostFrequentName(t *testing.T) {
	items := []map[string]any{
		{"uploaderSerial": "sn-a", "author": "旧昵称"},
		{"uploaderSerial": "SN-A", "author": "往复循环"},
		{"uploaderSerial": "sn-a", "author": "往复循环"},
		{"uploaderSerial": "sn-b", "author": "另一位作者"},
		{"uploaderSerial": "", "author": "忽略"},
	}
	got := PrimaryCatalogAuthorsByUploaderSerial(items)
	if got["SN-A"] != "往复循环" {
		t.Fatalf("unexpected primary author for SN-A: %q", got["SN-A"])
	}
	if got["SN-B"] != "另一位作者" {
		t.Fatalf("unexpected primary author for SN-B: %q", got["SN-B"])
	}
}

func TestShouldAwardLikeCredit(t *testing.T) {
	if !ShouldAwardLikeCredit("AAA", "BBB") {
		t.Fatal("expected reward for different serials")
	}
	if ShouldAwardLikeCredit("AAA", "aaa") {
		t.Fatal("self-like should not reward")
	}
	if ShouldAwardLikeCredit("", "AAA") {
		t.Fatal("missing uploader should not reward")
	}
}
