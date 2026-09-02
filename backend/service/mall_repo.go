package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type MallRepo struct {
	backend string
	path    string
	mysql   *mallMySQLStore
	mu      sync.Mutex
	cache   MallDataStore
	loaded  bool
}

func NewMallRepo(configDir string) (*MallRepo, error) {
	if strings.TrimSpace(configDir) == "" {
		configDir = "config"
	}
	backend := strings.ToLower(strings.TrimSpace(os.Getenv("STORAGE_BACKEND")))
	if backend == "" {
		backend = "json"
	}
	repo := &MallRepo{
		backend: backend,
		path:    filepath.Join(configDir, "mall_store.json"),
	}
	if backend == "mysql" {
		store, err := openMallMySQLStore(os.Getenv("MYSQL_DSN"))
		if err != nil {
			return nil, err
		}
		repo.mysql = store
	}
	return repo, nil
}

func (r *MallRepo) Close() error {
	if r == nil || r.mysql == nil {
		return nil
	}
	return r.mysql.Close()
}

func (r *MallRepo) UsesMySQL() bool {
	return r != nil && r.backend == "mysql" && r.mysql != nil
}

func (r *MallRepo) ctx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 12*time.Second)
}

func defaultMallProducts() []MallProduct {
	now := time.Now().UnixMilli()
	return []MallProduct{
		{
			ID:          "mall-shell-sample",
			Title:       "V1PRO 实体周边（示例）",
			Description: "示例商品，可在管理后台改价、改库存或下架。下单后需人工确认收款再发货。",
			ImageURL:    "",
			PriceCents:  9900,
			Stock:       20,
			Status:      MallProductOnSale,
			SortOrder:   1,
			CreatedAt:   now,
			UpdatedAt:   now,
		},
	}
}

func (r *MallRepo) loadJSONLocked() error {
	if r.loaded {
		return nil
	}
	raw, err := os.ReadFile(r.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			r.cache = MallDataStore{Products: defaultMallProducts(), Orders: []MallOrder{}}
			r.loaded = true
			return r.saveJSONLocked()
		}
		return err
	}
	var store MallDataStore
	if err := json.Unmarshal(raw, &store); err != nil {
		return err
	}
	if store.Products == nil {
		store.Products = defaultMallProducts()
	}
	if store.Orders == nil {
		store.Orders = []MallOrder{}
	}
	r.cache = store
	r.loaded = true
	return nil
}

func (r *MallRepo) saveJSONLocked() error {
	if err := os.MkdirAll(filepath.Dir(r.path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(r.cache, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(r.path, append(raw, '\n'), 0o644)
}

func (r *MallRepo) commitJSONLocked(next MallDataStore) error {
	previous := r.cache
	r.cache = next
	if err := r.saveJSONLocked(); err != nil {
		r.cache = previous
		return err
	}
	return nil
}

func mallNewID(prefix string) string {
	buf := make([]byte, 8)
	_, _ = rand.Read(buf)
	return fmt.Sprintf("%s-%s-%d", prefix, hex.EncodeToString(buf), time.Now().UnixMilli()%100000)
}

func (r *MallRepo) ListProducts(includeOffSale bool) ([]MallProduct, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.ListProducts(ctx, includeOffSale)
	}
	if err := r.loadJSONLocked(); err != nil {
		return nil, err
	}
	out := make([]MallProduct, 0, len(r.cache.Products))
	for _, p := range r.cache.Products {
		if !includeOffSale && p.Status != MallProductOnSale {
			continue
		}
		item := p
		NormalizeMallProductImages(&item)
		out = append(out, item)
	}
	return out, nil
}

func (r *MallRepo) UpsertProduct(product MallProduct) (MallProduct, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UnixMilli()
	if strings.TrimSpace(product.ID) == "" {
		product.ID = mallNewID("prod")
		product.CreatedAt = now
	}
	product.UpdatedAt = now
	if product.Status == "" {
		product.Status = MallProductOnSale
	}
	NormalizeMallProductImages(&product)
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		if err := r.mysql.UpsertProduct(ctx, product); err != nil {
			return MallProduct{}, err
		}
		return product, nil
	}
	if err := r.loadJSONLocked(); err != nil {
		return MallProduct{}, err
	}
	found := false
	for i, item := range r.cache.Products {
		if item.ID == product.ID {
			if product.CreatedAt <= 0 {
				product.CreatedAt = item.CreatedAt
			}
			r.cache.Products[i] = product
			found = true
			break
		}
	}
	if !found {
		if product.CreatedAt <= 0 {
			product.CreatedAt = now
		}
		r.cache.Products = append(r.cache.Products, product)
	}
	if err := r.saveJSONLocked(); err != nil {
		return MallProduct{}, err
	}
	return product, nil
}

func (r *MallRepo) HasPendingOrdersForProduct(productID string) (bool, error) {
	productID = strings.TrimSpace(productID)
	if productID == "" {
		return false, nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.HasPendingOrdersForProduct(ctx, productID)
	}
	if err := r.loadJSONLocked(); err != nil {
		return false, err
	}
	for _, o := range r.cache.Orders {
		if o.Status != MallOrderPendingPay {
			continue
		}
		for _, item := range o.Items {
			if item.ProductID == productID {
				return true, nil
			}
		}
	}
	return false, nil
}

func (r *MallRepo) DeleteProduct(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("商品 ID 不能为空")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.DeleteProduct(ctx, id)
	}
	if err := r.loadJSONLocked(); err != nil {
		return err
	}
	next := make([]MallProduct, 0, len(r.cache.Products))
	found := false
	for _, p := range r.cache.Products {
		if p.ID == id {
			found = true
			continue
		}
		next = append(next, p)
	}
	if !found {
		return errors.New("商品不存在")
	}
	r.cache.Products = next
	return r.saveJSONLocked()
}

