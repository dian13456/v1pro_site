import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SitePageLayout } from "../components/SitePageLayout";
import { MallProductGallery } from "../components/MallProductGallery";
import { MallProductImage } from "../components/MallProductImage";
import { MallOrderStatusBadge } from "../components/MallOrderStatusBadge";
import {
  SiteAlert,
  SiteButton,
  SiteEmptyBlock,
  SiteInput,
  SiteLoadingBlock,
  SitePanel,
  SiteSectionTitle,
  SiteTextarea,
  SITE_CONTENT_MEDIUM,
} from "../components/SiteUi";
import { useThemeMode } from "../hooks/useThemeMode";
import { hasValidLocalAuth } from "../services/authService";
import {
  clearMallCart,
  createMallOrder,
  fetchMallProducts,
  fetchMyMallOrders,
  loadMallCart,
  saveMallCart,
} from "../services/mallService";
import {
  deleteMallAddress,
  loadMallAddresses,
  saveMallAddress,
  toShippingInput,
} from "../services/mallAddressBook";
import type { MallOrder, MallProduct, MallSavedAddress } from "../types/mall";
import { formatMallPrice, getProductImages, MALL_MAX_SAVED_ADDRESSES } from "../types/mall";

const PHONE_PATTERN = /^1\d{10}$/;
const QQ_PATTERN = /^[1-9]\d{4,11}$/;

type TabKey = "shop" | "cart" | "orders";

