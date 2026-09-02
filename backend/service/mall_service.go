package service

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

type MallService struct {
	repo   *MallRepo
	secret string
}

const (
	maxMallOrderItems         = 20
	maxMallItemQuantity       = 100
	maxMallNameRunes          = 64
	maxMallContactRunes       = 64
	maxMallRegionRunes        = 64
	maxMallAddressRunes       = 500
	maxMallRemarkRunes        = 500
	maxMallProductTitle       = 200
	maxMallProductDescription = 5000
	maxMallProductImages      = 10
	maxMallImageURLRunes      = 2048
	mallPaymentWechat         = "wechat"
	mallPaymentManual         = "manual"
)

func NewMallService(repo *MallRepo, secret string) *MallService {
	return &MallService{repo: repo, secret: secret}
}

func (s *MallService) EnsureSeed() error {
	if s == nil || s.repo == nil {
		return errors.New("mall service not ready")
	}
	return s.repo.EnsureSeedProducts()
}

func (s *MallService) ListPublicProducts() ([]MallProductPublic, error) {
	items, err := s.repo.ListProducts(false)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].SortOrder == items[j].SortOrder {
			return items[i].UpdatedAt > items[j].UpdatedAt
		}
		return items[i].SortOrder < items[j].SortOrder
	})
	out := make([]MallProductPublic, 0, len(items))
	for _, p := range items {
		// Zero-priced products are inventory records used exclusively by the
		// points shop. They must not be orderable for free in the cash mall.
		if p.PriceCents == 0 {
			continue
		}
		NormalizeMallProductImages(&p)
		out = append(out, MallProductPublic{
			ID: p.ID, Title: p.Title, Description: p.Description,
			ImageURL: p.ImageURL, ImageURLs: p.ImageURLs,
			PriceCents: p.PriceCents, Stock: p.Stock, Status: p.Status,
		})
	}
	return out, nil
}

func (s *MallService) ListAdminProducts() ([]MallProduct, error) {
	items, err := s.repo.ListProducts(true)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].UpdatedAt > items[j].UpdatedAt
	})
	for i := range items {
		NormalizeMallProductImages(&items[i])
	}
	return items, nil
}

func (s *MallService) UpsertProduct(input MallProduct) (MallProduct, error) {
	input.Title = strings.TrimSpace(input.Title)
	input.Description = strings.TrimSpace(input.Description)
	input.ImageURL = strings.TrimSpace(input.ImageURL)
	input.Status = strings.TrimSpace(input.Status)
	if input.Title == "" {
		return MallProduct{}, errors.New("商品标题不能为空")
	}
	if len([]rune(input.Title)) > maxMallProductTitle || len([]rune(input.Description)) > maxMallProductDescription {
		return MallProduct{}, errors.New("商品标题或描述过长")
	}
	if input.PriceCents < 0 || input.PriceCents > 100000000 {
		return MallProduct{}, errors.New("商品价格超出允许范围")
	}
	if input.Stock < 0 || input.Stock > 1000000 {
		return MallProduct{}, errors.New("商品库存超出允许范围")
	}
	if input.Status == "" {
		input.Status = MallProductOnSale
	}
	if input.Status != MallProductOnSale && input.Status != MallProductOffSale {
		return MallProduct{}, errors.New("商品状态无效")
	}
	NormalizeMallProductImages(&input)
	if len(input.ImageURLs) > maxMallProductImages {
		return MallProduct{}, errors.New("商品图片不能超过 10 张")
	}
	for _, imageURL := range input.ImageURLs {
		if len([]rune(imageURL)) > maxMallImageURLRunes {
			return MallProduct{}, errors.New("商品图片地址过长")
		}
	}
	product, err := s.repo.UpsertProduct(input)
	if err != nil {
		return MallProduct{}, err
	}
	NormalizeMallProductImages(&product)
	return product, nil
}

func (s *MallService) DeleteProduct(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("商品 ID 不能为空")
	}
	_, ok, err := s.repo.GetProduct(id)
	if err != nil {
		return err
	}
	if !ok {
		return errors.New("商品不存在")
	}
	hasPending, err := s.repo.HasPendingOrdersForProduct(id)
	if err != nil {
		return err
	}
	if hasPending {
		return errors.New("该商品有待确认收款订单，无法删除。可先下架或处理完订单后再删")
	}
	return s.repo.DeleteProduct(id)
}

