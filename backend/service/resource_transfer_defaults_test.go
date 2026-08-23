package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestNormalizeResourceTransferDefaults(t *testing.T) {
	got, err := NormalizeResourceTransferDefaults(&ResourceTransferDefaults{
		TargetFrameCapacities: []int{308, 77, 154, 77},
		VideoFPS:              25,
		FitMode:               "contain",
		RotationDeg:           90,
		ColorProfile:          "vivid",
	})
	if err != nil {
		t.Fatalf("normalize failed: %v", err)
	}
	if !reflect.DeepEqual(got.TargetFrameCapacities, []int{77, 154, 308}) {
		t.Fatalf("unexpected capacities: %#v", got.TargetFrameCapacities)
	}
	if got.VideoFPS != 25 || got.FitMode != "contain" || got.RotationDeg != 90 || got.ColorProfile != "vivid" {
		t.Fatalf("unexpected normalized defaults: %#v", got)
	}
}

func TestNormalizeResourceTransferDefaultsAllowsLegacyMissingValue(t *testing.T) {
	got, err := NormalizeResourceTransferDefaults(nil)
	if err != nil || got != nil {
		t.Fatalf("legacy missing defaults should remain valid, got %#v, err %v", got, err)
	}
}

func TestNormalizeResourceTransferDefaultsRejectsInvalidValues(t *testing.T) {
	tests := []ResourceTransferDefaults{
		{TargetFrameCapacities: []int{}, VideoFPS: 25, FitMode: "fill", ColorProfile: "normal"},
		{TargetFrameCapacities: []int{100}, VideoFPS: 25, FitMode: "fill", ColorProfile: "normal"},
		{TargetFrameCapacities: []int{77}, VideoFPS: 24, FitMode: "fill", ColorProfile: "normal"},
		{TargetFrameCapacities: []int{77}, VideoFPS: 25, FitMode: "crop", ColorProfile: "normal"},
		{TargetFrameCapacities: []int{77}, VideoFPS: 25, FitMode: "fill", RotationDeg: 45, ColorProfile: "normal"},
		{TargetFrameCapacities: []int{77}, VideoFPS: 25, FitMode: "fill", ColorProfile: "unknown"},
	}
	for index := range tests {
		if _, err := NormalizeResourceTransferDefaults(&tests[index]); err == nil {
			t.Fatalf("case %d should be rejected", index)
		}
	}
}

func TestShareUserVideoToCatalogPersistsTransferDefaults(t *testing.T) {
	dir := t.TempDir()
	resourcesPath := filepath.Join(dir, "resources.json")
	resourceMapPath := filepath.Join(dir, "resource_map.json")
	imageMapPath := filepath.Join(dir, "image_map.json")
	for path, content := range map[string]string{
		resourcesPath:   "[]\n",
		resourceMapPath: "{}\n",
		imageMapPath:    "{}\n",
	} {
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatalf("write fixture %s: %v", path, err)
		}
	}

	_, err := ShareUserVideoToCatalog(resourcesPath, resourceMapPath, imageMapPath, ShareUserVideoInput{
		Title:          "参数同步测试",
		Description:    "参数同步测试",
		VideoObjectKey: "videos/test.mp4",
		CoverObjectKey: "covers/test.jpg",
		TransferDefaults: &ResourceTransferDefaults{
			TargetFrameCapacities: []int{77, 308},
			VideoFPS:              30,
			FitMode:               "contain",
			RotationDeg:           270,
			ColorProfile:          "professional",
		},
	})
	if err != nil {
		t.Fatalf("share video: %v", err)
	}

	raw, err := os.ReadFile(resourcesPath)
	if err != nil {
		t.Fatalf("read catalog: %v", err)
	}
	var resources []map[string]any
	if err := json.Unmarshal(raw, &resources); err != nil {
		t.Fatalf("decode catalog: %v", err)
	}
	if len(resources) != 1 {
		t.Fatalf("expected one resource, got %d", len(resources))
	}
	defaults, ok := resources[0]["transferDefaults"].(map[string]any)
	if !ok {
		t.Fatalf("transferDefaults missing from catalog: %#v", resources[0])
	}
	if defaults["videoFps"] != float64(30) || defaults["fitMode"] != "contain" || defaults["rotationDeg"] != float64(270) || defaults["colorProfile"] != "professional" {
		t.Fatalf("unexpected persisted defaults: %#v", defaults)
	}
}
