interface V1ProTransferNoticeProps {
  message: string;
  onDismiss: () => void;
}

export function V1ProTransferNotice({ message, onDismiss }: V1ProTransferNoticeProps) {
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
    </div>
  );
}
