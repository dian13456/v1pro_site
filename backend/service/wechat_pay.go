package service

import (
	"context"
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const defaultWeChatPayAPIBase = "https://api.mch.weixin.qq.com"

type WeChatPayClient struct {
	enabled        bool
	mchID          string
	appID          string
	merchantSerial string
	merchantKey    *rsa.PrivateKey
	apiV3Key       []byte
	notifyURL      string
	platformSerial string
	platformKey    *rsa.PublicKey
	apiBase        string
	h5Enabled      bool
	h5AppName      string
	h5AppURL       string
	httpClient     *http.Client
	now            func() time.Time
}

type WeChatPayCapabilities struct {
	Enabled   bool     `json:"enabled"`
	Modes     []string `json:"modes"`
	ExpireMin int      `json:"expireMinutes"`
}

type WeChatPayPrepay struct {
	Mode       string `json:"mode"`
	OutTradeNo string `json:"outTradeNo"`
	CodeURL    string `json:"codeUrl,omitempty"`
	H5URL      string `json:"h5Url,omitempty"`
	ExpiresAt  int64  `json:"expiresAt"`
}

type WeChatPayTransaction struct {
	AppID          string `json:"appid"`
	MchID          string `json:"mchid"`
	OutTradeNo     string `json:"out_trade_no"`
	TransactionID  string `json:"transaction_id"`
	TradeState     string `json:"trade_state"`
	TradeStateDesc string `json:"trade_state_desc"`
	SuccessTime    string `json:"success_time"`
	Amount         struct {
		Total      int64  `json:"total"`
		PayerTotal int64  `json:"payer_total"`
		Currency   string `json:"currency"`
	} `json:"amount"`
}

type WeChatPayAPIError struct {
	Code    string
	Message string
}

func (e *WeChatPayAPIError) Error() string {
	if e == nil {
		return "微信支付请求失败"
	}
	return fmt.Sprintf("微信支付请求失败（%s）：%s", e.Code, e.Message)
}

func IsWeChatPayAPIError(err error, code string) bool {
	var apiError *WeChatPayAPIError
	return errors.As(err, &apiError) && strings.EqualFold(apiError.Code, strings.TrimSpace(code))
}

type weChatPayNotification struct {
	ID        string `json:"id"`
	EventType string `json:"event_type"`
	Resource  struct {
		Algorithm      string `json:"algorithm"`
		Ciphertext     string `json:"ciphertext"`
		AssociatedData string `json:"associated_data"`
		Nonce          string `json:"nonce"`
	} `json:"resource"`
}

func envFlag(name string) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(name))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func loadPEMSecret(fileEnv, valueEnv string) ([]byte, error) {
	if raw := strings.TrimSpace(os.Getenv(valueEnv)); raw != "" {
		raw = strings.ReplaceAll(raw, `\n`, "\n")
		return []byte(raw), nil
	}
	path := strings.TrimSpace(os.Getenv(fileEnv))
	if path == "" {
		return nil, fmt.Errorf("%s 或 %s 未配置", fileEnv, valueEnv)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取 %s 失败: %w", fileEnv, err)
	}
	return data, nil
}

func parseRSAPrivateKey(data []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, errors.New("商户私钥不是有效 PEM")
	}
	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		if rsaKey, ok := key.(*rsa.PrivateKey); ok {
			return rsaKey, nil
		}
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	return nil, errors.New("商户私钥不是 RSA PKCS#1/PKCS#8 格式")
}

func parseRSAPublicKey(data []byte) (*rsa.PublicKey, error) {
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, errors.New("微信支付平台公钥不是有效 PEM")
	}
	if cert, err := x509.ParseCertificate(block.Bytes); err == nil {
		if key, ok := cert.PublicKey.(*rsa.PublicKey); ok {
			return key, nil
		}
	}
	if parsed, err := x509.ParsePKIXPublicKey(block.Bytes); err == nil {
		if key, ok := parsed.(*rsa.PublicKey); ok {
			return key, nil
		}
	}
	if key, err := x509.ParsePKCS1PublicKey(block.Bytes); err == nil {
		return key, nil
	}
	return nil, errors.New("微信支付平台公钥格式无效")
}

