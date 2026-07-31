import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SitePageLayout } from "../components/SitePageLayout";
import {
  SiteAlert,
  SiteButton,
  SiteInput,
  SiteLoadingBlock,
  SitePanel,
  SiteSectionTitle,
  SiteTextarea,
  SITE_CONTENT_MEDIUM,
} from "../components/SiteUi";
import { useThemeMode } from "../hooks/useThemeMode";
import {
  adminFetchMallOrderContact,
  adminFetchMallOrders,
  adminFetchMallProducts,
  adminSaveMallProduct,
  adminUpdateMallOrderStatus,
} from "../services/mallService";
import type { MallOrder, MallProduct } from "../types/mall";
import { formatMallPrice, MALL_ORDER_STATUS_LABEL } from "../types/mall";

const ADMIN_TOKEN_KEY = "jiadian_activity_admin_token";

export default function MallAdminPage() {
  const { theme, setTheme } = useThemeMode();
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem(ADMIN_TOKEN_KEY) || "");
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<MallProduct[]>([]);
  const [orders, setOrders] = useState<MallOrder[]>([]);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [contactText, setContactText] = useState("");
  const [trackingNo, setTrackingNo] = useState("");

  const [editId, setEditId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editImage, setEditImage] = useState("");
  const [editPriceYuan, setEditPriceYuan] = useState("99");
  const [editStock, setEditStock] = useState("10");
  const [editStatus, setEditStatus] = useState("on_sale");

  const loadAll = async (token: string) => {
    setLoading(true);
    setErrorMessage("");
    try {
      const [productList, orderList] = await Promise.all([
        adminFetchMallProducts(token),
        adminFetchMallOrders(token),
      ]);
      setProducts(productList);
      setOrders(orderList);
      setNotice("数据已刷新");
    } catch (err) {
      setErrorMessage((err as Error)?.message || "加载失败，请检查管理员 Token");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (adminToken) {
      void loadAll(adminToken);
    }
  }, []);

  const handleSaveToken = () => {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, adminToken.trim());
    void loadAll(adminToken.trim());
  };

  const fillProduct = (product: MallProduct) => {
    setEditId(product.id);
    setEditTitle(product.title);
    setEditDesc(product.description);
    setEditImage(product.imageUrl || "");
    setEditPriceYuan((product.priceCents / 100).toFixed(2));
    setEditStock(String(product.stock));
    setEditStatus(product.status || "on_sale");
  };

  const handleSaveProduct = async () => {
    if (!adminToken) return;
    const yuan = Number(editPriceYuan);
    const stock = Number(editStock);
    if (!editTitle.trim() || !Number.isFinite(yuan) || yuan < 0 || !Number.isFinite(stock) || stock < 0) {
      setErrorMessage("请检查商品标题、价格、库存");
      return;
    }
    try {
      await adminSaveMallProduct(adminToken, {
        id: editId || undefined,
        title: editTitle.trim(),
        description: editDesc.trim(),
        imageUrl: editImage.trim(),
        priceCents: Math.round(yuan * 100),
        stock: Math.floor(stock),
        status: editStatus,
      });
      setNotice("商品已保存");
      await loadAll(adminToken);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "保存商品失败");
    }
  };

  const handleViewContact = async (orderId: string) => {
    if (!adminToken) return;
    try {
      const contact = await adminFetchMallOrderContact(adminToken, orderId);
      setContactText(
        [
          `订单：${orderId}`,
          `姓名：${contact.name}`,
          `手机：${contact.phone}`,
          `QQ：${contact.qq}`,
          `微信：${contact.wechat || "-"}`,
          `地址：${contact.province} ${contact.city} ${contact.address}`,
        ].join("\n"),
      );
    } catch (err) {
      setErrorMessage((err as Error)?.message || "读取收货信息失败");
    }
  };

  const handleStatus = async (orderId: string, status: string) => {
    if (!adminToken) return;
    try {
      await adminUpdateMallOrderStatus(adminToken, orderId, status, trackingNo);
      setNotice(`订单 ${orderId} 已更新为 ${MALL_ORDER_STATUS_LABEL[status] || status}`);
      await loadAll(adminToken);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "更新订单失败");
    }
  };

  return (
    <SitePageLayout
      subtitle="实物商城管理 · 商品上下架 · 确认收款 / 发货"
      theme={theme}
      onSetTheme={setTheme}
      contentClassName={SITE_CONTENT_MEDIUM}
    >
      <SitePanel>
        <SiteSectionTitle
          title="管理员登录"
          description="使用与活动后台相同的 REVIEW_ADMIN_TOKEN。"
          action={
            <Link to="/mall" className="text-sm text-violet-600 underline dark:text-violet-300">
              返回商城
            </Link>
          }
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <SiteInput
            className="min-w-[240px] flex-1"
            type="password"
            placeholder="管理员 Token"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
          />
          <SiteButton type="button" onClick={handleSaveToken}>
            保存并刷新
          </SiteButton>
        </div>
      </SitePanel>

      {notice ? <SiteAlert variant="success">{notice}</SiteAlert> : null}
      {errorMessage ? <SiteAlert variant="error">{errorMessage}</SiteAlert> : null}
      {loading ? <SiteLoadingBlock>加载中…</SiteLoadingBlock> : null}

      <SitePanel>
        <SiteSectionTitle title="编辑商品" description="价格单位为元；保存后立即对用户可见（上架状态）。" />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <SiteInput placeholder="商品 ID（新建可留空）" value={editId} onChange={(e) => setEditId(e.target.value)} />
          <SiteInput placeholder="标题" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          <SiteInput placeholder="价格（元）" value={editPriceYuan} onChange={(e) => setEditPriceYuan(e.target.value)} />
          <SiteInput placeholder="库存" value={editStock} onChange={(e) => setEditStock(e.target.value)} />
          <SiteInput placeholder="图片 URL" value={editImage} onChange={(e) => setEditImage(e.target.value)} />
          <select
            className="rounded-xl border border-white/30 bg-white/70 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950/50"
            value={editStatus}
            onChange={(e) => setEditStatus(e.target.value)}
          >
            <option value="on_sale">上架</option>
            <option value="off_sale">下架</option>
          </select>
        </div>
        <div className="mt-3">
          <SiteTextarea placeholder="商品说明" rows={3} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
        </div>
        <div className="mt-3">
          <SiteButton type="button" onClick={() => void handleSaveProduct()}>
            保存商品
          </SiteButton>
        </div>
        <ul className="mt-4 space-y-2 text-sm">
          {products.map((product) => (
            <li key={product.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {product.title} · {formatMallPrice(product.priceCents)} · 库存 {product.stock} · {product.status}
              </span>
              <SiteButton type="button" variant="secondary" onClick={() => fillProduct(product)}>
                编辑
              </SiteButton>
            </li>
          ))}
        </ul>
      </SitePanel>

      <SitePanel>
        <SiteSectionTitle title="订单管理" description="流程：待确认收款 → 确认收款 → 填写单号发货。" />
        <div className="mt-3">
          <SiteInput
            placeholder="发货快递单号（标记发货时使用）"
            value={trackingNo}
            onChange={(e) => setTrackingNo(e.target.value)}
          />
        </div>
        {contactText ? (
          <SiteAlert variant="success">
            <pre className="whitespace-pre-wrap font-sans">{contactText}</pre>
          </SiteAlert>
        ) : null}
        <div className="mt-4 space-y-3">
          {orders.map((order) => (
            <div key={order.id} className="rounded-2xl border border-white/20 p-3 dark:border-white/10">
              <div className="font-medium">
                {order.id} · {MALL_ORDER_STATUS_LABEL[order.status] || order.status} ·{" "}
                {formatMallPrice(order.totalCents)}
              </div>
              <div className="text-xs text-slate-500">
                用户 SN：{order.userSerial || "-"} · {order.province} {order.city}
              </div>
              <ul className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {(order.items || []).map((item) => (
                  <li key={`${order.id}-${item.productId}`}>
                    {item.title} × {item.quantity}
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                <SiteButton type="button" variant="secondary" onClick={() => void handleViewContact(order.id)}>
                  查看地址
                </SiteButton>
                <SiteButton type="button" variant="success" onClick={() => void handleStatus(order.id, "paid")}>
                  确认收款
                </SiteButton>
                <SiteButton type="button" onClick={() => void handleStatus(order.id, "shipped")}>
                  标记发货
                </SiteButton>
                <SiteButton type="button" variant="secondary" onClick={() => void handleStatus(order.id, "cancelled")}>
                  取消订单
                </SiteButton>
              </div>
            </div>
          ))}
        </div>
      </SitePanel>
    </SitePageLayout>
  );
}
