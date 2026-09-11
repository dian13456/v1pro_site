import { translate as t, useI18n } from "../i18n";
import { getMallOrderStatusTone, MALL_ORDER_STATUS_LABEL } from "../types/mall";

export function MallOrderStatusBadge({ status }: { status: string }) {
  useI18n();
  const label = MALL_ORDER_STATUS_LABEL[status] || status;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${getMallOrderStatusTone(status)}`}
    >
      {t(label)}
    </span>
  );
}