func NewWeChatPayClientFromEnv() (*WeChatPayClient, error) {
	client := &WeChatPayClient{
		enabled:    envFlag("WECHAT_PAY_ENABLED"),
		httpClient: &http.Client{Timeout: 15 * time.Second},
		now:        time.Now,
	}
	if !client.enabled {
		return client, nil
	}
	client.mchID = strings.TrimSpace(os.Getenv("WECHAT_PAY_MCH_ID"))
	client.appID = strings.TrimSpace(os.Getenv("WECHAT_PAY_APP_ID"))
	client.merchantSerial = strings.TrimSpace(os.Getenv("WECHAT_PAY_MERCHANT_CERT_SERIAL"))
	client.notifyURL = strings.TrimSpace(os.Getenv("WECHAT_PAY_NOTIFY_URL"))
	client.platformSerial = strings.TrimSpace(os.Getenv("WECHAT_PAY_PLATFORM_SERIAL"))
	client.apiV3Key = []byte(strings.TrimSpace(os.Getenv("WECHAT_PAY_API_V3_KEY")))
	client.apiBase = strings.TrimRight(strings.TrimSpace(os.Getenv("WECHAT_PAY_API_BASE")), "/")
	if client.apiBase == "" {
		client.apiBase = defaultWeChatPayAPIBase
	}
	client.h5Enabled = envFlag("WECHAT_PAY_H5_ENABLED")
	client.h5AppName = strings.TrimSpace(os.Getenv("WECHAT_PAY_H5_APP_NAME"))
	client.h5AppURL = strings.TrimSpace(os.Getenv("WECHAT_PAY_H5_APP_URL"))
	if client.mchID == "" || client.appID == "" || client.merchantSerial == "" || client.notifyURL == "" || client.platformSerial == "" {
		return nil, errors.New("微信支付商户号、AppID、证书序列号、回调地址或平台公钥序列号未完整配置")
	}
	if len(client.apiV3Key) != 32 {
		return nil, errors.New("WECHAT_PAY_API_V3_KEY 必须为 32 字节")
	}
	merchantPEM, err := loadPEMSecret("WECHAT_PAY_MERCHANT_PRIVATE_KEY_FILE", "WECHAT_PAY_MERCHANT_PRIVATE_KEY_PEM")
	if err != nil {
		return nil, err
	}
	client.merchantKey, err = parseRSAPrivateKey(merchantPEM)
	if err != nil {
		return nil, err
	}
	platformPEM, err := loadPEMSecret("WECHAT_PAY_PLATFORM_PUBLIC_KEY_FILE", "WECHAT_PAY_PLATFORM_PUBLIC_KEY_PEM")
	if err != nil {
		return nil, err
	}
	client.platformKey, err = parseRSAPublicKey(platformPEM)
	if err != nil {
		return nil, err
	}
	if client.h5Enabled && (client.h5AppName == "" || client.h5AppURL == "") {
		return nil, errors.New("开启 H5 支付时必须配置 WECHAT_PAY_H5_APP_NAME 和 WECHAT_PAY_H5_APP_URL")
	}
	return client, nil
}

func (c *WeChatPayClient) Available() bool {
	return c != nil && c.enabled && c.merchantKey != nil && c.platformKey != nil
}

func (c *WeChatPayClient) Capabilities(expireMinutes int) WeChatPayCapabilities {
	if expireMinutes <= 0 {
		expireMinutes = 15
	}
	modes := []string{}
	if c.Available() {
		modes = append(modes, "native")
		if c.h5Enabled {
			modes = append(modes, "h5")
		}
	}
	return WeChatPayCapabilities{Enabled: c.Available(), Modes: modes, ExpireMin: expireMinutes}
}

