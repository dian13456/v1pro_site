package main

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

type adminLoginRequest struct {
	Password string `json:"password"`
}

func registerAdminRoutes(router *gin.Engine, reviewAdminToken, adminPanelPassword string) {
	router.POST("/api/admin/login", func(c *gin.Context) {
		token := strings.TrimSpace(reviewAdminToken)
		password := strings.TrimSpace(adminPanelPassword)
		if password == "" {
			password = token
		}
		if token == "" || password == "" {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "管理员后台未配置"})
			return
		}
		var req adminLoginRequest
		if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Password) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请输入密码"})
			return
		}
		if subtle.ConstantTimeCompare([]byte(req.Password), []byte(password)) != 0 {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "密码错误"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "token": token})
	})
}
