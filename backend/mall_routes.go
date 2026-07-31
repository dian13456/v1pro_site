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

type mallCreateOrderRequest struct {
	Items []struct {
		ProductID string `json:"productId"`
		Quantity  int    `json:"quantity"`
	} `json:"items"`
	Name     string `json:"name"`
	Phone    string `json:"phone"`
	Wechat   string `json:"wechat"`
	QQ       string `json:"qq"`
	Province string `json:"province"`
	City     string `json:"city"`
	Address  string `json:"address"`
	Remark   string `json:"remark"`
}

type mallProductUpsertRequest struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
	ImageURL    string `json:"imageUrl"`
	PriceCents  int64  `json:"priceCents"`
	Stock       int    `json:"stock"`
	Status      string `json:"status"`
	SortOrder   int    `json:"sortOrder"`
}

type mallOrderStatusRequest struct {
	Status     string `json:"status"`
	TrackingNo string `json:"trackingNo"`
}

type mallRouteDeps struct {
	mallService      *service.MallService
	reviewAdminToken string
	jwtSecret        string
	tokenTTL         time.Duration
	imageSigner      *service.COSSigner
	imagePublicBase  string
}

func registerMallRoutes(router *gin.Engine, deps mallRouteDeps) {
	router.GET("/api/mall/products", func(c *gin.Context) {
		token := parseBearerToken(c)
		if _, ok := serialFromToken(token, deps.jwtSecret, deps.tokenTTL); !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		items, err := deps.mallService.ListPublicProducts()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "products": items})
	})

	router.POST("/api/mall/orders", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, deps.jwtSecret, deps.tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		var req mallCreateOrderRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}
		items := make([]service.MallOrderItem, 0, len(req.Items))
		for _, item := range req.Items {
			items = append(items, service.MallOrderItem{
				ProductID: strings.TrimSpace(item.ProductID),
				Quantity:  item.Quantity,
			})
		}
		order, err := deps.mallService.CreateOrder(service.MallCreateOrderInput{
			UserSerial: serial,
			Items:      items,
			Shipping: service.MallShippingPlain{
				Name: req.Name, Phone: req.Phone, Wechat: req.Wechat, QQ: req.QQ,
				Province: req.Province, City: req.City, Address: req.Address,
			},
			Remark: req.Remark,
		})
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "下单成功。当前为人工收款模式，请按页面说明完成付款，管理员确认后发货。",
			"order":   order,
		})
	})

	router.GET("/api/mall/orders", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, deps.jwtSecret, deps.tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		orders, err := deps.mallService.ListMyOrders(serial)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "orders": orders})
	})

	router.GET("/api/mall/orders/:id", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, deps.jwtSecret, deps.tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		order, err := deps.mallService.GetMyOrder(serial, c.Param("id"))
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "order": order})
	})

	router.GET("/api/admin/mall/products", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
			return
		}
		items, err := deps.mallService.ListAdminProducts()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "products": items})
	})

	router.POST("/api/admin/mall/products", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
			return
		}
		var req mallProductUpsertRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}
		product, err := deps.mallService.UpsertProduct(service.MallProduct{
			ID: req.ID, Title: req.Title, Description: req.Description, ImageURL: req.ImageURL,
			PriceCents: req.PriceCents, Stock: req.Stock, Status: req.Status, SortOrder: req.SortOrder,
		})
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "product": product})
	})

	router.POST("/api/admin/mall/upload-image", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
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
		objectKey := fmt.Sprintf("mall/products/%d_%s%s", time.Now().UnixMilli(), hex.EncodeToString(buf), ext)
		if err := deps.imageSigner.UploadObject(c.Request.Context(), objectKey, contentType, data); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "上传图片失败"})
			return
		}
		imageURL := strings.TrimRight(deps.imagePublicBase, "/") + "/" + objectKey
		c.JSON(http.StatusOK, gin.H{"success": true, "imageUrl": imageURL})
	})

	router.GET("/api/admin/mall/orders", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
			return
		}
		orders, err := deps.mallService.ListAdminOrders()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
			return
		}
		// Never return encrypted blobs to admin list; strip enc fields.
		safe := make([]gin.H, 0, len(orders))
		for _, o := range orders {
			safe = append(safe, gin.H{
				"id": o.ID, "userSerial": o.UserSerial, "status": o.Status, "items": o.Items,
				"totalCents": o.TotalCents, "province": o.Province, "city": o.City,
				"trackingNo": o.TrackingNo, "remark": o.Remark,
				"createdAt": o.CreatedAt, "updatedAt": o.UpdatedAt,
				"paidAt": o.PaidAt, "shippedAt": o.ShippedAt,
				"hasAddress": strings.TrimSpace(o.NameEnc) != "",
			})
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "orders": safe})
	})

	router.GET("/api/admin/mall/orders/:id/contact", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
			return
		}
		info, err := deps.mallService.DecryptOrderContact(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "contact": info})
	})

	router.POST("/api/admin/mall/orders/:id/status", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
			return
		}
		var req mallOrderStatusRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}
		order, err := deps.mallService.UpdateOrderStatus(c.Param("id"), req.Status, req.TrackingNo)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "order": order})
	})
}