func (r *MallRepo) GetProduct(id string) (MallProduct, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.GetProduct(ctx, id)
	}
	if err := r.loadJSONLocked(); err != nil {
		return MallProduct{}, false, err
	}
	for _, p := range r.cache.Products {
		if p.ID == id {
			return p, true, nil
		}
	}
	return MallProduct{}, false, nil
}

func (r *MallRepo) CreateOrder(order MallOrder, stockDelta map[string]int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.CreateOrder(ctx, order, stockDelta)
	}
	if err := r.loadJSONLocked(); err != nil {
		return err
	}
	next := MallDataStore{
		Products: append([]MallProduct(nil), r.cache.Products...),
		Orders:   append([]MallOrder(nil), r.cache.Orders...),
	}
	for pid, delta := range stockDelta {
		found := false
		for i, p := range next.Products {
			if p.ID != pid {
				continue
			}
			stockAfter := p.Stock + delta
			if stockAfter < 0 {
				return fmt.Errorf("商品「%s」库存不足", p.Title)
			}
			next.Products[i].Stock = stockAfter
			next.Products[i].UpdatedAt = time.Now().UnixMilli()
			found = true
			break
		}
		if !found {
			return fmt.Errorf("商品不存在：%s", pid)
		}
	}
	next.Orders = append(next.Orders, order)
	return r.commitJSONLocked(next)
}

func (r *MallRepo) ListOrdersByUser(serial string) ([]MallOrder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.ListOrdersByUser(ctx, serial)
	}
	if err := r.loadJSONLocked(); err != nil {
		return nil, err
	}
	out := make([]MallOrder, 0)
	for _, o := range r.cache.Orders {
		if o.UserSerial == serial {
			out = append(out, o)
		}
	}
	return out, nil
}

func (r *MallRepo) ListAllOrders() ([]MallOrder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.ListAllOrders(ctx)
	}
	if err := r.loadJSONLocked(); err != nil {
		return nil, err
	}
	out := make([]MallOrder, len(r.cache.Orders))
	copy(out, r.cache.Orders)
	return out, nil
}

func (r *MallRepo) GetOrder(id string) (MallOrder, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.GetOrder(ctx, id)
	}
	if err := r.loadJSONLocked(); err != nil {
		return MallOrder{}, false, err
	}
	for _, o := range r.cache.Orders {
		if o.ID == id {
			return o, true, nil
		}
	}
	return MallOrder{}, false, nil
}

func (r *MallRepo) UpdateOrder(order MallOrder, stockDelta map[string]int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.UpdateOrder(ctx, order, stockDelta)
	}
	if err := r.loadJSONLocked(); err != nil {
		return err
	}
	next := MallDataStore{
		Products: append([]MallProduct(nil), r.cache.Products...),
		Orders:   append([]MallOrder(nil), r.cache.Orders...),
	}
	found := false
	for i, o := range next.Orders {
		if o.ID == order.ID {
			next.Orders[i] = order
			found = true
			break
		}
	}
	if !found {
		return errors.New("订单不存在")
	}
	for pid, delta := range stockDelta {
		if delta == 0 {
			continue
		}
		productFound := false
		for i, p := range next.Products {
			if p.ID != pid {
				continue
			}
			stockAfter := p.Stock + delta
			if stockAfter < 0 {
				return fmt.Errorf("商品「%s」库存不足", p.Title)
			}
			next.Products[i].Stock = stockAfter
			next.Products[i].UpdatedAt = time.Now().UnixMilli()
			productFound = true
			break
		}
		if !productFound {
			return fmt.Errorf("商品不存在：%s", pid)
		}
	}
	return r.commitJSONLocked(next)
}