func randomHex(byteCount int) (string, error) {
	buf := make([]byte, byteCount)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func (c *WeChatPayClient) signRequest(method, requestURI string, body []byte, timestamp, nonce string) (string, error) {
	message := strings.ToUpper(method) + "\n" + requestURI + "\n" + timestamp + "\n" + nonce + "\n" + string(body) + "\n"
	digest := sha256.Sum256([]byte(message))
	signature, err := rsa.SignPKCS1v15(rand.Reader, c.merchantKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(signature), nil
}

func (c *WeChatPayClient) verifySignedMessage(headers http.Header, body []byte, source string) error {
	timestamp := strings.TrimSpace(headers.Get("Wechatpay-Timestamp"))
	nonce := strings.TrimSpace(headers.Get("Wechatpay-Nonce"))
	signatureText := strings.TrimSpace(headers.Get("Wechatpay-Signature"))
	serial := strings.TrimSpace(headers.Get("Wechatpay-Serial"))
	if timestamp == "" || nonce == "" || signatureText == "" || serial == "" {
		return fmt.Errorf("%s验签头不完整", source)
	}
	if !strings.EqualFold(serial, c.platformSerial) {
		return fmt.Errorf("%s平台公钥序列号不匹配", source)
	}
	issuedAt, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || issuedAt <= 0 || c.now().Sub(time.Unix(issuedAt, 0)).Abs() > 10*time.Minute {
		return fmt.Errorf("%s时间戳无效", source)
	}
	signature, err := base64.StdEncoding.DecodeString(signatureText)
	if err != nil {
		return fmt.Errorf("%s签名编码无效", source)
	}
	message := timestamp + "\n" + nonce + "\n" + string(body) + "\n"
	digest := sha256.Sum256([]byte(message))
	if err := rsa.VerifyPKCS1v15(c.platformKey, crypto.SHA256, digest[:], signature); err != nil {
		return fmt.Errorf("%s签名无效", source)
	}
	return nil
}

func (c *WeChatPayClient) do(ctx context.Context, method, requestURI string, requestBody any, responseBody any) error {
	if !c.Available() {
		return errors.New("微信支付尚未配置")
	}
	var body []byte
	var err error
	if requestBody != nil {
		body, err = json.Marshal(requestBody)
		if err != nil {
			return err
		}
	}
	nonce, err := randomHex(16)
	if err != nil {
		return err
	}
	timestamp := strconv.FormatInt(c.now().Unix(), 10)
	signature, err := c.signRequest(method, requestURI, body, timestamp, nonce)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, method, c.apiBase+requestURI, strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "JiadianMall-WeChatPay/1.0")
	if requestBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", fmt.Sprintf(
		`WECHATPAY2-SHA256-RSA2048 mchid="%s",nonce_str="%s",timestamp="%s",serial_no="%s",signature="%s"`,
		c.mchID, nonce, timestamp, c.merchantSerial, signature,
	))
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("连接微信支付失败: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("读取微信支付响应失败: %w", err)
	}
	if err := c.verifySignedMessage(resp.Header, data, "微信支付应答"); err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var apiError struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(data, &apiError)
		if apiError.Message == "" {
			apiError.Message = http.StatusText(resp.StatusCode)
		}
		return &WeChatPayAPIError{Code: apiError.Code, Message: apiError.Message}
	}
	if responseBody != nil && len(data) > 0 {
		if err := json.Unmarshal(data, responseBody); err != nil {
			return fmt.Errorf("解析微信支付响应失败: %w", err)
		}
	}
	return nil
}

func trimWeChatDescription(value string) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > 120 {
		runes = runes[:120]
	}
	if len(runes) == 0 {
		return "佳点电子实物商城订单"
	}
	return string(runes)
}

