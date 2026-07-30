package main

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"jiadian-hub-backend/service"
)

type activityJoinRequest struct {
	ActivityID string `json:"activityId"`
	SN         string `json:"sn"`
}

type activityPrizeInfoRequest struct {
	WinnerID string `json:"winnerId"`
	Name     string `json:"name"`
	Phone    string `json:"phone"`
	Wechat   string `json:"wechat"`
	QQ       string `json:"qq"`
	Province string `json:"province"`
	City     string `json:"city"`
	Address  string `json:"address"`
}

type activityAdminUpsertRequest struct {
	ID               string `json:"id"`
	Title            string `json:"title"`
	Description      string `json:"description"`
	Rule             string `json:"rule"`
	StartTime        int64  `json:"startTime"`
	EndTime          int64  `json:"endTime"`
	Status           string `json:"status"`
	PrizeTitle       string `json:"prizeTitle"`
	PrizeDescription string `json:"prizeDescription"`
	PrizeImage       string `json:"prizeImage"`
	DrawHour         int    `json:"drawHour"`
	DrawMinute       int    `json:"drawMinute"`
	WinnersPerDraw   int    `json:"winnersPerDraw"`
	ShippingDays     int    `json:"shippingDays"`
}

type activityAdminDeviceRequest struct {
	Serial string `json:"serial"`
	Source string `json:"source"`
}

type activityAdminShippingRequest struct {
	ShippingStatus string `json:"shippingStatus"`
}

type activityAdminDrawRequest struct {
	Period string `json:"period"`
	Force  bool   `json:"force"`
}

type activityRouteDeps struct {
	activityService        *service.ActivityService
	reviewAdminToken       string
	jwtSecret              string
	tokenTTL               time.Duration
	activityTokenLimiter   *service.IPRateLimiter
	activityIPLimiter      *service.IPRateLimiter
}

func registerActivityRoutes(router *gin.Engine, deps activityRouteDeps) {
	router.GET("/api/activity/lottery/current", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, deps.jwtSecret, deps.tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		view, err := deps.activityService.GetCurrentPublic(serial)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "activity": view})
	})

	router.POST("/api/activity/lottery/join", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, deps.jwtSecret, deps.tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if rateLimitRejected(c, deps.activityTokenLimiter, deps.activityIPLimiter, serial, "报名请求过于频繁，请稍后再试") {
			return
		}
		var req activityJoinRequest
		if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.SN) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "SN 不能为空"})
			return
		}
		result, err := deps.activityService.Join(service.JoinActivityInput{
			ActivityID: strings.TrimSpace(req.ActivityID),
			SN:         req.SN,
			UserSerial: serial,
			UserIP:     ginClientIP(c),
		})
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "message": result.Message, "joinId": result.JoinID, "drawPeriod": result.DrawPeriod})
	})

	router.GET("/api/activity/lottery/prize-info", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, deps.jwtSecret, deps.tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		payload, err := deps.activityService.GetPrizeInfoStatus(serial)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "data": payload})
	})

	router.POST("/api/activity/lottery/prize-info", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, deps.jwtSecret, deps.tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if rateLimitRejected(c, deps.activityTokenLimiter, deps.activityIPLimiter, serial, "提交过于频繁，请稍后再试") {
			return
		}
		var req activityPrizeInfoRequest
		if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.WinnerID) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "winnerId 不能为空"})
			return
		}
		result, err := deps.activityService.SubmitPrizeInfo(service.SubmitPrizeInfoInput{
			WinnerID:   req.WinnerID,
			UserSerial: serial,
			Info: service.WinnerInfoPlain{
				Name:     req.Name,
				Phone:    req.Phone,
				Wechat:   req.Wechat,
				QQ:       req.QQ,
				Province: req.Province,
				City:     req.City,
				Address:  req.Address,
			},
		})
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "message": result.Message, "shippingDays": result.ShippingDays})
	})

	// Admin APIs
	router.GET("/api/admin/activities", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
			return
		}
		items, err := deps.activityService.RepoListActivities()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "activities": items})
	})

	router.POST("/api/admin/activities", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
			return
		}
		var req activityAdminUpsertRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}
		activity, err := deps.activityService.AdminUpsertActivity(service.ActivityAdminUpsertInput{
			ID:               req.ID,
			Title:            req.Title,
			Description:      req.Description,
			Rule:             req.Rule,
			StartTime:        req.StartTime,
			EndTime:          req.EndTime,
			Status:           req.Status,
			PrizeTitle:       req.PrizeTitle,
			PrizeDescription: req.PrizeDescription,
			PrizeImage:       req.PrizeImage,
			DrawHour:         req.DrawHour,
			DrawMinute:       req.DrawMinute,
			WinnersPerDraw:   req.WinnersPerDraw,
			ShippingDays:     req.ShippingDays,
		})
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "activity": activity})
	})

	router.GET("/api/admin/activities/:id/joins", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
			return
		}
		joins, err := deps.activityService.RepoListJoins(c.Param("id"), 500)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "joins": joins})
	})

	router.GET("/api/admin/activities/:id/winners", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
			return
		}
		winners, err := deps.activityService.RepoListWinners(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "winners": winners})
	})

	router.GET("/api/admin/winners/:id/contact", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
			return
		}
		info, err := deps.activityService.DecryptWinnerInfo(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "contact": info})
	})

	router.POST("/api/admin/winners/:id/shipping", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
			return
		}
		var req activityAdminShippingRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}
		status := strings.TrimSpace(req.ShippingStatus)
		if status != service.ShippingStatusPending && status != service.ShippingStatusShipped {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "shippingStatus 无效"})
			return
		}
		if err := deps.activityService.RepoUpdateWinnerShipping(c.Param("id"), status); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "发货状态已更新"})
	})

	router.POST("/api/admin/activities/:id/draw", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
			return
		}
		var req activityAdminDrawRequest
		_ = c.ShouldBindJSON(&req)
		result, err := deps.activityService.DrawForPeriod(c.Param("id"), strings.TrimSpace(req.Period), req.Force)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "result": result})
	})

	router.GET("/api/admin/devices", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
			return
		}
		devices, err := deps.activityService.RepoListDevices(500)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "devices": devices})
	})

	router.POST("/api/admin/devices", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
			return
		}
		var req activityAdminDeviceRequest
		if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Serial) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "serial 不能为空"})
			return
		}
		if err := deps.activityService.RegisterAuthenticatedDevice(req.Serial, strings.TrimSpace(req.Source)); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "设备已登记"})
	})
}
