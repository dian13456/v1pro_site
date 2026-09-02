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
	Name          string `json:"name"`
	Phone         string `json:"phone"`
	Wechat        string `json:"wechat"`
	QQ            string `json:"qq"`
	Province      string `json:"province"`
	City          string `json:"city"`
	Address       string `json:"address"`
	Remark        string `json:"remark"`
	PaymentMethod string `json:"paymentMethod"`
}

type mallWechatPayRequest struct {
	Mode string `json:"mode"`
}

type mallProductUpsertRequest struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	ImageURL    string   `json:"imageUrl"`
	ImageURLs   []string `json:"imageUrls"`
	PriceCents  int64    `json:"priceCents"`
	Stock       int      `json:"stock"`
	Status      string   `json:"status"`
	SortOrder   int      `json:"sortOrder"`
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
	imageCOSBucket   string
	imagePublicBase  string
	imageSignTTL     time.Duration
	wechatPay        *service.WeChatPayClient
	paymentExpire    time.Duration
}

func ensureMallImageAccess(c *gin.Context, deps mallRouteDeps) bool {
	token := parseBearerToken(c)
	if _, ok := serialFromToken(token, deps.jwtSecret, deps.tokenTTL); ok {
		return true
	}
	return ensureReviewAdmin(c, deps.reviewAdminToken)
}

func signMallProductsForResponse(c *gin.Context, deps mallRouteDeps, items []service.MallProduct) []service.MallProduct {
	out := make([]service.MallProduct, len(items))
	copy(out, items)
	for i := range out {
		service.SignMallProductImages(c.Request.Context(), deps.imageSigner, deps.imagePublicBase, deps.imageCOSBucket, deps.imageSignTTL, &out[i])
	}
	return out
}

func signMallPublicProductsForResponse(c *gin.Context, deps mallRouteDeps, items []service.MallProductPublic) []service.MallProductPublic {
	out := make([]service.MallProductPublic, len(items))
	copy(out, items)
	for i := range out {
		product := service.MallProduct{
			ImageURL:  out[i].ImageURL,
			ImageURLs: out[i].ImageURLs,
		}
		service.SignMallProductImages(c.Request.Context(), deps.imageSigner, deps.imagePublicBase, deps.imageCOSBucket, deps.imageSignTTL, &product)
		out[i].ImageURL = product.ImageURL
		out[i].ImageURLs = product.ImageURLs
	}
	return out
}