func (c *WeChatPayClient) CreatePayment(ctx context.Context, order MallOrderPublic, mode, clientIP, description string) (WeChatPayPrepay, error) {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode == "h5" && !c.h5Enabled {
		return WeChatPayPrepay{}, errors.New("商户未开通 H5 支付，请使用微信扫码支付")
	}
	if mode != "native" && mode != "h5" {
		return WeChatPayPrepay{}, errors.New("微信支付场景无效")
	}
	expireAt := time.UnixMilli(order.PaymentExpiresAt)
	body := map[string]any{
		"appid":        c.appID,
		"mchid":        c.mchID,
		"description":  trimWeChatDescription(description),
		"out_trade_no": order.PaymentTradeNo,
		"time_expire":  expireAt.Format(time.RFC3339),
		"attach":       "mall:" + order.ID,
		"notify_url":   c.notifyURL,
		"amount": map[string]any{
			"total":    order.TotalCents,
			"currency": "CNY",
		},
	}
	result := WeChatPayPrepay{Mode: mode, OutTradeNo: order.PaymentTradeNo, ExpiresAt: order.PaymentExpiresAt}
	if mode == "native" {
		var response struct {
			CodeURL string `json:"code_url"`
		}
		if err := c.do(ctx, http.MethodPost, "/v3/pay/transactions/native", body, &response); err != nil {
			return WeChatPayPrepay{}, err
		}
		if strings.TrimSpace(response.CodeURL) == "" {
			return WeChatPayPrepay{}, errors.New("微信支付未返回二维码链接")
		}
		result.CodeURL = response.CodeURL
		return result, nil
	}
	body["scene_info"] = map[string]any{
		"payer_client_ip": strings.TrimSpace(clientIP),
		"h5_info": map[string]any{
			"type":     "Wap",
			"app_name": c.h5AppName,
			"app_url":  c.h5AppURL,
		},
	}
	if net.ParseIP(strings.TrimSpace(clientIP)) == nil {
		return WeChatPayPrepay{}, errors.New("无法识别付款设备 IP，请使用微信扫码支付")
	}
	var response struct {
		H5URL string `json:"h5_url"`
	}
	if err := c.do(ctx, http.MethodPost, "/v3/pay/transactions/h5", body, &response); err != nil {
		return WeChatPayPrepay{}, err
	}
	if strings.TrimSpace(response.H5URL) == "" {
		return WeChatPayPrepay{}, errors.New("微信支付未返回 H5 支付链接")
	}
	result.H5URL = response.H5URL
	return result, nil
}

func (c *WeChatPayClient) QueryTransaction(ctx context.Context, outTradeNo string) (WeChatPayTransaction, error) {
	requestURI := "/v3/pay/transactions/out-trade-no/" + url.PathEscape(strings.TrimSpace(outTradeNo)) + "?mchid=" + url.QueryEscape(c.mchID)
	var transaction WeChatPayTransaction
	if err := c.do(ctx, http.MethodGet, requestURI, nil, &transaction); err != nil {
		return WeChatPayTransaction{}, err
	}
	return transaction, nil
}

func (c *WeChatPayClient) CloseTransaction(ctx context.Context, outTradeNo string) error {
	requestURI := "/v3/pay/transactions/out-trade-no/" + url.PathEscape(strings.TrimSpace(outTradeNo)) + "/close"
	return c.do(ctx, http.MethodPost, requestURI, map[string]string{"mchid": c.mchID}, nil)
}

func (c *WeChatPayClient) ParseNotification(request *http.Request, body []byte) (WeChatPayTransaction, error) {
	if !c.Available() {
		return WeChatPayTransaction{}, errors.New("微信支付尚未配置")
	}
	if err := c.verifySignedMessage(request.Header, body, "微信支付回调"); err != nil {
		return WeChatPayTransaction{}, err
	}
	var notification weChatPayNotification
	if err := json.Unmarshal(body, &notification); err != nil {
		return WeChatPayTransaction{}, errors.New("微信支付回调内容无效")
	}
	if notification.EventType != "TRANSACTION.SUCCESS" || notification.Resource.Algorithm != "AEAD_AES_256_GCM" {
		return WeChatPayTransaction{}, errors.New("不支持的微信支付回调事件")
	}
	ciphertext, err := base64.StdEncoding.DecodeString(notification.Resource.Ciphertext)
	if err != nil {
		return WeChatPayTransaction{}, errors.New("微信支付回调密文无效")
	}
	block, err := aes.NewCipher(c.apiV3Key)
	if err != nil {
		return WeChatPayTransaction{}, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return WeChatPayTransaction{}, err
	}
	plaintext, err := gcm.Open(nil, []byte(notification.Resource.Nonce), ciphertext, []byte(notification.Resource.AssociatedData))
	if err != nil {
		return WeChatPayTransaction{}, errors.New("微信支付回调解密失败")
	}
	var transaction WeChatPayTransaction
	if err := json.Unmarshal(plaintext, &transaction); err != nil {
		return WeChatPayTransaction{}, errors.New("微信支付交易内容无效")
	}
	if transaction.MchID != c.mchID || transaction.AppID != c.appID || transaction.TradeState != "SUCCESS" {
		return WeChatPayTransaction{}, errors.New("微信支付交易主体或状态不匹配")
	}
	if transaction.OutTradeNo == "" || transaction.TransactionID == "" || transaction.Amount.Total <= 0 {
		return WeChatPayTransaction{}, errors.New("微信支付交易字段不完整")
	}
	return transaction, nil
}
