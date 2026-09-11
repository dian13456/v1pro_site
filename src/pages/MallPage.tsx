import { translate as t, useI18n } from "../i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import QRCode from "qrcode";
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
  cancelMallOrder,
  createMallOrder,
  createMallWeChatPayment,
  fetchMallOrder,
  fetchMallPaymentCapabilities,
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
import type {
  MallOrder,
  MallProduct,
  MallSavedAddress,
  MallWeChatPayCapabilities,
  MallWeChatPayment,
} from "../types/mall";
import { formatMallPrice, getProductImages, MALL_MAX_SAVED_ADDRESSES } from "../types/mall";

const PHONE_PATTERN = /^1\d{10}$/;
const QQ_PATTERN = /^[1-9]\d{4,11}$/;

type TabKey = "shop" | "cart" | "orders";

function PaymentDialog({
  order,
  payment,
  onClose,
  onPaid,
}: {
  order: MallOrder;
  payment: MallWeChatPayment;
  onClose: () => void;
  onPaid: (order: MallOrder) => void;
}) {
  useI18n();
  const [qrImage, setQrImage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    Math.max(0, Math.ceil((payment.expiresAt - Date.now()) / 1000)),
  );
  const onPaidRef = useRef(onPaid);

  useEffect(() => {
    onPaidRef.current = onPaid;
  }, [onPaid]);

  useEffect(() => {
    let cancelled = false;
    if (!payment.codeUrl) return () => { cancelled = true; };
    void QRCode.toDataURL(payment.codeUrl, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setQrImage(url);
      })
      .catch(() => {
        if (!cancelled) setErrorMessage("支付二维码生成失败，请关闭后重试");
      });
    return () => { cancelled = true; };
  }, [payment.codeUrl]);

  useEffect(() => {
    let disposed = false;
    let checking = false;
    const check = async () => {
      if (checking || disposed) return;
      checking = true;
      try {
        const latest = await fetchMallOrder(order.id);
        if (!disposed && (latest.status === "paid" || latest.status === "shipped")) {
          onPaidRef.current(latest);
        }
      } catch {
        // 短暂网络错误不关闭支付窗口，下一轮继续查询。
      } finally {
        checking = false;
      }
    };
    void check();
    const pollTimer = window.setInterval(() => void check(), 2500);
    const countdownTimer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((payment.expiresAt - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        window.clearInterval(pollTimer);
      }
    }, 1000);
    return () => {
      disposed = true;
      window.clearInterval(pollTimer);
      window.clearInterval(countdownTimer);
    };
  }, [order.id, payment.expiresAt]);

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const h5Target = payment.h5Url
    ? `${payment.h5Url}${payment.h5Url.includes("?") ? "&" : "?"}redirect_url=${encodeURIComponent(window.location.href)}`
    : "";

  return (
    <div className="fixed inset-0 z-[180] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t("微信支付")}>
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-[28px] border border-white/70 bg-white p-6 text-center shadow-[0_30px_100px_rgba(15,23,42,.35)] dark:border-white/10 dark:bg-slate-900">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#07c160]/10 text-2xl">✓</div>
        <h2 className="mt-3 text-xl font-semibold text-slate-900 dark:text-white">{t("微信支付")}</h2>
        <p className="mt-1 text-sm text-slate-500">{t("订单")}{" "}{order.id}</p>
        <p className="mt-3 text-3xl font-semibold text-slate-900 dark:text-white">{formatMallPrice(order.totalCents)}</p>

        {payment.codeUrl ? (
          <div className="mx-auto mt-4 w-fit rounded-3xl border border-slate-200 bg-white p-3 shadow-inner">
            {qrImage ? <img src={qrImage} alt={t("微信支付二维码")} className="h-64 w-64" /> : <div className="grid h-64 w-64 place-items-center text-sm text-slate-400">{t("正在生成二维码…")}</div>}
          </div>
        ) : null}
        {h5Target ? (
          <a href={h5Target} className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[#07c160] px-5 font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-[#06ad56]">{t("打开微信完成支付")}{" "}</a>
        ) : null}

        <p className="mt-4 text-sm text-slate-500">
          {remainingSeconds > 0 ? t("请在 {v0}:{v1} 内完成支付", undefined, { v0: minutes, v1: seconds.toString().padStart(2, "0") }) : t("支付二维码已过期，请关闭后取消订单或重新下单")}
        </p>
        <p className="mt-1 text-xs text-slate-400">{t("支付结果以微信支付服务器通知为准，本页面会自动更新")}</p>
        {errorMessage ? <p className="mt-3 text-sm text-rose-600">{t(errorMessage)}</p> : null}
        <button type="button" className="mt-5 h-11 w-full rounded-2xl border border-slate-200 font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" onClick={onClose}>{t("稍后支付")}{" "}</button>
      </div>
    </div>
  );
}