func toPublicOrder(o MallOrder) MallOrderPublic {
	return MallOrderPublic{
		ID: o.ID, Status: o.Status, Items: o.Items, TotalCents: o.TotalCents,
		PaymentMethod: o.PaymentMethod, PaymentMode: o.PaymentMode,
		PaymentTradeNo: o.PaymentTradeNo, PaymentTransactionID: o.PaymentTransactionID,
		PaymentExpiresAt: o.PaymentExpiresAt,
		Province:         o.Province, City: o.City, TrackingNo: o.TrackingNo, Remark: o.Remark,
		CreatedAt: o.CreatedAt, UpdatedAt: o.UpdatedAt, PaidAt: o.PaidAt, ShippedAt: o.ShippedAt,
		HasAddress: strings.TrimSpace(o.NameEnc) != "" && strings.TrimSpace(o.AddressEnc) != "",
	}
}

func (s *MallService) CreateOrder(input MallCreateOrderInput) (MallOrderPublic, error) {
	serial := strings.TrimSpace(input.UserSerial)
	if serial == "" {
		return MallOrderPublic{}, errors.New("用户未登录")
	}
	if len(input.Items) == 0 {
		return MallOrderPublic{}, errors.New("请至少选择一件商品")
	}
	if len(input.Items) > maxMallOrderItems {
		return MallOrderPublic{}, errors.New("单次订单商品种类过多")
	}
	paymentMethod := strings.ToLower(strings.TrimSpace(input.PaymentMethod))
	if paymentMethod == "" {
		paymentMethod = mallPaymentManual
	}
	if paymentMethod != mallPaymentManual && paymentMethod != mallPaymentWechat {
		return MallOrderPublic{}, errors.New("支付方式无效")
	}
	name := strings.TrimSpace(input.Shipping.Name)
	phone := strings.TrimSpace(input.Shipping.Phone)
	qq := strings.TrimSpace(input.Shipping.QQ)
	province := strings.TrimSpace(input.Shipping.Province)
	city := strings.TrimSpace(input.Shipping.City)
	address := strings.TrimSpace(input.Shipping.Address)
	if name == "" || phone == "" || qq == "" || province == "" || city == "" || address == "" {
		return MallOrderPublic{}, errors.New("请完整填写收货信息（姓名、手机、QQ、省市、详细地址）")
	}
	if !ValidateChinaMobilePhone(phone) {
		return MallOrderPublic{}, errors.New("手机号格式不正确")
	}
	if !ValidateQQNumber(qq) {
		return MallOrderPublic{}, errors.New("QQ 号格式不正确")
	}
	if len([]rune(name)) > maxMallNameRunes || len([]rune(input.Shipping.Wechat)) > maxMallContactRunes ||
		len([]rune(province)) > maxMallRegionRunes || len([]rune(city)) > maxMallRegionRunes ||
		len([]rune(address)) > maxMallAddressRunes || len([]rune(input.Remark)) > maxMallRemarkRunes {
		return MallOrderPublic{}, errors.New("收货信息或备注过长")
	}

	merged := map[string]int{}
	for _, item := range input.Items {
		pid := strings.TrimSpace(item.ProductID)
		qty := item.Quantity
		if pid == "" || len(pid) > 64 || qty <= 0 || qty > maxMallItemQuantity {
			return MallOrderPublic{}, errors.New("商品数量无效")
		}
		if merged[pid] > maxMallItemQuantity-qty {
			return MallOrderPublic{}, errors.New("单件商品数量过多")
		}
		merged[pid] += qty
	}

	resolved := make([]MallOrderItem, 0, len(merged))
	var total int64
	for pid, qty := range merged {
		product, ok, err := s.repo.GetProduct(pid)
		if err != nil {
			return MallOrderPublic{}, err
		}
		if !ok || product.Status != MallProductOnSale {
			return MallOrderPublic{}, fmt.Errorf("商品不可购买：%s", pid)
		}
		if product.Stock < qty {
			return MallOrderPublic{}, fmt.Errorf("「%s」库存不足（剩余 %d）", product.Title, product.Stock)
		}
		line := MallOrderItem{
			ProductID:  product.ID,
			Title:      product.Title,
			ImageURL:   product.ImageURL,
			PriceCents: product.PriceCents,
			Quantity:   qty,
		}
		resolved = append(resolved, line)
		total += product.PriceCents * int64(qty)
	}

	nameEnc, err := EncryptActivityField(s.secret, name)
	if err != nil {
		return MallOrderPublic{}, err
	}
	phoneEnc, err := EncryptActivityField(s.secret, phone)
	if err != nil {
		return MallOrderPublic{}, err
	}
	wechatEnc, err := EncryptActivityField(s.secret, input.Shipping.Wechat)
	if err != nil {
		return MallOrderPublic{}, err
	}
	qqEnc, err := EncryptActivityField(s.secret, qq)
	if err != nil {
		return MallOrderPublic{}, err
	}
	addressEnc, err := EncryptActivityField(s.secret, address)
	if err != nil {
		return MallOrderPublic{}, err
	}

	now := time.Now().UnixMilli()
	orderID := mallNewID("ord")
	order := MallOrder{
		ID:            orderID,
		UserSerial:    serial,
		Status:        MallOrderPendingPay,
		Items:         resolved,
		TotalCents:    total,
		PaymentMethod: paymentMethod,
		NameEnc:       nameEnc,
		PhoneEnc:      phoneEnc,
		WechatEnc:     wechatEnc,
		QQEnc:         qqEnc,
		Province:      province,
		City:          city,
		AddressEnc:    addressEnc,
		Remark:        strings.TrimSpace(input.Remark),
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	stockDelta := map[string]int(nil)
	if paymentMethod == mallPaymentWechat {
		if total <= 0 {
			return MallOrderPublic{}, errors.New("在线支付订单金额必须大于 0")
		}
		if input.PaymentExpiresAt <= now {
			return MallOrderPublic{}, errors.New("支付有效期无效")
		}
		order.PaymentTradeNo = orderID
		order.PaymentExpiresAt = input.PaymentExpiresAt
		order.StockReserved = true
		stockDelta = make(map[string]int, len(resolved))
		for _, item := range resolved {
			stockDelta[item.ProductID] -= item.Quantity
		}
	}
	if err := s.repo.CreateOrder(order, stockDelta); err != nil {
		return MallOrderPublic{}, err
	}
	return toPublicOrder(order), nil
}

func validatePointRedemptionShipping(input MallShippingPlain, remark string) (MallShippingPlain, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Phone = strings.TrimSpace(input.Phone)
	input.Wechat = strings.TrimSpace(input.Wechat)
	input.QQ = strings.TrimSpace(input.QQ)
	input.Province = strings.TrimSpace(input.Province)
	input.City = strings.TrimSpace(input.City)
	input.Address = strings.TrimSpace(input.Address)
	if input.Name == "" || input.Phone == "" || input.QQ == "" || input.Province == "" || input.City == "" || input.Address == "" {
		return MallShippingPlain{}, errors.New("请完整填写收货信息（姓名、手机、QQ、省市、详细地址）")
	}
	if !ValidateChinaMobilePhone(input.Phone) {
		return MallShippingPlain{}, errors.New("手机号格式不正确")
	}
	if !ValidateQQNumber(input.QQ) {
		return MallShippingPlain{}, errors.New("QQ 号格式不正确")
	}
	if len([]rune(input.Name)) > maxMallNameRunes || len([]rune(input.Wechat)) > maxMallContactRunes ||
		len([]rune(input.Province)) > maxMallRegionRunes || len([]rune(input.City)) > maxMallRegionRunes ||
		len([]rune(input.Address)) > maxMallAddressRunes || len([]rune(remark)) > maxMallRemarkRunes {
		return MallShippingPlain{}, errors.New("收货信息或备注过长")
	}
	return input, nil
}

func (s *MallService) PointRedemptionStock(productID string) (int, error) {
	if s == nil || s.repo == nil {
		return 0, errors.New("实物商城服务未初始化")
	}
	product, ok, err := s.repo.GetProduct(strings.TrimSpace(productID))
	if err != nil {
		return 0, err
	}
	if !ok || product.Status != MallProductOnSale {
		return 0, errors.New("关联实物商品不存在或已下架")
	}
	return product.Stock, nil
}

func (s *MallService) CreatePointRedemptionOrder(input MallPointRedemptionInput) (MallOrderPublic, error) {
	if s == nil || s.repo == nil {
		return MallOrderPublic{}, errors.New("实物商城服务未初始化")
	}
	serial := strings.TrimSpace(input.UserSerial)
	productID := strings.TrimSpace(input.ProductID)
	title := strings.TrimSpace(input.Title)
	if serial == "" || productID == "" || title == "" || input.Credits <= 0 {
		return MallOrderPublic{}, errors.New("实物兑换参数无效")
	}
	shipping, err := validatePointRedemptionShipping(input.Shipping, input.Remark)
	if err != nil {
		return MallOrderPublic{}, err
	}
	product, ok, err := s.repo.GetProduct(productID)
	if err != nil {
		return MallOrderPublic{}, err
	}
	if !ok || product.Status != MallProductOnSale {
		return MallOrderPublic{}, errors.New("兑换商品不存在或已下架")
	}
	if product.Stock <= 0 {
		return MallOrderPublic{}, errors.New("兑换商品库存不足")
	}

	nameEnc, err := EncryptActivityField(s.secret, shipping.Name)
	if err != nil {
		return MallOrderPublic{}, err
	}
	phoneEnc, err := EncryptActivityField(s.secret, shipping.Phone)
	if err != nil {
		return MallOrderPublic{}, err
	}
	wechatEnc, err := EncryptActivityField(s.secret, shipping.Wechat)
	if err != nil {
		return MallOrderPublic{}, err
	}
	qqEnc, err := EncryptActivityField(s.secret, shipping.QQ)
	if err != nil {
		return MallOrderPublic{}, err
	}
	addressEnc, err := EncryptActivityField(s.secret, shipping.Address)
	if err != nil {
		return MallOrderPublic{}, err
	}

	now := time.Now().UnixMilli()
	remark := fmt.Sprintf("积分兑换 · %d 积分", input.Credits)
	if extra := strings.TrimSpace(input.Remark); extra != "" {
		remark += " · " + extra
	}
	order := MallOrder{
		ID:         mallNewID("pts"),
		UserSerial: serial,
		Status:     MallOrderPaid,
		Items: []MallOrderItem{{
			ProductID:  product.ID,
			Title:      title,
			ImageURL:   product.ImageURL,
			PriceCents: 0,
			Quantity:   1,
		}},
		TotalCents: 0,
		NameEnc:    nameEnc,
		PhoneEnc:   phoneEnc,
		WechatEnc:  wechatEnc,
		QQEnc:      qqEnc,
		Province:   shipping.Province,
		City:       shipping.City,
		AddressEnc: addressEnc,
		Remark:     remark,
		CreatedAt:  now,
		UpdatedAt:  now,
		PaidAt:     now,
	}
	if err := s.repo.CreateOrder(order, map[string]int{product.ID: -1}); err != nil {
		return MallOrderPublic{}, err
	}
	return toPublicOrder(order), nil
}

func isPointRedemptionOrder(order MallOrder) bool {
	return order.TotalCents == 0 && strings.HasPrefix(order.Remark, "积分兑换 · ")
}

// RollbackPointRedemptionOrder cancels an order created by a points redemption and
// restores its stock. It is only used when persisting the matching credit charge fails.
func (s *MallService) RollbackPointRedemptionOrder(orderID string) error {
	if s == nil || s.repo == nil {
		return errors.New("实物商城服务未初始化")
	}
	order, ok, err := s.repo.GetOrder(strings.TrimSpace(orderID))
	if err != nil {
		return err
	}
	if !ok || !isPointRedemptionOrder(order) {
		return errors.New("积分兑换订单不存在")
	}
	if order.Status == MallOrderCancelled {
		return nil
	}
	if order.Status != MallOrderPaid {
		return errors.New("当前订单状态无法回滚")
	}
	stockDelta := make(map[string]int, len(order.Items))
	for _, item := range order.Items {
		stockDelta[item.ProductID] += item.Quantity
	}
	order.Status = MallOrderCancelled
	order.UpdatedAt = time.Now().UnixMilli()
	return s.repo.UpdateOrder(order, stockDelta)
}

func (s *MallService) ListMyOrders(serial string) ([]MallOrderPublic, error) {
	items, err := s.repo.ListOrdersByUser(strings.TrimSpace(serial))
	if err != nil {
		return nil, err
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].CreatedAt > items[j].CreatedAt
	})
	out := make([]MallOrderPublic, 0, len(items))
	for _, o := range items {
		out = append(out, toPublicOrder(o))
	}
	return out, nil
}

