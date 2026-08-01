package main

import (
	"crypto/subtle"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

type adminLoginRequest struct {
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
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请输入密码"})
			return
		}
		submitted := strings.TrimSpace(req.Password)
		panel := strings.TrimSpace(os.Getenv("ADMIN_PANEL_PASSWORD"))
		matchPanel := panel != "" && subtle.ConstantTimeCompare([]byte(submitted), []byte(panel)) == 1
		matchToken := token != "" && subtle.ConstantTimeCompare([]byte(submitted), []byte(token)) == 1
		if !matchPanel && !matchToken {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "密码错误"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "token": token})
	})
}
