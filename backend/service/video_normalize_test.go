package service

import "testing"

func TestVideoNeedsWebNormalization(t *testing.T) {
	hevc := []byte("....ftyp....hvc1....")
	if !videoNeedsWebNormalization(hevc) {
		t.Fatal("expected HEVC to require normalization")
	}

	hi10p := make([]byte, 64)
	copy(hi10p, []byte("....avcC...."))
	hi10p[12] = 110
	if !videoNeedsWebNormalization(hi10p) {
		t.Fatal("expected Hi10P to require normalization")
	}

	compatible := []byte("....ftyp....avc1....avcC....")
	if videoNeedsWebNormalization(compatible) {
		t.Fatal("expected compatible sample to skip normalization")
	}
}

func TestMp4ObjectKey(t *testing.T) {
	if got := mp4ObjectKey("vid_20260101120000_abcd.mov"); got != "vid_20260101120000_abcd.mp4" {
		t.Fatalf("unexpected mp4 key: %q", got)
	}
	if got := mp4ObjectKey("vid_20260101120000_abcd.mp4"); got != "vid_20260101120000_abcd.mp4" {
		t.Fatalf("expected mp4 key unchanged, got %q", got)
	}
}
