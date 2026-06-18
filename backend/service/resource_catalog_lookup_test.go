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
