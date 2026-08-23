package service

import (
	"fmt"
	"sort"
)

// ResourceTransferDefaults stores the uploader's recommended WebUSB transfer
// settings with the resource. Older catalog entries simply omit this object.
type ResourceTransferDefaults struct {
	TargetFrameCapacities []int  `json:"targetFrameCapacities"`
	VideoFPS              int    `json:"videoFps"`
	FitMode               string `json:"fitMode"`
	RotationDeg           int    `json:"rotationDeg"`
	ColorProfile          string `json:"colorProfile"`
}

func NormalizeResourceTransferDefaults(input *ResourceTransferDefaults) (*ResourceTransferDefaults, error) {
	if input == nil {
		return nil, nil
	}

	allowedCapacities := map[int]bool{77: true, 154: true, 308: true}
	seenCapacities := map[int]bool{}
	capacities := make([]int, 0, len(input.TargetFrameCapacities))
	for _, capacity := range input.TargetFrameCapacities {
		if !allowedCapacities[capacity] {
			return nil, fmt.Errorf("目标设备容量无效")
		}
		if !seenCapacities[capacity] {
			seenCapacities[capacity] = true
			capacities = append(capacities, capacity)
		}
	}
	if len(capacities) == 0 {
		return nil, fmt.Errorf("请至少选择一种目标设备容量")
	}
	sort.Ints(capacities)

	if input.VideoFPS != 20 && input.VideoFPS != 25 && input.VideoFPS != 30 {
		return nil, fmt.Errorf("视频帧率无效")
	}
	if input.FitMode != "fill" && input.FitMode != "contain" {
		return nil, fmt.Errorf("画面显示方式无效")
	}
	if input.RotationDeg != 0 && input.RotationDeg != 90 && input.RotationDeg != 180 && input.RotationDeg != 270 {
		return nil, fmt.Errorf("画面方向无效")
	}
	if input.ColorProfile != "normal" && input.ColorProfile != "vivid" && input.ColorProfile != "professional" {
		return nil, fmt.Errorf("素材色彩参数无效")
	}

	return &ResourceTransferDefaults{
		TargetFrameCapacities: capacities,
		VideoFPS:              input.VideoFPS,
		FitMode:               input.FitMode,
		RotationDeg:           input.RotationDeg,
		ColorProfile:          input.ColorProfile,
	}, nil
}
