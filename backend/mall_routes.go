package main

import (
	"net/http"
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