export default function MallPage() {
  useI18n();
  const navigate = useNavigate();
  const { theme, setTheme } = useThemeMode();
  const [tab, setTab] = useState<TabKey>("shop");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [products, setProducts] = useState<MallProduct[]>([]);
  const [orders, setOrders] = useState<MallOrder[]>([]);
  const [paymentCapabilities, setPaymentCapabilities] = useState<MallWeChatPayCapabilities>({
    enabled: false,
    modes: [],
    expireMinutes: 15,
  });
  const [activePayment, setActivePayment] = useState<{ order: MallOrder; payment: MallWeChatPayment } | null>(null);
  const [paymentBusyId, setPaymentBusyId] = useState("");
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
      const [productList, orderList, payCapabilities] = await Promise.all([
        fetchMallProducts(),
        fetchMyMallOrders(),
        fetchMallPaymentCapabilities(),
      ]);
      setProducts(productList);
      setOrders(orderList);
      setPaymentCapabilities(payCapabilities);
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

  const beginWechatPayment = async (order: MallOrder) => {
    if (paymentBusyId) return;
    if (!paymentCapabilities.enabled) {
      setErrorMessage("微信在线支付尚未启用，请稍后再试");
      return;
    }
    const userAgent = navigator.userAgent;
    const isMobileBrowser = /Android|iPhone|iPad|iPod/i.test(userAgent);
    const isWechatBrowser = /MicroMessenger/i.test(userAgent);
    const canUseH5 = paymentCapabilities.modes.includes("h5");
    const mode: "native" | "h5" = isMobileBrowser && !isWechatBrowser && canUseH5 ? "h5" : "native";
    setPaymentBusyId(order.id);
    setErrorMessage("");
    try {
      const result = await createMallWeChatPayment(order.id, mode);
      setActivePayment(result);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "创建微信支付失败");
    } finally {
      setPaymentBusyId("");
    }
  };

  const handlePaymentConfirmed = (paidOrder: MallOrder) => {
    setActivePayment(null);
    setNotice(t("微信支付成功\n订单号：{v0}\n实付：{v1}", undefined, { v0: paidOrder.id, v1: formatMallPrice(paidOrder.totalCents) }));
    setTab("orders");
    void refresh();
  };

  const handleCancelOrder = async (order: MallOrder) => {
    if (paymentBusyId || !window.confirm(t("确定取消订单 {v0} 吗？取消后会释放库存。", undefined, { v0: order.id }))) return;
    setPaymentBusyId(order.id);
    setErrorMessage("");
    try {
      await cancelMallOrder(order.id);
      setNotice(t("订单 {v0} 已取消，库存已释放", undefined, { v0: order.id }));
      await refresh();
    } catch (err) {
      setErrorMessage((err as Error)?.message || "取消订单失败");
    } finally {
      setPaymentBusyId("");
    }
  };

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
      setNotice(t("地址已保存（{v0}/{v1}）", undefined, { v0: result.addresses.length, v1: MALL_MAX_SAVED_ADDRESSES }));
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
    setNotice(t("地址已删除（{v0}/{v1}）", undefined, { v0: next.length, v1: MALL_MAX_SAVED_ADDRESSES }));
  };

  const handleCheckout = async () => {
    if (submitting) return;
    if (cartLines.length === 0) {
      setErrorMessage("购物车为空");
      return;
    }
    if (!paymentCapabilities.enabled) {
      setErrorMessage("微信在线支付尚未启用，暂时无法提交订单");
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
      setNotice(t("{v0}\n订单号：{v1}\n应付：{v2}", undefined, { v0: result.message, v1: result.order.id, v2: formatMallPrice(result.order.totalCents) }));
      setTab("orders");
      await beginWechatPayment(result.order);
      await refresh();
    } catch (err) {
      setErrorMessage((err as Error)?.message || "下单失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SitePageLayout
      subtitle={t("实物商城 · 微信在线支付 · 支付成功后安排发货")}
      theme={theme}
      onSetTheme={setTheme}
      contentClassName={SITE_CONTENT_MEDIUM}
    >
      <SitePanel>
        <SiteSectionTitle
          title={t("实物商城")}
          description={t("订单金额由后端按商品实时计算，支持微信扫码支付；支付成功以后端回调结果为准。")}
          action={
            <div className="flex flex-wrap gap-2">
              <SiteButton variant={tab === "shop" ? "primary" : "secondary"} onClick={() => setTab("shop")}>{t("商品")}{" "}</SiteButton>
              <SiteButton variant={tab === "cart" ? "primary" : "secondary"} onClick={() => setTab("cart")}>{t("购物车")}{cartCount > 0 ? ` (${cartCount})` : ""}
              </SiteButton>
              <SiteButton variant={tab === "orders" ? "primary" : "secondary"} onClick={() => setTab("orders")}>{t("我的订单")}{" "}</SiteButton>
            </div>
          }
        />
      </SitePanel>

      {notice ? (
        <SiteAlert variant="success">
          <pre className="whitespace-pre-wrap font-sans">{t(notice)}</pre>
        </SiteAlert>
      ) : null}
      {errorMessage ? <SiteAlert variant="error">{t(errorMessage)}</SiteAlert> : null}
      {!loading && !paymentCapabilities.enabled ? (
        <SiteAlert variant="info">{t("微信在线支付正在配置，当前暂时不能提交新订单。")}</SiteAlert>
      ) : null}
      {loading ? <SiteLoadingBlock>{t("加载商城…")}</SiteLoadingBlock> : null}

      {!loading && tab === "shop" ? (
        products.length === 0 ? (
          <SiteEmptyBlock>{t("暂无商品，请稍后再来或联系管理员上架。")}</SiteEmptyBlock>
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
                      <div className="text-xs text-slate-500">{t("库存")}{" "}{product.stock}</div>
                    </div>
                    <SiteButton
                      disabled={product.stock <= 0}
                      onClick={() => setQty(product.id, Math.min(product.stock, inCart + 1))}
                    >
                      {product.stock <= 0 ? t("缺货") : inCart > 0 ? t("已加 {v0}", undefined, { v0: inCart }) : t("加入购物车")}
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
            <SiteEmptyBlock>{t("购物车是空的，去商品页挑几件吧。")}</SiteEmptyBlock>
          ) : (
            <SitePanel>
              <ul className="space-y-3">
                {cartLines.map(({ product, quantity }) => (
                  <li key={product.id} className="flex flex-col items-stretch gap-3 border-b border-white/20 pb-3 last:border-0 sm:flex-row sm:items-center sm:justify-between">
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
                    <div className="flex shrink-0 items-center justify-end gap-2">
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
              <div className="mt-4 text-right text-lg font-semibold text-violet-700 dark:text-violet-200">{t("合计")}{" "}{formatMallPrice(cartTotal)}
              </div>
            </SitePanel>
          )}

          <SitePanel>
            <SiteSectionTitle
              title={t("收货信息")}
              description={t("姓名、手机、QQ、省市与详细地址必填。可保存常用地址，最多 {v0} 条。", undefined, { v0: MALL_MAX_SAVED_ADDRESSES })}
              action={
                <SiteButton type="button" variant="secondary" onClick={handleSaveAddress}>{t("保存当前地址")}{" "}</SiteButton>
              }
            />

            {savedAddresses.length > 0 ? (
              <div className="mb-4 space-y-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">{t("已保存地址")}{" "}{savedAddresses.length}/{MALL_MAX_SAVED_ADDRESSES}{t("，点击可快速填入")}{" "}</p>
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
                          <SiteButton type="button" variant="secondary" onClick={() => handleDeleteAddress(entry.id)}>{t("删除")}{" "}</SiteButton>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <SiteInput placeholder={t("收件人")} value={name} onChange={(e) => { setName(e.target.value); setSelectedAddressId(""); }} />
              <SiteInput placeholder={t("手机号")} value={phone} onChange={(e) => { setPhone(e.target.value); setSelectedAddressId(""); }} />
              <SiteInput placeholder="QQ" value={qq} onChange={(e) => { setQq(e.target.value); setSelectedAddressId(""); }} />
              <SiteInput placeholder={t("微信（可选）")} value={wechat} onChange={(e) => { setWechat(e.target.value); setSelectedAddressId(""); }} />
              <SiteInput placeholder={t("省")} value={province} onChange={(e) => { setProvince(e.target.value); setSelectedAddressId(""); }} />
              <SiteInput placeholder={t("市")} value={city} onChange={(e) => { setCity(e.target.value); setSelectedAddressId(""); }} />
            </div>
            <div className="mt-3">
              <SiteTextarea placeholder={t("详细地址")} value={address} onChange={(e) => { setAddress(e.target.value); setSelectedAddressId(""); }} rows={3} />
            </div>
            <div className="mt-3">
              <SiteTextarea placeholder={t("备注（可选）")} value={remark} onChange={(e) => setRemark(e.target.value)} rows={2} />
            </div>
            <div className="mt-4 flex justify-end">
              <SiteButton disabled={submitting || cartLines.length === 0 || !paymentCapabilities.enabled} onClick={() => void handleCheckout()}>
                {submitting ? t("创建支付订单…") : t("微信支付")}
              </SiteButton>
            </div>
          </SitePanel>
        </div>
      ) : null}

      {!loading && tab === "orders" ? (
        orders.length === 0 ? (
          <SiteEmptyBlock>{t("暂无订单，下单后会显示在这里。")}</SiteEmptyBlock>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <SitePanel key={order.id}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-800 dark:text-slate-100">{t("订单")}{" "}{order.id}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <MallOrderStatusBadge status={order.status} />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        {order.totalCents === 0 ? t("积分兑换") : formatMallPrice(order.totalCents)}
                      </span>
                    </div>
                  </div>
                  {order.trackingNo ? (
                    <div className="text-sm text-emerald-600 dark:text-emerald-300">{t("快递：")}{order.trackingNo}</div>
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
                        {item.title} × {item.quantity}{item.priceCents > 0 ? `（${formatMallPrice(item.priceCents)}）` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                {(order.province || order.city) && (
                  <p className="mt-2 text-xs text-slate-500">{t("收货地区：")}{order.province} {order.city}
                  </p>
                )}
                {order.status === "pending_pay" && order.paymentMethod === "wechat" ? (
                  <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-white/20 pt-4 dark:border-white/10">
                    <SiteButton
                      variant="secondary"
                      disabled={paymentBusyId === order.id}
                      onClick={() => void handleCancelOrder(order)}
                    >{t("取消订单")}{" "}</SiteButton>
                    <SiteButton
                      disabled={paymentBusyId === order.id || Date.now() >= (order.paymentExpiresAt || 0)}
                      onClick={() => void beginWechatPayment(order)}
                    >
                      {paymentBusyId === order.id ? t("处理中…") : t("继续微信支付")}
                    </SiteButton>
                  </div>
                ) : null}
              </SitePanel>
            ))}
          </div>
        )
      ) : null}

      {activePayment ? (
        <PaymentDialog
          order={activePayment.order}
          payment={activePayment.payment}
          onClose={() => setActivePayment(null)}
          onPaid={handlePaymentConfirmed}
        />
      ) : null}
    </SitePageLayout>
  );
}
