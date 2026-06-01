package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type WelcomeContext struct {
	Username    string
	Greeting    string
	City        string
	Region      string
	Country     string
	Timezone    string
	LocalTime   string
	Temperature float64
	WeatherText string
}

type WelcomeResult struct {
	Message     string `json:"message"`
	Username    string `json:"username"`
	City        string `json:"city"`
	Region      string `json:"region"`
	LocalTime   string `json:"localTime"`
	Temperature int    `json:"temperature"`
	WeatherText string `json:"weatherText"`
}

type ipWhoResponse struct {
	Success   bool    `json:"success"`
	City      string  `json:"city"`
	Region    string  `json:"region"`
	Country   string  `json:"country"`
	Timezone  string  `json:"timezone"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}

type openMeteoResponse struct {
	Current struct {
		Temperature float64 `json:"temperature_2m"`
		WeatherCode int     `json:"weather_code"`
	} `json:"current"`
}

func DisplayUsernameFromSerial(serial string) string {
	s := strings.TrimSpace(serial)
	if s == "" {
		return "用户"
	}
	runes := []rune(s)
	if len(runes) <= 10 {
		return s
	}
	return string(runes[len(runes)-10:])
}

func NormalizeDisplayName(serial, requested string) string {
	name := strings.TrimSpace(requested)
	if name == "" {
		return DisplayUsernameFromSerial(serial)
	}
	runes := []rune(name)
	if len(runes) > 20 {
		return string(runes[:20])
	}
	return name
}

func ClientIP(remoteAddr string, forwardedFor string, realIP string) string {
	if realIP = strings.TrimSpace(realIP); realIP != "" {
		return realIP
	}
	if forwardedFor = strings.TrimSpace(forwardedFor); forwardedFor != "" {
		parts := strings.Split(forwardedFor, ",")
		if len(parts) > 0 {
			return strings.TrimSpace(parts[0])
		}
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(remoteAddr))
	if err == nil && host != "" {
		return host
	}
	return strings.TrimSpace(remoteAddr)
}

func isPrivateIP(ip string) bool {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return true
	}
	return parsed.IsLoopback() || parsed.IsPrivate() || parsed.IsUnspecified()
}

func fetchGeoByIP(ctx context.Context, client *http.Client, ip string) (ipWhoResponse, error) {
	url := "https://ipwho.is/" + ip + "?lang=zh-CN"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return ipWhoResponse{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return ipWhoResponse{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return ipWhoResponse{}, err
	}
	var payload ipWhoResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return ipWhoResponse{}, err
	}
	if !payload.Success {
		return ipWhoResponse{}, fmt.Errorf("geo lookup failed")
	}
	return payload, nil
}

func fetchWeather(ctx context.Context, client *http.Client, lat, lon float64, timezone string) (float64, int, error) {
	if timezone == "" {
		timezone = "auto"
	}
	url := fmt.Sprintf(
		"https://api.open-meteo.com/v1/forecast?latitude=%f&longitude=%f&current=temperature_2m,weather_code&timezone=%s",
		lat, lon, url.QueryEscape(timezone),
	)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, 0, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, 0, err
	}
	var payload openMeteoResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return 0, 0, err
	}
	return payload.Current.Temperature, payload.Current.WeatherCode, nil
}

func weatherText(code int) string {
	switch code {
	case 0:
		return "晴朗"
	case 1, 2, 3:
		return "多云"
	case 45, 48:
		return "有雾"
	case 51, 53, 55, 56, 57:
		return "小雨"
	case 61, 63, 65, 66, 67, 80, 81, 82:
		return "下雨"
	case 71, 73, 75, 77, 85, 86:
		return "下雪"
	case 95, 96, 99:
		return "雷雨"
	default:
		return "天气不错"
	}
}

func timeGreeting(hour int) string {
	switch {
	case hour >= 5 && hour < 9:
		return "早上好"
	case hour >= 9 && hour < 12:
		return "上午好"
	case hour >= 12 && hour < 14:
		return "中午好"
	case hour >= 14 && hour < 18:
		return "下午好"
	case hour >= 18 && hour < 23:
		return "晚上好"
	default:
		return "夜深了"
	}
}

func formatLocalTime(t time.Time) string {
	weekdays := []string{"周日", "周一", "周二", "周三", "周四", "周五", "周六"}
	return fmt.Sprintf("%s %02d:%02d", weekdays[int(t.Weekday())], t.Hour(), t.Minute())
}

func BuildWelcomeMessage(ctx WelcomeContext) string {
	greeting := ctx.Greeting
	if greeting == "" {
		greeting = "你好"
	}
	location := strings.TrimSpace(ctx.City)
	if location == "" {
		location = strings.TrimSpace(ctx.Region)
	}
	if location == "" {
		location = "你的城市"
	}

	parts := []string{
		fmt.Sprintf("%s，%s！", greeting, ctx.Username),
		"欢迎来到佳点电子资源中心。",
	}
	if ctx.LocalTime != "" {
		parts = append(parts, fmt.Sprintf("现在是 %s。", ctx.LocalTime))
	}
	if ctx.WeatherText != "" && ctx.Temperature != 0 {
		parts = append(parts, fmt.Sprintf("你所在的位置（%s）%s，气温 %.0f℃。", location, ctx.WeatherText, ctx.Temperature))
	} else if location != "你的城市" {
		parts = append(parts, fmt.Sprintf("检测到你现在位于 %s。", location))
	}
	parts = append(parts, "祝你今天挑选到心仪的 1.9 寸横屏素材。")
	return strings.Join(parts, "")
}

func GenerateWelcome(ctx context.Context, serial, displayName, clientIP string) WelcomeResult {
	username := NormalizeDisplayName(serial, displayName)
	geo := ipWhoResponse{
		City:     "",
		Region:   "",
		Country:  "中国",
		Timezone: "Asia/Shanghai",
		Latitude: 22.5431,
		Longitude: 114.0579,
	}

	client := &http.Client{Timeout: 8 * time.Second}
	if clientIP != "" && !isPrivateIP(clientIP) {
		if lookedUp, err := fetchGeoByIP(ctx, client, clientIP); err == nil {
			geo = lookedUp
		}
	}

	loc, err := time.LoadLocation(geo.Timezone)
	if err != nil || loc == nil {
		loc = time.FixedZone("CST", 8*3600)
	}
	now := time.Now().In(loc)
	localTime := formatLocalTime(now)

	temp := 0.0
	weatherCode := 0
	if geo.Latitude != 0 || geo.Longitude != 0 {
		if t, code, err := fetchWeather(ctx, client, geo.Latitude, geo.Longitude, geo.Timezone); err == nil {
			temp = t
			weatherCode = code
		}
	}

	wctx := WelcomeContext{
		Username:    username,
		Greeting:    timeGreeting(now.Hour()),
		City:        geo.City,
		Region:      geo.Region,
		Country:     geo.Country,
		Timezone:    geo.Timezone,
		LocalTime:   localTime,
		Temperature: temp,
		WeatherText: weatherText(weatherCode),
	}

	return WelcomeResult{
		Message:     BuildWelcomeMessage(wctx),
		Username:    username,
		City:        geo.City,
		Region:      geo.Region,
		LocalTime:   localTime,
		Temperature: int(temp),
		WeatherText: wctx.WeatherText,
	}
}