func (s *MallService) GetMyOrder(serial, orderID string) (MallOrderPublic, error) {
	order, ok, err := s.repo.GetOrder(strings.TrimSpace(orderID))
	if err != nil {
		return MallOrderPublic{}, err
	}
	if !ok || order.UserSerial != strings.TrimSpace(serial) {
		return MallOrderPublic{}, errors.New("订单不存在")
	}
	return toPublicOrder(order), nil
}

func (s *MallService) PrepareWechatPayment(serial, orderID, mode string) (MallOrderPublic, error) {
	order, ok, err := s.repo.GetOrder(strings.TrimSpace(orderID))
	if err != nil {
		return MallOrderPublic{}, err
	}
	if !ok || order.UserSerial != strings.TrimSpace(serial) {
		return MallOrderPublic{}, errors.New("订单不存在")
	}
	if order.PaymentMethod != mallPaymentWechat || order.Status != MallOrderPendingPay {
		return MallOrderPublic{}, errors.New("当前订单不可发起微信支付")
	}
	if order.PaymentExpiresAt > 0 && time.Now().UnixMilli() >= order.PaymentExpiresAt {
		return MallOrderPublic{}, errors.New("支付订单已过期，请取消后重新下单")
	}
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode != "native" && mode != "h5" {
		return MallOrderPublic{}, errors.New("微信支付场景无效")
	}
	if order.PaymentMode != mode {
		order.PaymentMode = mode
		order.UpdatedAt = time.Now().UnixMilli()
		if err := s.repo.UpdateOrder(order, nil); err != nil {
			return MallOrderPublic{}, err
		}
	}
	return toPublicOrder(order), nil
}

