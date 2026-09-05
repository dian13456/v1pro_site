package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const adminSessionTTL = 8 * time.Hour

func issueAdminSession(secret, username string, now time.Time) string {
	exp := now.Add(adminSessionTTL).Unix()
	payload := username + "." + strconv.FormatInt(exp, 10)
	h := hmac.New(sha256.New, []byte(secret))
	_, _ = h.Write([]byte(payload))
	sig := base64.RawURLEncoding.EncodeToString(h.Sum(nil))
	return "v1." + base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + sig
}

func validateAdminSession(token, secret string, now time.Time) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != "v1" || secret == "" { return false }
	payload, err := base64.RawURLEncoding.DecodeString(parts[1]); if err != nil { return false }
	fields := strings.Split(string(payload), "."); if len(fields) != 2 { return false }
	exp, err := strconv.ParseInt(fields[1], 10, 64); if err != nil || now.Unix() >= exp { return false }
	h := hmac.New(sha256.New, []byte(secret)); _, _ = h.Write(payload)
	expected := base64.RawURLEncoding.EncodeToString(h.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(expected), []byte(parts[2])) == 1
}

type adminLoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func registerAdminRoutes(router *gin.Engine, reviewAdminToken string) {
	router.POST("/api/admin/login", func(c *gin.Context) {
		token := strings.TrimSpace(reviewAdminToken)
		if token == "" {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "管理员后台未配置"})
			return
		}
		var req adminLoginRequest
		if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Password) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请输入管理员账号和密码"})
			return
		}
		configuredUsername := strings.TrimSpace(os.Getenv("ADMIN_PANEL_USERNAME"))
		if configuredUsername == "" {
			configuredUsername = "admin"
		}
		submittedUsername := strings.TrimSpace(req.Username)
		if submittedUsername == "" || subtle.ConstantTimeCompare([]byte(submittedUsername), []byte(configuredUsername)) != 1 {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "管理员账号或密码错误"})
			return
		}
		submitted := strings.TrimSpace(req.Password)
		panel := strings.TrimSpace(os.Getenv("ADMIN_PANEL_PASSWORD"))
		matchPanel := panel != "" && subtle.ConstantTimeCompare([]byte(submitted), []byte(panel)) == 1
		if !matchPanel {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "管理员账号或密码错误"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "token": issueAdminSession(token, configuredUsername, time.Now().UTC()), "expiresIn": int(adminSessionTTL.Seconds())})
	})
}
