const SUPPORT_QQ_GROUP = "1029622084";

interface TechnicalSupportGroupProps {
  compact?: boolean;
}

export function TechnicalSupportGroup({ compact = false }: TechnicalSupportGroupProps) {
  return (
    <details className="group relative z-[90] shrink-0">
      <summary
        className={`flex cursor-pointer list-none items-center gap-2 rounded-full border font-semibold transition [&::-webkit-details-marker]:hidden ${
          compact
            ? "border-[#d8e7ff] bg-[#f4f8ff] px-3 py-2 text-[12px] text-[#3974c8] hover:border-[#73a9f2] hover:bg-[#eaf3ff]"
            : "border-cyan-300/50 bg-cyan-50/80 px-4 py-2 text-sm text-cyan-800 shadow-sm hover:border-cyan-400 hover:bg-cyan-100 dark:border-cyan-400/25 dark:bg-cyan-400/10 dark:text-cyan-200 dark:hover:bg-cyan-400/15"
        }`}
        aria-label={`查看技术支持QQ群 ${SUPPORT_QQ_GROUP}`}
      >
        <span aria-hidden="true" className="text-base leading-none">QQ</span>
        <span className="hidden whitespace-nowrap sm:inline">技术支持QQ群</span>
        <span className={`${compact ? "hidden sm:inline" : "whitespace-nowrap"} tabular-nums`}>
          {SUPPORT_QQ_GROUP}
        </span>
        <span aria-hidden="true" className="text-[10px] transition group-open:rotate-180">▼</span>
      </summary>

      <div className="absolute right-0 top-[calc(100%+10px)] z-[70] w-[280px] max-w-[calc(100vw-24px)] rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_22px_60px_-20px_rgba(15,23,42,0.45)] dark:border-white/10 dark:bg-slate-900">
        <div className="mb-2 flex items-start justify-between gap-3 px-1">
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">佳点 V1Pro 售后支持群</p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              群号：<span className="select-all font-semibold tabular-nums">{SUPPORT_QQ_GROUP}</span>
            </p>
          </div>
          <span className="rounded-full bg-cyan-50 px-2 py-1 text-[10px] font-semibold text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-200">
            技术支持
          </span>
        </div>
        <img
          src="/support/qq-group-1029622084.jpg"
          alt={`技术支持QQ群 ${SUPPORT_QQ_GROUP} 二维码`}
          className="aspect-square w-full rounded-xl border border-slate-100 bg-white object-cover object-center"
          loading="lazy"
        />
        <p className="mt-2 text-center text-xs text-slate-500 dark:text-slate-400">
          使用 QQ 扫码加入群聊
        </p>
      </div>
    </details>
  );
}
