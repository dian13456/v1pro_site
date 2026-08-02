import { getMallOrderStatusTone, MALL_ORDER_STATUS_LABEL } from "../types/mall";

export function MallOrderStatusBadge({ status }: { status: string }) {
  const label = MALL_ORDER_STATUS_LABEL[status] || status;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${getMallOrderStatusTone(status)}`}
    >
      {label}
    </span>
  );
}