func (s *MallService) MarkWechatOrderPaid(orderID, transactionID string, amountCents int64) (MallOrderPublic, error) {
	order, err := s.repo.MarkWechatOrderPaid(strings.TrimSpace(orderID), strings.TrimSpace(transactionID), amountCents)
	if err != nil {
		return MallOrderPublic{}, err
	}
	return toPublicOrder(order), nil
}

func (s *MallService) CancelMyPendingOrder(serial, orderID string) (MallOrderPublic, error) {
	order, err := s.repo.CancelPendingWechatOrder(strings.TrimSpace(serial), strings.TrimSpace(orderID))
	if err != nil {
		return MallOrderPublic{}, err
	}
	return toPublicOrder(order), nil
}

func (s *MallService) ListAdminOrders() ([]MallOrder, error) {
	items, err := s.repo.ListAllOrders()
	if err != nil {
		return nil, err
	}
	sort.SliceStable(items, func(i, j int) bool {
		return items[i].CreatedAt > items[j].CreatedAt
	})
	return items, nil
}

func (s *MallService) DecryptOrderContact(orderID string) (MallShippingPlain, error) {
	order, ok, err := s.repo.GetOrder(strings.TrimSpace(orderID))
	if err != nil {
		return MallShippingPlain{}, err
	}
	if !ok {
		return MallShippingPlain{}, errors.New("订单不存在")
	}
	name, err := DecryptActivityField(s.secret, order.NameEnc)
	if err != nil {
		return MallShippingPlain{}, err
	}
	phone, err := DecryptActivityField(s.secret, order.PhoneEnc)
	if err != nil {
		return MallShippingPlain{}, err
	}
	wechat, err := DecryptActivityField(s.secret, order.WechatEnc)
	if err != nil {
		return MallShippingPlain{}, err
	}
	qq, err := DecryptActivityField(s.secret, order.QQEnc)
	if err != nil {
		return MallShippingPlain{}, err
	}
	address, err := DecryptActivityField(s.secret, order.AddressEnc)
	if err != nil {
		return MallShippingPlain{}, err
	}
	return MallShippingPlain{
		Name: name, Phone: phone, Wechat: wechat, QQ: qq,
		Province: order.Province, City: order.City, Address: address,
	}, nil
}

