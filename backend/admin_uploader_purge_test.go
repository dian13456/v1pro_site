package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAdminPurgeConfirmationValid(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want bool
	}{
		{name: "boolean true", raw: `true`, want: true},
		{name: "boolean false", raw: `false`, want: false},
		{name: "purge keyword", raw: `"purge"`, want: true},
		{name: "delete and ban keyword", raw: `"DELETE_AND_BAN"`, want: true},
		{name: "wrong keyword", raw: `"yes"`, want: false},
		{name: "number", raw: `1`, want: false},
		{name: "empty", raw: ``, want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var raw json.RawMessage
			if tc.raw != "" {
				raw = json.RawMessage(tc.raw)
			}
			if got := adminPurgeConfirmationValid(raw); got != tc.want {
				t.Fatalf("adminPurgeConfirmationValid(%s)=%v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}

func TestMaskUploaderSerial(t *testing.T) {
	masked, suffix := maskUploaderSerial("e339e3397e29bd7014ecabcd")
	if suffix != "ABCD" {
		t.Fatalf("suffix=%q, want ABCD", suffix)
	}
	if masked == "E339E3397E29BD7014ECABCD" || !strings.Contains(masked, "ABCD") {
		t.Fatalf("masked serial leaks or omits suffix: %q", masked)
	}
	short, shortSuffix := maskUploaderSerial("abcd")
	if short != "ABCD" || shortSuffix != "ABCD" {
		t.Fatalf("short serial mask=%q suffix=%q", short, shortSuffix)
	}
	empty, emptySuffix := maskUploaderSerial("  ")
	if empty != "" || emptySuffix != "" {
		t.Fatalf("empty serial mask=%q suffix=%q", empty, emptySuffix)
	}
}
