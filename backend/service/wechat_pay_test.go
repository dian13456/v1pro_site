package service

import (
	"context"
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func signWeChatTestMessage(t *testing.T, key *rsa.PrivateKey, timestamp, nonce string, body []byte) string {
	t.Helper()
	digest := sha256.Sum256([]byte(timestamp + "\n" + nonce + "\n" + string(body) + "\n"))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(signature)
}

func newWeChatPayTestClient(t *testing.T, platformKey *rsa.PrivateKey, now time.Time) *WeChatPayClient {
	t.Helper()
	merchantKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return &WeChatPayClient{
		enabled:        true,
		mchID:          "1900000001",
		appID:          "wx-test-app",
		merchantSerial: "merchant-serial",
		merchantKey:    merchantKey,
		apiV3Key:       []byte("0123456789abcdef0123456789abcdef"),
		notifyURL:      "https://api.example.com/wechat/notify",
		platformSerial: "PUB_KEY_ID_3000000001",
		platformKey:    &platformKey.PublicKey,
		httpClient:     &http.Client{Timeout: 5 * time.Second},
		now:            func() time.Time { return now },
	}
}

func TestWeChatPayDoVerifiesResponseSignature(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	platformKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	client := newWeChatPayTestClient(t, platformKey, now)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Header.Get("Authorization"), "WECHATPAY2-SHA256-RSA2048 ") {
			t.Error("request authorization signature is missing")
		}
		body := []byte(`{"trade_state":"NOTPAY"}`)
		timestamp := strconv.FormatInt(now.Unix(), 10)
		nonce := "response-nonce"
		w.Header().Set("Wechatpay-Timestamp", timestamp)
		w.Header().Set("Wechatpay-Nonce", nonce)
		w.Header().Set("Wechatpay-Serial", client.platformSerial)
		w.Header().Set("Wechatpay-Signature", signWeChatTestMessage(t, platformKey, timestamp, nonce, body))
		_, _ = w.Write(body)
	}))
	defer server.Close()
	client.apiBase = server.URL

	var response struct {
		TradeState string `json:"trade_state"`
	}
	if err := client.do(context.Background(), http.MethodGet, "/test", nil, &response); err != nil {
		t.Fatalf("signed response rejected: %v", err)
	}
	if response.TradeState != "NOTPAY" {
		t.Fatalf("unexpected response: %#v", response)
	}
}

func TestWeChatPayDoRejectsTamperedResponse(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	platformKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	client := newWeChatPayTestClient(t, platformKey, now)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		timestamp := strconv.FormatInt(now.Unix(), 10)
		nonce := "response-nonce"
		w.Header().Set("Wechatpay-Timestamp", timestamp)
		w.Header().Set("Wechatpay-Nonce", nonce)
		w.Header().Set("Wechatpay-Serial", client.platformSerial)
		w.Header().Set("Wechatpay-Signature", signWeChatTestMessage(t, platformKey, timestamp, nonce, []byte(`{"ok":true}`)))
		_, _ = w.Write([]byte(`{"ok":false}`))
	}))
	defer server.Close()
	client.apiBase = server.URL

	if err := client.do(context.Background(), http.MethodGet, "/test", nil, nil); err == nil || !strings.Contains(err.Error(), "签名无效") {
		t.Fatalf("tampered response was not rejected: %v", err)
	}
}

func TestWeChatPayParseNotification(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	platformKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	client := newWeChatPayTestClient(t, platformKey, now)

	transactionJSON, err := json.Marshal(WeChatPayTransaction{
		AppID:          client.appID,
		MchID:          client.mchID,
		OutTradeNo:     "ord-test-1",
		TransactionID:  "wx-transaction-1",
		TradeState:     "SUCCESS",
		TradeStateDesc: "支付成功",
		Amount: struct {
			Total      int64  `json:"total"`
			PayerTotal int64  `json:"payer_total"`
			Currency   string `json:"currency"`
		}{Total: 1990, PayerTotal: 1990, Currency: "CNY"},
	})
	if err != nil {
		t.Fatal(err)
	}
	block, err := aes.NewCipher(client.apiV3Key)
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	nonce := []byte("123456789012")
	associatedData := "transaction"
	ciphertext := gcm.Seal(nil, nonce, transactionJSON, []byte(associatedData))
	notificationBody, err := json.Marshal(map[string]any{
		"id":         "notification-1",
		"event_type": "TRANSACTION.SUCCESS",
		"resource": map[string]any{
			"algorithm":       "AEAD_AES_256_GCM",
			"ciphertext":      base64.StdEncoding.EncodeToString(ciphertext),
			"associated_data": associatedData,
			"nonce":           string(nonce),
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/notify", strings.NewReader(string(notificationBody)))
	timestamp := strconv.FormatInt(now.Unix(), 10)
	signatureNonce := "notification-nonce"
	req.Header.Set("Wechatpay-Timestamp", timestamp)
	req.Header.Set("Wechatpay-Nonce", signatureNonce)
	req.Header.Set("Wechatpay-Serial", client.platformSerial)
	req.Header.Set("Wechatpay-Signature", signWeChatTestMessage(t, platformKey, timestamp, signatureNonce, notificationBody))

	transaction, err := client.ParseNotification(req, notificationBody)
	if err != nil {
		t.Fatalf("valid notification rejected: %v", err)
	}
	if transaction.OutTradeNo != "ord-test-1" || transaction.TransactionID != "wx-transaction-1" || transaction.Amount.Total != 1990 {
		t.Fatalf("unexpected transaction: %s", fmt.Sprintf("%+v", transaction))
	}
}
