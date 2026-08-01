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
	if input.PriceCents < 0 {
		return MallProduct{}, errors.New("价格不能为负数")
	}
	if input.Stock < 0 {
		return MallProduct{}, errors.New("库存不能为负数")
	}
	if input.Status == "" {
		input.Status = MallProductOnSale
	}
	if input.Status != MallProductOnSale && input.Status != MallProductOffSale {
		return MallProduct{}, errors.New("商品状态无效")
	}
	NormalizeMallProductImages(&input)
	product, err := s.repo.UpsertProduct(input)
	if err != nil {
		return MallProduct{}, err
	}
	NormalizeMallProductImages(&product)
	return product, nil
}

func toPublicOrder(o MallOrder) MallOrderPublic {
	return MallOrderPublic{
		ID: o.ID, Status: o.Status, Items: o.Items, TotalCents: o.TotalCents,
		Province: o.Province, City: o.City, TrackingNo: o.TrackingNo, Remark: o.Remark,
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

	merged := map[string]int{}
	for _, item := range input.Items {
		pid := strings.TrimSpace(item.ProductID)
		qty := item.Quantity
		if pid == "" || qty <= 0 {
			return MallOrderPublic{}, errors.New("商品数量无效")
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
	order := MallOrder{
		ID:         mallNewID("ord"),
		UserSerial: serial,
		Status:     MallOrderPendingPay,
		Items:      resolved,
		TotalCents: total,
		NameEnc:    nameEnc,
		PhoneEnc:   phoneEnc,
		WechatEnc:  wechatEnc,
		QQEnc:      qqEnc,
		Province:   province,
		City:       city,
		AddressEnc: addressEnc,
		Remark:     strings.TrimSpace(input.Remark),
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if err := s.repo.CreateOrder(order, nil); err != nil {
		return MallOrderPublic{}, err
	}
	return toPublicOrder(order), nil
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
	if status == MallOrderCancelled && prevStatus != MallOrderCancelled {
		if prevStatus == MallOrderPaid || prevStatus == MallOrderShipped {
			for _, item := range order.Items {
				stockDelta[item.ProductID] += item.Quantity
			}
		}
	}
	if (status == MallOrderPaid || status == MallOrderShipped) && prevStatus == MallOrderPendingPay {
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
