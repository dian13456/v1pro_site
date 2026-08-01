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
	for pid, delta := range stockDelta {
		found := false
		for i, p := range r.cache.Products {
			if p.ID != pid {
				continue
			}
			next := p.Stock + delta
			if next < 0 {
				return fmt.Errorf("商品「%s」库存不足", p.Title)
			}
			r.cache.Products[i].Stock = next
			r.cache.Products[i].UpdatedAt = time.Now().UnixMilli()
			found = true
			break
		}
		if !found {
			return fmt.Errorf("商品不存在：%s", pid)
		}
	}
	r.cache.Orders = append(r.cache.Orders, order)
	return r.saveJSONLocked()
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
	found := false
	for i, o := range r.cache.Orders {
		if o.ID == order.ID {
			r.cache.Orders[i] = order
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
		for i, p := range r.cache.Products {
			if p.ID != pid {
				continue
			}
			next := p.Stock + delta
			if next < 0 {
				return fmt.Errorf("商品「%s」库存不足", p.Title)
			}
			r.cache.Products[i].Stock = next
			r.cache.Products[i].UpdatedAt = time.Now().UnixMilli()
			productFound = true
			break
		}
		if !productFound {
			return fmt.Errorf("商品不存在：%s", pid)
		}
	}
	return r.saveJSONLocked()
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