export default function MallPage() {
  const navigate = useNavigate();
  const { theme, setTheme } = useThemeMode();
  const [tab, setTab] = useState<TabKey>("shop");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [products, setProducts] = useState<MallProduct[]>([]);
  const [orders, setOrders] = useState<MallOrder[]>([]);
  const [cart, setCart] = useState<Record<string, number>>(() => loadMallCart());
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [wechat, setWechat] = useState("");
  const [qq, setQq] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [remark, setRemark] = useState("");
  const [savedAddresses, setSavedAddresses] = useState<MallSavedAddress[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const autoFilledAddressRef = useRef(false);

  const applySavedAddress = (entry: MallSavedAddress) => {
    const shipping = toShippingInput(entry);
    setName(shipping.name);
    setPhone(shipping.phone);
    setWechat(shipping.wechat || "");
    setQq(shipping.qq);
    setProvince(shipping.province);
    setCity(shipping.city);
    setAddress(shipping.address);
    setSelectedAddressId(entry.id);
  };

  const refresh = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const [productList, orderList] = await Promise.all([fetchMallProducts(), fetchMyMallOrders()]);
      setProducts(productList);
      setOrders(orderList);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "加载商城失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    void refresh();
  }, [navigate]);

  useEffect(() => {
    saveMallCart(cart);
  }, [cart]);

  useEffect(() => {
    if (tab !== "cart") {
      autoFilledAddressRef.current = false;
      return;
    }
    const addresses = loadMallAddresses();
    setSavedAddresses(addresses);
    if (!autoFilledAddressRef.current && addresses.length > 0) {
      applySavedAddress(addresses[0]);
      autoFilledAddressRef.current = true;
    }
  }, [tab]);

  const cartLines = useMemo(() => {
    return products
      .map((product) => {
        const quantity = cart[product.id] || 0;
        if (quantity <= 0) return null;
        return { product, quantity };
      })
      .filter(Boolean) as Array<{ product: MallProduct; quantity: number }>;
  }, [products, cart]);

  const cartTotal = cartLines.reduce((sum, line) => sum + line.product.priceCents * line.quantity, 0);
  const cartCount = cartLines.reduce((sum, line) => sum + line.quantity, 0);

  const setQty = (productId: string, quantity: number) => {
    setCart((prev) => {
      const next = { ...prev };
      if (quantity <= 0) {
        delete next[productId];
      } else {
        next[productId] = quantity;
      }
      return next;
    });
  };

  const handleSaveAddress = () => {
    if (!name.trim() || !phone.trim() || !qq.trim() || !province.trim() || !city.trim() || !address.trim()) {
      setErrorMessage("请先完整填写收货信息再保存");
      return;
    }
    if (!PHONE_PATTERN.test(phone.trim())) {
      setErrorMessage("手机号格式不正确");
      return;
    }
    if (!QQ_PATTERN.test(qq.trim())) {
      setErrorMessage("QQ 号格式不正确");
      return;
    }
    try {
      const result = saveMallAddress(
        { name, phone, wechat, qq, province, city, address },
        selectedAddressId || undefined,
      );
      setSavedAddresses(result.addresses);
      setSelectedAddressId(result.address.id);
      setNotice(`地址已保存（${result.addresses.length}/${MALL_MAX_SAVED_ADDRESSES}）`);
      setErrorMessage("");
    } catch (err) {
      setErrorMessage((err as Error)?.message || "保存地址失败");
    }
  };

  const handleDeleteAddress = (id: string) => {
    const next = deleteMallAddress(id);
    setSavedAddresses(next);
    if (selectedAddressId === id) {
      setSelectedAddressId("");
    }
    setNotice(`地址已删除（${next.length}/${MALL_MAX_SAVED_ADDRESSES}）`);
  };

  const handleCheckout = async () => {
    if (submitting) return;
    if (cartLines.length === 0) {
      setErrorMessage("购物车为空");
      return;
    }
    if (!name.trim() || !phone.trim() || !qq.trim() || !province.trim() || !city.trim() || !address.trim()) {
      setErrorMessage("请完整填写收货信息");
      return;
    }
    if (!PHONE_PATTERN.test(phone.trim())) {
      setErrorMessage("手机号格式不正确");
      return;
    }
    if (!QQ_PATTERN.test(qq.trim())) {
      setErrorMessage("QQ 号格式不正确");
      return;
    }
    setSubmitting(true);
    setErrorMessage("");
    setNotice("");
    try {
      const result = await createMallOrder(
        cartLines.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        { name, phone, wechat, qq, province, city, address, remark },
      );
      try {
        const saved = saveMallAddress(
          { name, phone, wechat, qq, province, city, address },
          selectedAddressId || undefined,
        );
        setSavedAddresses(saved.addresses);
        setSelectedAddressId(saved.address.id);
      } catch {
        // 下单成功优先；地址簿已满时不阻断订单
      }
      clearMallCart();
      setCart({});
      setNotice(
        `${result.message}\n订单号：${result.order.id}\n应付：${formatMallPrice(result.order.totalCents)}（请按页面说明联系客服付款）`,
      );
      setTab("orders");
      await refresh();
    } catch (err) {
      setErrorMessage((err as Error)?.message || "下单失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SitePageLayout
      subtitle="实物商城 · 下单填写地址 · 人工确认收款后发货"
      theme={theme}
      onSetTheme={setTheme}
      contentClassName={SITE_CONTENT_MEDIUM}
    >
      <SitePanel>
        <SiteSectionTitle
          title="实物商城"
          description="当前未接入在线支付。下单后请按提示完成转账/收款，管理员确认后发货。"
          action={
            <div className="flex flex-wrap gap-2">
              <SiteButton variant={tab === "shop" ? "primary" : "secondary"} onClick={() => setTab("shop")}>
                商品
              </SiteButton>
              <SiteButton variant={tab === "cart" ? "primary" : "secondary"} onClick={() => setTab("cart")}>
                购物车{cartCount > 0 ? ` (${cartCount})` : ""}
              </SiteButton>
              <SiteButton variant={tab === "orders" ? "primary" : "secondary"} onClick={() => setTab("orders")}>
                我的订单
              </SiteButton>
            </div>
          }
        />
      </SitePanel>

      {notice ? (
        <SiteAlert variant="success">
          <pre className="whitespace-pre-wrap font-sans">{notice}</pre>
        </SiteAlert>
      ) : null}
      {errorMessage ? <SiteAlert variant="error">{errorMessage}</SiteAlert> : null}
      {loading ? <SiteLoadingBlock>加载商城…</SiteLoadingBlock> : null}

      {!loading && tab === "shop" ? (
        products.length === 0 ? (
          <SiteEmptyBlock>暂无商品，请稍后再来或联系管理员上架。</SiteEmptyBlock>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => {
              const inCart = cart[product.id] || 0;
              return (
                <SitePanel key={product.id} className="flex h-full flex-col">
                  <MallProductGallery
                    imageUrls={getProductImages(product)}
                    title={product.title}
                    className="mb-3 h-44 w-full"
                  />
                  <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{product.title}</h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{product.description}</p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xl font-semibold text-violet-700 dark:text-violet-200">
                        {formatMallPrice(product.priceCents)}
                      </div>
                      <div className="text-xs text-slate-500">库存 {product.stock}</div>
                    </div>
                    <SiteButton
                      disabled={product.stock <= 0}
                      onClick={() => setQty(product.id, Math.min(product.stock, inCart + 1))}
                    >
                      {product.stock <= 0 ? "缺货" : inCart > 0 ? `已加 ${inCart}` : "加入购物车"}
                    </SiteButton>
                  </div>
                </SitePanel>
              );
            })}
          </div>
        )
      ) : null}

      {!loading && tab === "cart" ? (
        <div className="space-y-4">
          {cartLines.length === 0 ? (
            <SiteEmptyBlock>购物车是空的，去商品页挑几件吧。</SiteEmptyBlock>
          ) : (
            <SitePanel>
              <ul className="space-y-3">
                {cartLines.map(({ product, quantity }) => (
                  <li key={product.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-white/20 pb-3 last:border-0">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <MallProductImage
                        imageUrl={getProductImages(product)[0]}
                        title={product.title}
                        className="h-16 w-16 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-800 dark:text-slate-100">{product.title}</div>
                        <div className="text-sm text-slate-500">
                          {formatMallPrice(product.priceCents)} × {quantity}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <SiteButton variant="secondary" onClick={() => setQty(product.id, quantity - 1)}>
                        -
                      </SiteButton>
                      <span className="w-8 text-center">{quantity}</span>
                      <SiteButton
                        variant="secondary"
                        onClick={() => setQty(product.id, Math.min(product.stock, quantity + 1))}
                      >
                        +
                      </SiteButton>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-4 text-right text-lg font-semibold text-violet-700 dark:text-violet-200">
                合计 {formatMallPrice(cartTotal)}
              </div>
            </SitePanel>
          )}

          <SitePanel>
            <SiteSectionTitle
              title="收货信息"
              description={`姓名、手机、QQ、省市与详细地址必填。可保存常用地址，最多 ${MALL_MAX_SAVED_ADDRESSES} 条。`}
              action={
                <SiteButton type="button" variant="secondary" onClick={handleSaveAddress}>
                  保存当前地址
                </SiteButton>
              }
            />

            {savedAddresses.length > 0 ? (
              <div className="mb-4 space-y-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  已保存地址 {savedAddresses.length}/{MALL_MAX_SAVED_ADDRESSES}，点击可快速填入
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {savedAddresses.map((entry) => {
                    const active = entry.id === selectedAddressId;
                    return (
                      <div
                        key={entry.id}
                        className={`rounded-xl border p-3 text-sm transition ${
                          active
                            ? "border-violet-500 bg-violet-50/80 dark:border-violet-400 dark:bg-violet-950/30"
                            : "border-white/30 bg-white/50 dark:border-white/10 dark:bg-slate-950/30"
                        }`}
                      >
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() => applySavedAddress(entry)}
                        >
                          <div className="font-medium text-slate-800 dark:text-slate-100">
                            {entry.name} · {entry.phone}
                          </div>
                          <div className="mt-1 text-slate-600 dark:text-slate-300">
                            {entry.province} {entry.city}
                          </div>
                          <div className="mt-1 line-clamp-2 text-slate-500 dark:text-slate-400">{entry.address}</div>
                        </button>
                        <div className="mt-2 flex justify-end">
                          <SiteButton type="button" variant="secondary" onClick={() => handleDeleteAddress(entry.id)}>
                            删除
                          </SiteButton>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <SiteInput placeholder="收件人" value={name} onChange={(e) => { setName(e.target.value); setSelectedAddressId(""); }} />
              <SiteInput placeholder="手机号" value={phone} onChange={(e) => { setPhone(e.target.value); setSelectedAddressId(""); }} />
              <SiteInput placeholder="QQ" value={qq} onChange={(e) => { setQq(e.target.value); setSelectedAddressId(""); }} />
              <SiteInput placeholder="微信（可选）" value={wechat} onChange={(e) => { setWechat(e.target.value); setSelectedAddressId(""); }} />
              <SiteInput placeholder="省" value={province} onChange={(e) => { setProvince(e.target.value); setSelectedAddressId(""); }} />
              <SiteInput placeholder="市" value={city} onChange={(e) => { setCity(e.target.value); setSelectedAddressId(""); }} />
            </div>
            <div className="mt-3">
              <SiteTextarea placeholder="详细地址" value={address} onChange={(e) => { setAddress(e.target.value); setSelectedAddressId(""); }} rows={3} />
            </div>
            <div className="mt-3">
              <SiteTextarea placeholder="备注（可选）" value={remark} onChange={(e) => setRemark(e.target.value)} rows={2} />
            </div>
            <div className="mt-4 flex justify-end">
              <SiteButton disabled={submitting || cartLines.length === 0} onClick={() => void handleCheckout()}>
                {submitting ? "提交中…" : "提交订单（待确认收款）"}
              </SiteButton>
            </div>
          </SitePanel>
        </div>
      ) : null}

      {!loading && tab === "orders" ? (
        orders.length === 0 ? (
          <SiteEmptyBlock>暂无订单，下单后会显示在这里。</SiteEmptyBlock>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <SitePanel key={order.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-800 dark:text-slate-100">订单 {order.id}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <MallOrderStatusBadge status={order.status} />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        {formatMallPrice(order.totalCents)}
                      </span>
                    </div>
                  </div>
                  {order.trackingNo ? (
                    <div className="text-sm text-emerald-600 dark:text-emerald-300">快递：{order.trackingNo}</div>
                  ) : null}
                </div>
                <ul className="mt-2 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                  {order.items.map((item) => (
                    <li key={`${order.id}-${item.productId}`} className="flex items-center gap-3">
                      <MallProductImage
                        imageUrl={item.imageUrl}
                        title={item.title}
                        className="h-12 w-12 shrink-0"
                      />
                      <span>
                        {item.title} × {item.quantity}（{formatMallPrice(item.priceCents)}）
                      </span>
                    </li>
                  ))}
                </ul>
                {(order.province || order.city) && (
                  <p className="mt-2 text-xs text-slate-500">
                    收货地区：{order.province} {order.city}
                  </p>
                )}
              </SitePanel>
            ))}
          </div>
        )
      ) : null}
    </SitePageLayout>
  );
}
