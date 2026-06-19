package main

import (
	"bufio"
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"strings"

	"jiadian-hub-backend/service"
)

func loadEnv(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		if os.Getenv(key) == "" {
			_ = os.Setenv(key, val)
		}
	}
	return sc.Err()
}

func main() {
	envPath := "/opt/jiadian-hub/app/backend/.env"
	if len(os.Args) > 1 {
		envPath = os.Args[1]
	}
	if err := loadEnv(envPath); err != nil {
		fmt.Printf("load env failed: %v\n", err)
		os.Exit(1)
	}

	secretID := strings.TrimSpace(os.Getenv("IMS_SECRET_ID"))
	secretKey := strings.TrimSpace(os.Getenv("IMS_SECRET_KEY"))
	if secretID == "" {
		secretID = strings.TrimSpace(os.Getenv("COS_SECRET_ID"))
	}
	if secretKey == "" {
		secretKey = strings.TrimSpace(os.Getenv("COS_SECRET_KEY"))
	}
	region := strings.TrimSpace(os.Getenv("IMS_REGION"))
	bizType := strings.TrimSpace(os.Getenv("IMS_BIZ_TYPE"))
	enabled := !strings.EqualFold(strings.TrimSpace(os.Getenv("IMS_ENABLED")), "false")

	client, err := service.NewImageModerationClient(
		secretID,
		secretKey,
		region,
		bizType,
		enabled,
		service.DefaultGifModerationConfig(),
	)
	if err != nil {
		fmt.Printf("init failed: %v\n", err)
		os.Exit(1)
	}
	if !client.Available() {
		fmt.Println("IMS client not available (check IMS_ENABLED and secrets)")
		os.Exit(1)
	}

	// 128x128 JPEG — IMS 拒绝过小图片
	img := image.NewRGBA(image.Rect(0, 0, 128, 128))
	for y := 0; y < 128; y++ {
		for x := 0; x < 128; x++ {
			img.Set(x, y, color.RGBA{240, 240, 240, 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
		fmt.Printf("encode jpeg failed: %v\n", err)
		os.Exit(1)
	}
	jpeg := buf.Bytes()

	modType := "IMAGE"
	if len(os.Args) > 2 {
		modType = os.Args[2]
	}

	outcome, err := client.ModerateImageBytesDetailed(nil, jpeg, "smoke-test", modType)
	if err != nil {
		fmt.Printf("IMS call failed type=%s: %v\n", modType, err)
		os.Exit(1)
	}
	fmt.Printf("IMS ok type=%s: suggestion=%s label=%s subLabel=%s score=%d bizType=%s\n",
		modType, outcome.Suggestion, outcome.Label, outcome.SubLabel, outcome.Score, bizType)
}
