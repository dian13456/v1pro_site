package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"jiadian-hub-backend/service"
)

type promoSubmitRequest struct {
	CampaignID         string `json:"campaignId"`
	OrderNo            string `json:"orderNo"`
	OrderScreenshotURL string `json:"orderScreenshotUrl"`
	InjectionColorNote string `json:"injectionColorNote"`
	ShippingAddress    string `json:"shippingAddress"`
	VideoLink          string `json:"videoLink"`
	PaymentQrURL       string `json:"paymentQrUrl"`
}

type promoReviewRequest struct {
	Status    string `json:"status"`
	AdminNote string `json:"adminNote"`
}

type promoRouteDeps struct {
	promoService     *service.PromoService
	reviewAdminToken string
	jwtSecret        string
	tokenTTL         time.Duration
	imageSigner      *service.COSSigner
	imagePublicBase  string
}

func registerPromoRoutes(router *gin.Engine, deps promoRouteDeps) {
	router.GET("/api/activity/promo/overview", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, deps.jwtSecret, deps.tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		overview, err := deps.promoService.GetOverview(serial)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "overview": overview})
	})

	router.GET("/api/activity/promo/submission", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, deps.jwtSecret, deps.tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		result, err := deps.promoService.GetMySubmission(serial)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.Header("Cache-Control", "private, no-store")
		c.JSON(http.StatusOK, gin.H{"success": true, "submission": result})
	})

	router.POST("/api/activity/promo/submission/update", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, deps.jwtSecret, deps.tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		var req promoSubmitRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}
		result, err := deps.promoService.UpdateSubmission(serial, service.PromoSubmissionInput{
			CampaignID:         req.CampaignID,
			OrderNo:            req.OrderNo,
			OrderScreenshotURL: req.OrderScreenshotURL,
			InjectionColorNote: req.InjectionColorNote,
			ShippingAddress:    req.ShippingAddress,
			VideoLink:          req.VideoLink,
			PaymentQrURL:       req.PaymentQrURL,
		})
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.Header("Cache-Control", "private, no-store")
		c.JSON(http.StatusOK, gin.H{
			"success":    true,
			"message":    "资料已更新，已重新进入待审核",
			"submission": result,
		})
	})

	router.POST("/api/activity/promo/submit", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, deps.jwtSecret, deps.tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		var req promoSubmitRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}
		result, err := deps.promoService.Submit(serial, service.PromoSubmissionInput{
			CampaignID:         req.CampaignID,
			OrderNo:            req.OrderNo,
			OrderScreenshotURL: req.OrderScreenshotURL,
			InjectionColorNote: req.InjectionColorNote,
			ShippingAddress:    req.ShippingAddress,
			VideoLink:          req.VideoLink,
			PaymentQrURL:       req.PaymentQrURL,
		})
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "提交成功，请等待工作人员审核", "submission": result})
	})

	router.POST("/api/activity/promo/upload-image", func(c *gin.Context) {
		token := parseBearerToken(c)
		if _, ok := serialFromToken(token, deps.jwtSecret, deps.tokenTTL); !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if deps.imageSigner == nil || strings.TrimSpace(deps.imagePublicBase) == "" {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "图片存储未配置"})
			return
		}
		fileHeader, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请选择要上传的图片"})
			return
		}
		if fileHeader.Size <= 0 || fileHeader.Size > 5*1024*1024 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "图片大小需在 5MB 以内"})
			return
		}
		ext := strings.ToLower(filepath.Ext(fileHeader.Filename))
		contentType := ""
		switch ext {
		case ".jpg", ".jpeg":
			contentType = "image/jpeg"
			ext = ".jpg"
		case ".png":
			contentType = "image/png"
		case ".webp":
			contentType = "image/webp"
		default:
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "仅支持 JPG / PNG / WEBP"})
			return
		}
		file, err := fileHeader.Open()
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "读取图片失败"})
			return
		}
		defer file.Close()
		data, err := io.ReadAll(io.LimitReader(file, 5*1024*1024+1))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "读取图片失败"})
			return
		}
		if len(data) == 0 || len(data) > 5*1024*1024 {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "图片大小需在 5MB 以内"})
			return
		}
		buf := make([]byte, 8)
		if _, err := rand.Read(buf); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "生成文件名失败"})
			return
		}
		objectKey := fmt.Sprintf("activity/promo/%d_%s%s", time.Now().UnixMilli(), hex.EncodeToString(buf), ext)
		if err := deps.imageSigner.UploadObject(c.Request.Context(), objectKey, contentType, data); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "上传图片失败"})
			return
		}
		imageURL := strings.TrimRight(deps.imagePublicBase, "/") + "/" + objectKey
		c.JSON(http.StatusOK, gin.H{"success": true, "imageUrl": imageURL})
	})

	router.GET("/api/admin/promo/submissions", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
			return
		}
		items, err := deps.promoService.ListAdminSubmissions(
			strings.TrimSpace(c.Query("campaignId")),
			strings.TrimSpace(c.Query("status")),
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "submissions": items})
	})

	router.GET("/api/admin/promo/submissions/:id", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
			return
		}
		item, err := deps.promoService.GetAdminSubmission(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "submission": item})
	})

	router.POST("/api/admin/promo/submissions/:id/review", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
			return
		}
		var req promoReviewRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}
		item, err := deps.promoService.ReviewSubmission(c.Param("id"), req.Status, req.AdminNote)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "submission": item})
	})
}
