import type { MallOrder, MallProduct, MallShippingInput } from "../types/mall";
import { getAuthState, hasValidLocalAuth } from "./authService";
import { API_BASE, apiFetch, formatClientError } from "./httpClient";
import { isStaticMode } from "./runtimeMode";

const CART_KEY = "jiadian_mall_cart_v1";

function authHeaders(): Record<string, string> {
  const auth = getAuthState();
  if (!auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  return { Authorization: `Bearer ${auth.token}` };
}

function adminHeaders(adminToken: string): Record<string, string> {
  return { "X-Review-Admin-Token": adminToken };
}

export function loadMallCart(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw) as Record<string, number>;
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

export function saveMallCart(cart: Record<string, number>): void {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

export function clearMallCart(): void {
  localStorage.removeItem(CART_KEY);
}

export async function fetchMallProducts(): Promise<MallProduct[]> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  if (isStaticMode()) {
    return [
      {
        id: "mall-shell-sample",
        title: "V1PRO 实体周边（示例）",
        description: "静态模式示例商品。",
        priceCents: 9900,
        stock: 20,
        status: "on_sale",
      },
    ];
  }
  const payload = await apiFetch<{ success: boolean; products: MallProduct[]; message?: string }>(
    "/api/mall/products",
    { method: "GET", headers: authHeaders() },
  );
  if (!payload.success) {
    throw new Error(payload.message || "加载商品失败");
  }
  return payload.products || [];
}

export async function createMallOrder(
  items: Array<{ productId: string; quantity: number }>,
  shipping: MallShippingInput,
): Promise<{ order: MallOrder; message: string }> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  if (isStaticMode()) {
    throw new Error("静态模式下无法下单");
  }
  const payload = await apiFetch<{ success: boolean; order: MallOrder; message?: string }>("/api/mall/orders", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ items, ...shipping }),
  });
  if (!payload.success || !payload.order) {
    throw new Error(payload.message || "下单失败");
  }
  return { order: payload.order, message: payload.message || "下单成功" };
}

export async function fetchMyMallOrders(): Promise<MallOrder[]> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  if (isStaticMode()) {
    return [];
  }
  const payload = await apiFetch<{ success: boolean; orders: MallOrder[]; message?: string }>("/api/mall/orders", {
    method: "GET",
    headers: authHeaders(),
  });
  if (!payload.success) {
    throw new Error(payload.message || "加载订单失败");
  }
  return payload.orders || [];
}

export async function adminFetchMallProducts(adminToken: string): Promise<MallProduct[]> {
  const payload = await apiFetch<{ success: boolean; products: MallProduct[] }>("/api/admin/mall/products", {
    method: "GET",
    headers: adminHeaders(adminToken),
  });
  return payload.products || [];
}

export async function adminSaveMallProduct(adminToken: string, product: Partial<MallProduct>): Promise<MallProduct> {
  const payload = await apiFetch<{ success: boolean; product: MallProduct; message?: string }>(
    "/api/admin/mall/products",
    {
      method: "POST",
      headers: { ...adminHeaders(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify(product),
    },
  );
  if (!payload.product) {
    throw new Error(payload.message || "保存商品失败");
  }
  return payload.product;
}

export async function adminDeleteMallProduct(adminToken: string, productId: string): Promise<void> {
  const payload = await apiFetch<{ success: boolean; message?: string }>(
    `/api/admin/mall/products/${encodeURIComponent(productId)}`,
    {
      method: "DELETE",
      headers: adminHeaders(adminToken),
    },
  );
  if (!payload.success) {
    throw new Error(payload.message || "删除商品失败");
  }
}

export async function adminUploadMallImage(adminToken: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/admin/mall/upload-image`, {
      method: "POST",
      headers: adminHeaders(adminToken),
      body: form,
    });
  } catch (err) {
    throw new Error(formatClientError(err, "上传图片失败"));
  }
  const payload = (await response.json()) as {
    success?: boolean;
    imageUrl?: string;
    displayUrl?: string;
    message?: string;
  };
  if (!response.ok || !payload.success || !payload.imageUrl) {
    throw new Error(payload.message || `上传失败（HTTP ${response.status})`);
  }
  return payload.imageUrl;
}

export async function resolveMallImageUrl(imageUrl: string, adminToken?: string): Promise<string> {
  const raw = imageUrl.trim();
  if (!raw || isStaticMode()) {
    return raw;
  }

  const headers: Record<string, string> = {};
  if (adminToken) {
    headers["X-Review-Admin-Token"] = adminToken;
  } else if (hasValidLocalAuth()) {
    Object.assign(headers, authHeaders());
  } else {
    return raw;
  }

  try {
    const payload = await apiFetch<{ success: boolean; url?: string }>(
      `/api/mall/image?url=${encodeURIComponent(raw)}`,
      { method: "GET", headers },
    );
    return payload.url?.trim() || raw;
  } catch {
    return raw;
  }
}

export async function adminFetchMallOrders(adminToken: string): Promise<MallOrder[]> {
  const payload = await apiFetch<{ success: boolean; orders: MallOrder[] }>("/api/admin/mall/orders", {
    method: "GET",
    headers: adminHeaders(adminToken),
  });
  return payload.orders || [];
}

export async function adminFetchMallOrderContact(
  adminToken: string,
  orderId: string,
): Promise<{
  name: string;
  phone: string;
  wechat: string;
  qq: string;
  province: string;
  city: string;
  address: string;
}> {
  const payload = await apiFetch<{
    success: boolean;
    contact: {
      name: string;
      phone: string;
      wechat: string;
      qq: string;
      province: string;
      city: string;
      address: string;
    };
  }>(`/api/admin/mall/orders/${encodeURIComponent(orderId)}/contact`, {
    method: "GET",
    headers: adminHeaders(adminToken),
  });
  return payload.contact;
}

export async function adminUpdateMallOrderStatus(
  adminToken: string,
  orderId: string,
  status: string,
  trackingNo = "",
): Promise<MallOrder> {
  const payload = await apiFetch<{ success: boolean; order: MallOrder; message?: string }>(
    `/api/admin/mall/orders/${encodeURIComponent(orderId)}/status`,
    {
      method: "POST",
      headers: { ...adminHeaders(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ status, trackingNo }),
    },
  );
  if (!payload.order) {
    throw new Error(payload.message || "更新订单失败");
  }
  return payload.order;
}
