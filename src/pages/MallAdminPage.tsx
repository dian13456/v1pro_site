import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AdminLoginPanel } from "../components/AdminLoginPanel";
import { MallProductGallery } from "../components/MallProductGallery";
import { MallProductImage } from "../components/MallProductImage";
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
import { useAdminSession } from "../hooks/useAdminSession";
import { useThemeMode } from "../hooks/useThemeMode";
import { getAdminToken } from "../services/adminAuthService";
import {
  adminDeleteMallProduct,
  adminFetchMallOrderContact,
  adminFetchMallOrders,
  adminFetchMallProducts,
  adminSaveMallProduct,
  adminUpdateMallOrderStatus,
  adminUploadMallImage,
} from "../services/mallService";
import type { MallOrder, MallProduct } from "../types/mall";
import { formatMallPrice, getProductImages, MALL_ORDER_STATUS_LABEL } from "../types/mall";

type AdminTabKey = "products" | "orders";

export default function MallAdminPage() {
  const { theme, setTheme } = useThemeMode();
  const { adminToken, authenticated, refreshSession, logout, handleUnauthorized } = useAdminSession();
  const [tab, setTab] = useState<AdminTabKey>("products");
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
  const [editImages, setEditImages] = useState<string[]>([]);
  const [manualImageUrl, setManualImageUrl] = useState("");
  const [editPriceYuan, setEditPriceYuan] = useState("99");
  const [editStock, setEditStock] = useState("10");
  const [editStatus, setEditStatus] = useState("on_sale");
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const message = (err as Error)?.message || "加载失败，请重新登录";
      if (message.includes("token") || message.includes("无效") || message.includes("未授权")) {
        handleUnauthorized();
      }
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authenticated && adminToken) {
      void loadAll(adminToken);
    }
  }, []);

  const handleLoggedIn = () => {
    refreshSession();
    void loadAll(getAdminToken());
  };

  const fillProduct = (product: MallProduct) => {
    setEditId(product.id);
    setEditTitle(product.title);
    setEditDesc(product.description);
    setEditImages(getProductImages(product));
    setManualImageUrl("");
    setEditPriceYuan((product.priceCents / 100).toFixed(2));
    setEditStock(String(product.stock));
    setEditStatus(product.status || "on_sale");
  };

  const resetProductForm = () => {
    setEditId("");
    setEditTitle("");
    setEditDesc("");
    setEditImages([]);
    setManualImageUrl("");
    setEditPriceYuan("99");
    setEditStock("10");
    setEditStatus("on_sale");
  };

  const handleDeleteProduct = async (product: MallProduct) => {
    if (!adminToken) return;
    const confirmed = window.confirm(`确定删除商品「${product.title}」吗？\n已有订单记录不会受影响，但待确认收款的订单会阻止删除。`);
    if (!confirmed) return;
    try {
      await adminDeleteMallProduct(adminToken, product.id);
      if (editId === product.id) {
        resetProductForm();
      }
      setNotice(`商品「${product.title}」已删除`);
      await loadAll(adminToken);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "删除商品失败");
    }
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
        imageUrls: editImages,
        imageUrl: editImages[0] || "",
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

  const handleImageUpload = async (file: File | null) => {
    if (!file || !adminToken) return;
    setUploadingImage(true);
    setErrorMessage("");
    try {
      const imageUrl = await adminUploadMallImage(adminToken, file);
      setEditImages((prev) => [...prev, imageUrl]);
      setNotice("图片已上传，可继续添加更多图片");
    } catch (err) {
      setErrorMessage((err as Error)?.message || "上传图片失败");
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
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
      {!authenticated ? (
        <AdminLoginPanel
          description="输入后台密码后可管理商品、订单与发货。"
          onLoggedIn={handleLoggedIn}
        />
      ) : (
        <SitePanel>
          <SiteSectionTitle
            title="已登录管理后台"
            description="当前会话有效，可进行操作。"
            action={
              <div className="flex flex-wrap items-center gap-3">
                <Link to="/mall" className="text-sm text-violet-600 underline dark:text-violet-300">
                  返回商城
                </Link>
                <SiteButton type="button" variant="secondary" onClick={logout}>
                  退出登录
                </SiteButton>
              </div>
            }
          />
        </SitePanel>
      )}

      {notice ? <SiteAlert variant="success">{notice}</SiteAlert> : null}
      {errorMessage ? <SiteAlert variant="error">{errorMessage}</SiteAlert> : null}
      {loading ? <SiteLoadingBlock>加载中…</SiteLoadingBlock> : null}

      {authenticated && adminToken ? (
        <>
      <SitePanel>
        <SiteSectionTitle
          title="商城后台"
          description="商品上下架、订单收款确认与发货。"
          action={
            <div className="flex flex-wrap gap-2">
              <SiteButton
                type="button"
                variant={tab === "products" ? "primary" : "secondary"}
                onClick={() => setTab("products")}
              >
                商品管理
              </SiteButton>
              <SiteButton
                type="button"
                variant={tab === "orders" ? "primary" : "secondary"}
                onClick={() => setTab("orders")}
              >
                订单管理{orders.length > 0 ? ` (${orders.length})` : ""}
              </SiteButton>
              <SiteButton type="button" variant="secondary" onClick={() => void loadAll(adminToken)}>
                刷新数据
              </SiteButton>
            </div>
          }
        />
      </SitePanel>

      {tab === "products" ? (
      <SitePanel>
        <SiteSectionTitle title="商品管理" description="可上传多张图片或粘贴 URL；用户端可点击放大浏览。" />
        <div className="mt-3 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div>
            <MallProductGallery
              imageUrls={editImages}
              title={editTitle || "商品预览"}
              className="h-44 w-full"
              adminToken={adminToken}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => void handleImageUpload(e.target.files?.[0] || null)}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <SiteButton
                type="button"
                variant="secondary"
                disabled={uploadingImage || !adminToken}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadingImage ? "上传中…" : "上传图片"}
              </SiteButton>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SiteInput placeholder="商品 ID（新建可留空）" value={editId} onChange={(e) => setEditId(e.target.value)} />
            <SiteInput placeholder="标题" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            <SiteInput placeholder="价格（元）" value={editPriceYuan} onChange={(e) => setEditPriceYuan(e.target.value)} />
            <SiteInput placeholder="库存" value={editStock} onChange={(e) => setEditStock(e.target.value)} />
            <div className="flex gap-2 sm:col-span-2">
              <SiteInput
                className="flex-1"
                placeholder="粘贴图片 URL 后点添加"
                value={manualImageUrl}
                onChange={(e) => setManualImageUrl(e.target.value)}
              />
              <SiteButton
                type="button"
                variant="secondary"
                onClick={() => {
                  const url = manualImageUrl.trim();
                  if (!url) return;
                  setEditImages((prev) => [...prev, url]);
                  setManualImageUrl("");
                }}
              >
                添加
              </SiteButton>
            </div>
            <select
              className="rounded-xl border border-white/30 bg-white/70 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950/50"
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value)}
            >
              <option value="on_sale">上架</option>
              <option value="off_sale">下架</option>
            </select>
          </div>
        </div>
        {editImages.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-3">
            {editImages.map((url, index) => (
              <div key={`${url}-${index}`} className="relative">
                <MallProductImage imageUrl={url} title={`图片 ${index + 1}`} className="h-20 w-20" adminToken={adminToken} />
                <button
                  type="button"
                  className="absolute -right-2 -top-2 rounded-full bg-rose-500 px-2 py-0.5 text-xs text-white"
                  onClick={() => setEditImages((prev) => prev.filter((_, i) => i !== index))}
                >
                  删
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="mt-3">
          <SiteTextarea placeholder="商品说明" rows={3} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <SiteButton type="button" onClick={() => void handleSaveProduct()}>
            保存商品
          </SiteButton>
          <SiteButton type="button" variant="secondary" onClick={resetProductForm}>
            新建商品
          </SiteButton>
        </div>
        <ul className="mt-4 space-y-3 text-sm">
          {products.map((product) => (
            <li key={product.id} className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <MallProductImage imageUrl={getProductImages(product)[0]} title={product.title} className="h-14 w-14 shrink-0" adminToken={adminToken} />
                <span>
                  {product.title} · {formatMallPrice(product.priceCents)} · 图 {getProductImages(product).length} · 库存{" "}
                  {product.stock} · {product.status}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <SiteButton type="button" variant="secondary" onClick={() => fillProduct(product)}>
                  编辑
                </SiteButton>
                <SiteButton type="button" variant="secondary" onClick={() => void handleDeleteProduct(product)}>
                  删除
                </SiteButton>
              </div>
            </li>
          ))}
        </ul>
      </SitePanel>
      ) : null}

      {tab === "orders" ? (
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
          {orders.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">暂无订单。</p>
          ) : (
          orders.map((order) => (
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
          ))
          )}
        </div>
      </SitePanel>
      ) : null}
        </>
      ) : null}
    </SitePageLayout>
  );
}
