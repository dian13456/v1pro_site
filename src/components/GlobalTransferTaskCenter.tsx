import { useSyncExternalStore } from "react";
import {
  dismissTransferTask,
  getTransferTaskSnapshot,
  subscribeTransferTask,
} from "../services/transferTaskStore";

export function GlobalTransferTaskCenter() {
  const task = useSyncExternalStore(subscribeTransferTask, getTransferTaskSnapshot, getTransferTaskSnapshot);
  if (!task) return null;

  const roundedProgress = Math.round(task.progress);
  const active = task.status === "active";
  const success = task.status === "success";

  return (
    <aside className="fixed bottom-24 right-3 z-[96] w-[min(88vw,320px)] overflow-hidden rounded-[22px] border border-black/[.07] bg-white/94 shadow-[0_22px_65px_rgba(15,23,42,.22)] backdrop-blur-2xl md:bottom-6 md:right-6 dark:border-white/10 dark:bg-slate-900/94" role="status" aria-live="polite">
      <div className="flex items-center gap-3 p-3.5">
        <div className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-full border-2 border-white shadow-inner ring-1 ${task.status === "error" ? "bg-rose-50 ring-rose-200" : "bg-sky-50 ring-sky-200"}`}>
          <div
            className={`absolute inset-x-0 bottom-0 transition-[height] duration-500 ease-out ${task.status === "error" ? "bg-gradient-to-t from-rose-500 to-orange-300" : "bg-gradient-to-t from-[#0071e3] via-[#2997ff] to-[#69b8ff]"}`}
            style={{ height: `${success ? 100 : task.progress}%` }}
          >
            {active ? <><span className="v1pro-transfer-wave v1pro-transfer-wave-front" /><span className="v1pro-transfer-wave v1pro-transfer-wave-back" /></> : null}
          </div>
          <span className="absolute inset-0 grid place-items-center text-[11px] font-bold tabular-nums text-slate-700 drop-shadow-[0_1px_white]">{task.status === "error" ? "!" : `${roundedProgress}%`}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{task.label}</p>
            <button type="button" onClick={dismissTransferTask} className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-sm text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white" aria-label="关闭传输任务">×</button>
          </div>
          <p className={`mt-1 line-clamp-2 text-[11px] leading-4 ${task.status === "error" ? "text-rose-500" : success ? "text-emerald-600" : "text-slate-500 dark:text-slate-300"}`}>{task.message}</p>
        </div>
      </div>
      <div className="h-1 bg-slate-100 dark:bg-slate-800">
        <div className={`h-full transition-[width] duration-300 ${task.status === "error" ? "bg-rose-500" : success ? "bg-emerald-500" : "bg-[#0071e3]"}`} style={{ width: `${task.progress}%` }} />
      </div>
    </aside>
  );
}
