package service

const (
	MallOrderPendingPay = "pending_pay"
	MallOrderPaid       = "paid"
	MallOrderShipped    = "shipped"
	MallOrderCancelled  = "cancelled"

	MallProductOnSale  = "on_sale"
	MallProductOffSale = "off_sale"
)

type MallProduct struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	ImageURL    string   `json:"imageUrl,omitempty"`
	ImageURLs   []string `json:"imageUrls,omitempty"`
	PriceCents  int64    `json:"priceCents"`
	Stock       int      `json:"stock"`
	Status      string   `json:"status"`
	SortOrder   int      `json:"sortOrder"`
	CreatedAt   int64    `json:"createdAt"`
	UpdatedAt   int64    `json:"updatedAt"`
}

type MallOrderItem struct {
	ProductID  string `json:"productId"`
	Title      string `json:"title"`
	ImageURL   string `json:"imageUrl,omitempty"`
	PriceCents int64  `json:"priceCents"`
	Quantity   int    `json:"quantity"`
}

type MallOrder struct {
	ID                   string          `json:"id"`
	UserSerial           string          `json:"userSerial"`
	Status               string          `json:"status"`
	Items                []MallOrderItem `json:"items"`
	TotalCents           int64           `json:"totalCents"`
	PaymentMethod        string          `json:"paymentMethod,omitempty"`
	PaymentMode          string          `json:"paymentMode,omitempty"`
	PaymentTradeNo       string          `json:"paymentTradeNo,omitempty"`
	PaymentTransactionID string          `json:"paymentTransactionId,omitempty"`
	PaymentExpiresAt     int64           `json:"paymentExpiresAt,omitempty"`
	StockReserved        bool            `json:"stockReserved,omitempty"`
	NameEnc              string          `json:"nameEnc,omitempty"`
	PhoneEnc             string          `json:"phoneEnc,omitempty"`
	WechatEnc            string          `json:"wechatEnc,omitempty"`
	QQEnc                string          `json:"qqEnc,omitempty"`
	Province             string          `json:"province,omitempty"`
	City                 string          `json:"city,omitempty"`
	AddressEnc           string          `json:"addressEnc,omitempty"`
	TrackingNo           string          `json:"trackingNo,omitempty"`
	Remark               string          `json:"remark,omitempty"`
	CreatedAt            int64           `json:"createdAt"`
	UpdatedAt            int64           `json:"updatedAt"`
	PaidAt               int64           `json:"paidAt,omitempty"`
	ShippedAt            int64           `json:"shippedAt,omitempty"`
}

type MallDataStore struct {
	Products []MallProduct `json:"products"`
	Orders   []MallOrder   `json:"orders"`
}

type MallShippingPlain struct {
	Name     string `json:"name"`
	Phone    string `json:"phone"`
	Wechat   string `json:"wechat"`
	QQ       string `json:"qq"`
	Province string `json:"province"`
	City     string `json:"city"`
	Address  string `json:"address"`
}

type MallCreateOrderInput struct {
	UserSerial       string
	Items            []MallOrderItem
	Shipping         MallShippingPlain
	Remark           string
	PaymentMethod    string
	PaymentExpiresAt int64
}

type MallPointRedemptionInput struct {
	UserSerial string
	ProductID  string
	Title      string
	Credits    int
	Shipping   MallShippingPlain
	Remark     string
}

type MallProductPublic struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	ImageURL    string   `json:"imageUrl,omitempty"`
	ImageURLs   []string `json:"imageUrls,omitempty"`
	PriceCents  int64    `json:"priceCents"`
	Stock       int      `json:"stock"`
	Status      string   `json:"status"`
}

type MallOrderPublic struct {
	ID                   string          `json:"id"`
	Status               string          `json:"status"`
	Items                []MallOrderItem `json:"items"`
	TotalCents           int64           `json:"totalCents"`
	PaymentMethod        string          `json:"paymentMethod,omitempty"`
	PaymentMode          string          `json:"paymentMode,omitempty"`
	PaymentTradeNo       string          `json:"paymentTradeNo,omitempty"`
	PaymentTransactionID string          `json:"paymentTransactionId,omitempty"`
	PaymentExpiresAt     int64           `json:"paymentExpiresAt,omitempty"`
	Province             string          `json:"province,omitempty"`
	City                 string          `json:"city,omitempty"`
	TrackingNo           string          `json:"trackingNo,omitempty"`
	Remark               string          `json:"remark,omitempty"`
	CreatedAt            int64           `json:"createdAt"`
	UpdatedAt            int64           `json:"updatedAt"`
	PaidAt               int64           `json:"paidAt,omitempty"`
	ShippedAt            int64           `json:"shippedAt,omitempty"`
	HasAddress           bool            `json:"hasAddress"`
}
