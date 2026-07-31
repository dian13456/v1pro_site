export type MallProductStatus = "on_sale" | "off_sale";

export type MallOrderStatus = "pending_pay" | "paid" | "shipped" | "cancelled";

export interface MallProduct {
  id: string;
  title: string;
  description: string;
  imageUrl?: string;
  priceCents: number;
  stock: number;
  status: MallProductStatus | string;
  sortOrder?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface MallOrderItem {
  productId: string;
  title: string;
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

export interface MallCartLine {
  productId: string;
  title: string;
  priceCents: number;
  quantity: number;
  stock: number;
  imageUrl?: string;
}

export const MALL_ORDER_STATUS_LABEL: Record<string, string> = {
  pending_pay: "待确认收款",
  paid: "已收款待发货",
  shipped: "已发货",
  cancelled: "已取消",
};

export function formatMallPrice(cents: number): string {
  return `¥${(Math.max(0, cents) / 100).toFixed(2)}`;
}