func registerMallRoutes(router *gin.Engine, deps mallRouteDeps) {
	router.GET("/api/mall/payment/config", func(c *gin.Context) {
		token := parseBearerToken(c)
		if _, ok := serialFromToken(token, deps.jwtSecret, deps.tokenTTL); !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		expireMinutes := int(deps.paymentExpire / time.Minute)
		capabilities := service.WeChatPayCapabilities{Enabled: false, Modes: []string{}, ExpireMin: expireMinutes}
		if deps.wechatPay != nil {
			capabilities = deps.wechatPay.Capabilities(expireMinutes)
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "wechatPay": capabilities})
	})

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
		c.JSON(http.StatusOK, gin.H{"success": true, "products": signMallPublicProductsForResponse(c, deps, items)})
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
		paymentMethod := strings.ToLower(strings.TrimSpace(req.PaymentMethod))
		if paymentMethod == "" {
			paymentMethod = "wechat"
		}
		if paymentMethod != "wechat" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "实物商城当前仅支持微信在线支付"})
			return
		}
		if deps.wechatPay == nil || !deps.wechatPay.Available() {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "微信在线支付尚未启用，请稍后再试"})
			return
		}
		paymentExpire := deps.paymentExpire
		if paymentExpire <= 0 {
			paymentExpire = 15 * time.Minute
		}
		order, err := deps.mallService.CreateOrder(service.MallCreateOrderInput{
			UserSerial: serial,
			Items:      items,
			Shipping: service.MallShippingPlain{
				Name: req.Name, Phone: req.Phone, Wechat: req.Wechat, QQ: req.QQ,
				Province: req.Province, City: req.City, Address: req.Address,
			},
			Remark:           req.Remark,
			PaymentMethod:    paymentMethod,
			PaymentExpiresAt: time.Now().Add(paymentExpire).UnixMilli(),
		})
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"success": true,
			"message": "订单已创建，请在有效期内完成微信支付。",
			"order":   order,
		})
	})

	router.POST("/api/mall/orders/:id/wechat-pay", func(c *gin.Context) {
		token := parseBearerToken(c)
		serial, ok := serialFromToken(token, deps.jwtSecret, deps.tokenTTL)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "token 无效"})
			return
		}
		if deps.wechatPay == nil || !deps.wechatPay.Available() {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "微信在线支付尚未启用"})
			return
		}
		var req mallWechatPayRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "请求格式错误"})
			return
		}
		order, err := deps.mallService.PrepareWechatPayment(serial, c.Param("id"), req.Mode)
		if err != nil {
			c.JSON(http.StatusConflict, gin.H{"success": false, "message": err.Error()})
			return
		}
		description := "佳点电子实物商城订单"
		if len(order.Items) > 0 && strings.TrimSpace(order.Items[0].Title) != "" {
			description = "佳点电子-" + strings.TrimSpace(order.Items[0].Title)
		}
		clientIP := service.ClientIP(c.Request.RemoteAddr, c.GetHeader("X-Forwarded-For"), c.GetHeader("X-Real-IP"))
		payment, err := deps.wechatPay.CreatePayment(c.Request.Context(), order, req.Mode, clientIP, description)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "payment": payment, "order": order})
	})

	router.POST("/api/mall/orders/:id/cancel", func(c *gin.Context) {
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
		if order.PaymentMethod != "wechat" || order.Status != service.MallOrderPendingPay {
			c.JSON(http.StatusConflict, gin.H{"success": false, "message": "当前订单不可取消"})
			return
		}
		if deps.wechatPay == nil || !deps.wechatPay.Available() {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "微信支付服务不可用，暂时不能安全释放库存"})
			return
		}
		transaction, queryErr := deps.wechatPay.QueryTransaction(c.Request.Context(), order.PaymentTradeNo)
		if queryErr != nil && !service.IsWeChatPayAPIError(queryErr, "ORDER_NOT_EXIST") {
			c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "暂时无法确认微信支付状态，请稍后重试"})
			return
		}
		if queryErr == nil {
			switch transaction.TradeState {
			case "SUCCESS":
				paidOrder, markErr := deps.mallService.MarkWechatOrderPaid(transaction.OutTradeNo, transaction.TransactionID, transaction.Amount.Total)
				if markErr != nil {
					c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": markErr.Error()})
					return
				}
				c.JSON(http.StatusConflict, gin.H{"success": false, "message": "订单已经付款，不能取消", "order": paidOrder})
				return
			case "NOTPAY":
				if err := deps.wechatPay.CloseTransaction(c.Request.Context(), order.PaymentTradeNo); err != nil {
					c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "关闭微信支付订单失败，请稍后重试"})
					return
				}
			case "CLOSED", "REVOKED", "PAYERROR":
				// These states cannot become a successful payment, so reserved stock may be released.
			case "USERPAYING":
				c.JSON(http.StatusConflict, gin.H{"success": false, "message": "微信正在确认付款，请稍后再取消"})
				return
			case "REFUND":
				c.JSON(http.StatusConflict, gin.H{"success": false, "message": "订单已进入退款流程，请联系客服处理"})
				return
			default:
				c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "微信返回了未知支付状态，暂时不能释放库存"})
				return
			}
		}
		cancelled, err := deps.mallService.CancelMyPendingOrder(serial, order.ID)
		if err != nil {
			c.JSON(http.StatusConflict, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "订单已取消，库存已释放", "order": cancelled})
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

	router.POST("/api/mall/payments/wechat/notify", func(c *gin.Context) {
		if deps.wechatPay == nil || !deps.wechatPay.Available() {
			c.JSON(http.StatusServiceUnavailable, gin.H{"code": "FAIL", "message": "微信支付未配置"})
			return
		}
		body, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
		if err != nil || len(body) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"code": "FAIL", "message": "回调内容无效"})
			return
		}
		transaction, err := deps.wechatPay.ParseNotification(c.Request, body)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"code": "FAIL", "message": err.Error()})
			return
		}
		if _, err := deps.mallService.MarkWechatOrderPaid(transaction.OutTradeNo, transaction.TransactionID, transaction.Amount.Total); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": "FAIL", "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"code": "SUCCESS", "message": "成功"})
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
		c.JSON(http.StatusOK, gin.H{"success": true, "products": signMallProductsForResponse(c, deps, items)})
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
			ID: req.ID, Title: req.Title, Description: req.Description,
			ImageURL: req.ImageURL, ImageURLs: req.ImageURLs,
			PriceCents: req.PriceCents, Stock: req.Stock, Status: req.Status, SortOrder: req.SortOrder,
		})
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		service.SignMallProductImages(c.Request.Context(), deps.imageSigner, deps.imagePublicBase, deps.imageCOSBucket, deps.imageSignTTL, &product)
		c.JSON(http.StatusOK, gin.H{"success": true, "product": product})
	})

	router.DELETE("/api/admin/mall/products/:id", func(c *gin.Context) {
		if !ensureReviewAdmin(c, deps.reviewAdminToken) {
			return
		}
		if err := deps.mallService.DeleteProduct(c.Param("id")); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "商品已删除"})
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
		if !imagePayloadMatchesContentType(data, contentType) {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "图片内容与文件类型不匹配"})
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
		displayURL := imageURL
		if signed, err := service.SignMallImageURLIfOwned(c.Request.Context(), deps.imageSigner, deps.imagePublicBase, deps.imageCOSBucket, imageURL, deps.imageSignTTL); err == nil && signed != "" {
			displayURL = signed
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "imageUrl": imageURL, "displayUrl": displayURL})
	})

	router.GET("/api/mall/image", func(c *gin.Context) {
		if !ensureMallImageAccess(c, deps) {
			return
		}
		rawURL := strings.TrimSpace(c.Query("url"))
		if rawURL == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "缺少图片地址"})
			return
		}
		signed, err := service.SignMallImageURLIfOwned(c.Request.Context(), deps.imageSigner, deps.imagePublicBase, deps.imageCOSBucket, rawURL, deps.imageSignTTL)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "生成图片访问链接失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"success": true, "url": signed})
	})

	router.GET("/api/mall/image-data", func(c *gin.Context) {
		if !ensureMallImageAccess(c, deps) {
			return
		}
		if deps.imageSigner == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"success": false, "message": "图片存储未配置"})
			return
		}
		rawURL := strings.TrimSpace(c.Query("url"))
		if rawURL == "" {
			c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "缺少图片地址"})
			return
		}
		data, contentType, err := service.LoadMallImageObject(c.Request.Context(), deps.imageSigner, deps.imagePublicBase, deps.imageCOSBucket, rawURL)
		if err != nil {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "读取商品图片失败"})
			return
		}
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		c.Header("Cache-Control", "private, max-age=300")
		c.Data(http.StatusOK, contentType, data)
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
				"totalCents": o.TotalCents, "paymentMethod": o.PaymentMethod, "paymentMode": o.PaymentMode,
				"paymentTradeNo": o.PaymentTradeNo, "paymentTransactionId": o.PaymentTransactionID,
				"paymentExpiresAt": o.PaymentExpiresAt, "province": o.Province, "city": o.City,
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
