export type MallProductStatus = "on_sale" | "off_sale";

export type MallOrderStatus = "pending_pay" | "paid" | "shipped" | "cancelled";

export interface MallProduct {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  imageUrls?: string[];
  priceCents: number;
  stock: number;
  status: MallProductStatus | string;
  sortOrder?: number;
  createdAt?: number;
  updatedAt?: number;
}

export function getProductImages(product: { imageUrl?: string; imageUrls?: string[] }): string[] {
  const urls = (product.imageUrls || []).map((item) => item.trim()).filter(Boolean);
  if (urls.length > 0) {
    return urls;
  }
  const single = (product.imageUrl || "").trim();
  return single ? [single] : [];
}

export interface MallOrderItem {
  productId: string;
  title: string;
  imageUrl?: string;
  priceCents: number;
  quantity: number;
}

export interface MallOrder {
  id: string;
  userSerial?: string;
  status: MallOrderStatus | string;
  items: MallOrderItem[];
  totalCents: number;
  province?: string;
  city?: string;
  trackingNo?: string;
  remark?: string;
  createdAt: number;
  updatedAt: number;
  paidAt?: number;
  shippedAt?: number;
  hasAddress?: boolean;
}

export interface MallShippingInput {
  name: string;
  phone: string;
  wechat?: string;
  qq: string;
  province: string;
  city: string;
  address: string;
  remark?: string;
}

export interface MallSavedAddress extends MallShippingInput {
  id: string;
  updatedAt: number;
}

export const MALL_MAX_SAVED_ADDRESSES = 5;

export interface MallCartLine {
  productId: string;
  title: string;
  priceCents: number;
  quantity: number;
  stock: number;
  imageUrl?: string;
}

export const MALL_ORDER_STATUS_LABEL: Record<string, string> = {
  pending_pay: "已下单",
  paid: "已确认付款待发货",
  shipped: "已发货",
  cancelled: "已取消",
};

export function getMallOrderStatusTone(status: string): string {
  switch (status) {
    case "pending_pay":
      return "bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:ring-amber-800/80";
    case "paid":
      return "bg-sky-100 text-sky-900 ring-1 ring-inset ring-sky-200 dark:bg-sky-950/50 dark:text-sky-200 dark:ring-sky-800/80";
    case "shipped":
      return "bg-emerald-100 text-emerald-900 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:ring-emerald-800/80";
    case "cancelled":
      return "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-slate-800/80 dark:text-slate-400 dark:ring-slate-700";
    default:
      return "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-slate-800/80 dark:text-slate-400 dark:ring-slate-700";
  }
}

export function formatMallPrice(cents: number): string {
  return `¥${(Math.max(0, cents) / 100).toFixed(2)}`;
}
