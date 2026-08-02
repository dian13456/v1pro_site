import type { CreditLedgerEntry } from "../types/credits";

function formatLedgerTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CreditLedgerPanel({
  entries,
  loading = false,
  emptyText = "暂无积分明细，新的积分变动会显示在这里。",
}: {
  entries: CreditLedgerEntry[];
  loading?: boolean;
  emptyText?: string;
}) {
  return (
    <div className="mt-4 border-t border-violet-200/60 pt-4 dark:border-violet-500/20">
      <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">积分明细</div>
      {loading ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">加载中…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">{emptyText}</p>
      ) : (
        <ul className="max-h-56 space-y-2 overflow-y-auto pr-1 text-xs">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-start justify-between gap-3 rounded-xl bg-white/70 px-3 py-2 dark:bg-slate-900/40"
            >
              <div className="min-w-0">
                <div className="font-medium text-slate-700 dark:text-slate-200">{entry.label}</div>
                <div className="mt-0.5 text-slate-500 dark:text-slate-400">{formatLedgerTime(entry.createdAt)}</div>
              </div>
              <span
                className={`shrink-0 font-semibold ${
                  entry.amount > 0
                    ? "text-emerald-600 dark:text-emerald-300"
                    : entry.amount < 0
                      ? "text-rose-600 dark:text-rose-300"
                      : "text-slate-500"
                }`}
              >
                {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