func (r *MallRepo) MarkWechatOrderPaid(orderID, transactionID string, amountCents int64) (MallOrder, error) {
	if orderID == "" || transactionID == "" {
		return MallOrder{}, errors.New("微信支付交易信息不完整")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.MarkWechatOrderPaid(ctx, orderID, transactionID, amountCents)
	}
	if err := r.loadJSONLocked(); err != nil {
		return MallOrder{}, err
	}
	next := MallDataStore{
		Products: append([]MallProduct(nil), r.cache.Products...),
		Orders:   append([]MallOrder(nil), r.cache.Orders...),
	}
	orderIndex := -1
	for i := range next.Orders {
		if next.Orders[i].ID == orderID {
			orderIndex = i
			break
		}
	}
	if orderIndex < 0 {
		return MallOrder{}, errors.New("订单不存在")
	}
	order := next.Orders[orderIndex]
	if order.PaymentMethod != mallPaymentWechat || order.PaymentTradeNo != orderID {
		return MallOrder{}, errors.New("订单支付信息不匹配")
	}
	if amountCents <= 0 || order.TotalCents != amountCents {
		return MallOrder{}, errors.New("微信支付金额与订单不一致")
	}
	if order.Status == MallOrderCancelled {
		return MallOrder{}, errors.New("已取消订单收到付款通知，请人工核查并退款")
	}
	if order.PaymentTransactionID != "" && order.PaymentTransactionID != transactionID {
		return MallOrder{}, errors.New("订单微信支付交易号冲突")
	}
	if order.Status == MallOrderPaid || order.Status == MallOrderShipped {
		if order.PaymentTransactionID == "" {
			order.PaymentTransactionID = transactionID
			order.UpdatedAt = time.Now().UnixMilli()
			next.Orders[orderIndex] = order
			if err := r.commitJSONLocked(next); err != nil {
				return MallOrder{}, err
			}
		}
		return order, nil
	}
	if order.Status != MallOrderPendingPay {
		return MallOrder{}, errors.New("当前订单状态无法确认微信付款")
	}
	if !order.StockReserved {
		needed := map[string]int{}
		for _, item := range order.Items {
			needed[item.ProductID] += item.Quantity
		}
		for productID, quantity := range needed {
			found := false
			for _, product := range next.Products {
				if product.ID != productID {
					continue
				}
				found = true
				if product.Stock < quantity {
					return MallOrder{}, fmt.Errorf("微信付款成功但商品库存不足：%s", productID)
				}
				break
			}
			if !found {
				return MallOrder{}, fmt.Errorf("商品不存在：%s", productID)
			}
		}
		for productID, quantity := range needed {
			for i := range next.Products {
				if next.Products[i].ID == productID {
					next.Products[i].Stock -= quantity
					next.Products[i].UpdatedAt = time.Now().UnixMilli()
					break
				}
			}
		}
	}
	now := time.Now().UnixMilli()
	order.Status = MallOrderPaid
	order.PaymentTransactionID = transactionID
	order.StockReserved = true
	order.PaidAt = now
	order.UpdatedAt = now
	next.Orders[orderIndex] = order
	if err := r.commitJSONLocked(next); err != nil {
		return MallOrder{}, err
	}
	return order, nil
}

func (r *MallRepo) CancelPendingWechatOrder(serial, orderID string) (MallOrder, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.UsesMySQL() {
		ctx, cancel := r.ctx()
		defer cancel()
		return r.mysql.CancelPendingWechatOrder(ctx, serial, orderID)
	}
	if err := r.loadJSONLocked(); err != nil {
		return MallOrder{}, err
	}
	next := MallDataStore{
		Products: append([]MallProduct(nil), r.cache.Products...),
		Orders:   append([]MallOrder(nil), r.cache.Orders...),
	}
	orderIndex := -1
	for i := range next.Orders {
		if next.Orders[i].ID == orderID && next.Orders[i].UserSerial == serial {
			orderIndex = i
			break
		}
	}
	if orderIndex < 0 {
		return MallOrder{}, errors.New("订单不存在")
	}
	order := next.Orders[orderIndex]
	if order.PaymentMethod != mallPaymentWechat || order.Status != MallOrderPendingPay {
		return MallOrder{}, errors.New("当前订单不可取消")
	}
	if order.StockReserved {
		for _, item := range order.Items {
			for i := range next.Products {
				if next.Products[i].ID == item.ProductID {
					next.Products[i].Stock += item.Quantity
					next.Products[i].UpdatedAt = time.Now().UnixMilli()
					break
				}
			}
		}
	}
	order.Status = MallOrderCancelled
	order.StockReserved = false
	order.UpdatedAt = time.Now().UnixMilli()
	next.Orders[orderIndex] = order
	if err := r.commitJSONLocked(next); err != nil {
		return MallOrder{}, err
	}
	return order, nil
}

func (r *MallRepo) EnsureSeedProducts() error {
	products, err := r.ListProducts(true)
	if err != nil {
		return err
	}
	if len(products) > 0 {
		return nil
	}
	for _, p := range defaultMallProducts() {
		if _, err := r.UpsertProduct(p); err != nil {
			return err
		}
	}
	return nil
}
