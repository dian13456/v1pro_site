interface V1ProTransferNoticeProps {
  message: string;
  onDismiss: () => void;
  progress?: number | null;
}

export function V1ProTransferNotice({ message, onDismiss, progress = null }: V1ProTransferNoticeProps) {
  if (!message) {
    return null;
  }

  return (
    <div className="fixed bottom-6 left-1/2 z-[90] w-[min(92vw,28rem)] -translate-x-1/2 rounded-2xl border border-cyan-200/70 bg-white/95 px-4 py-3 shadow-xl backdrop-blur dark:border-cyan-500/30 dark:bg-slate-900/95">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">{message}</p>
        <button
          type="button"
          aria-label="关闭提示"
          onClick={onDismiss}
          className="shrink-0 text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
        >
          ×
        </button>
      </div>
      {progress != null ? (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            <span>{progress >= 100 ? "传输完成" : "网页直传进度"}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#32b879] via-[#32c89a] to-[#5a9cff] transition-[width] duration-200 ease-out"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