func (s *MallService) UpdateOrderStatus(orderID, status, trackingNo string) (MallOrderPublic, error) {
	order, ok, err := s.repo.GetOrder(strings.TrimSpace(orderID))
	if err != nil {
		return MallOrderPublic{}, err
	}
	if !ok {
		return MallOrderPublic{}, errors.New("订单不存在")
	}
	status = strings.TrimSpace(status)
	trackingNo = strings.TrimSpace(trackingNo)
	now := time.Now().UnixMilli()
	prevStatus := order.Status
	stockDelta := map[string]int{}

	switch status {
	case MallOrderPendingPay, MallOrderPaid, MallOrderShipped, MallOrderCancelled:
	default:
		return MallOrderPublic{}, errors.New("订单状态无效")
	}
	if prevStatus == MallOrderCancelled && status != MallOrderCancelled {
		return MallOrderPublic{}, errors.New("已取消订单不可再改状态")
	}
	if order.PaymentMethod == mallPaymentWechat && prevStatus == MallOrderPendingPay && status != MallOrderPendingPay {
		return MallOrderPublic{}, errors.New("微信订单不能手动确认或取消，请等待支付回调或安全关单")
	}
	if status == MallOrderCancelled && prevStatus != MallOrderCancelled && isPointRedemptionOrder(order) {
		return MallOrderPublic{}, errors.New("积分兑换订单不能直接取消，请先人工退还积分")
	}
	if status == MallOrderCancelled && prevStatus != MallOrderCancelled {
		if order.PaymentMethod == mallPaymentWechat && (prevStatus == MallOrderPaid || prevStatus == MallOrderShipped) {
			return MallOrderPublic{}, errors.New("微信支付订单请先完成原路退款，再取消订单")
		}
		if order.StockReserved || prevStatus == MallOrderPaid || prevStatus == MallOrderShipped {
			for _, item := range order.Items {
				stockDelta[item.ProductID] += item.Quantity
			}
			order.StockReserved = false
		}
	}
	if (status == MallOrderPaid || status == MallOrderShipped) && prevStatus == MallOrderPendingPay && !order.StockReserved {
		for _, item := range order.Items {
			stockDelta[item.ProductID] -= item.Quantity
		}
		for pid, delta := range stockDelta {
			if delta >= 0 {
				continue
			}
			product, found, err := s.repo.GetProduct(pid)
			if err != nil {
				return MallOrderPublic{}, err
			}
			if !found {
				return MallOrderPublic{}, fmt.Errorf("商品不存在：%s", pid)
			}
			if product.Stock < -delta {
				return MallOrderPublic{}, fmt.Errorf("「%s」库存不足（剩余 %d）", product.Title, product.Stock)
			}
		}
		order.StockReserved = true
	}
	if status == MallOrderPaid && order.PaidAt <= 0 {
		order.PaidAt = now
	}
	if status == MallOrderShipped {
		if prevStatus != MallOrderPaid && prevStatus != MallOrderShipped && prevStatus != MallOrderPendingPay {
			return MallOrderPublic{}, errors.New("请先确认收款，再标记发货")
		}
		if trackingNo == "" && order.TrackingNo == "" {
			return MallOrderPublic{}, errors.New("发货请填写快递单号")
		}
		if order.ShippedAt <= 0 {
			order.ShippedAt = now
		}
		if order.PaidAt <= 0 {
			order.PaidAt = now
		}
	}
	order.Status = status
	if trackingNo != "" {
		order.TrackingNo = trackingNo
	}
	order.UpdatedAt = now
	if err := s.repo.UpdateOrder(order, stockDelta); err != nil {
		return MallOrderPublic{}, err
	}
	return toPublicOrder(order), nil
}
