import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface V1ProTransferOrbProps {
  visible: boolean;
  progress: number | null;
  transferId: number | null;
  message?: string;
}

function clampProgress(value: number | null): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function V1ProTransferOrb({
  visible,
  progress,
  transferId,
  message = "",
}: V1ProTransferOrbProps) {
  const [displayedProgress, setDisplayedProgress] = useState(0);

  useEffect(() => {
    setDisplayedProgress(0);
  }, [transferId]);

  useEffect(() => {
    if (!visible) return;
    const next = clampProgress(progress);
    // 编码和写入可能来自不同阶段；圆球只前进、不回退，避免液面来回跳。
    setDisplayedProgress((current) => Math.max(current, next));
  }, [progress, visible]);

  if (!visible) return null;

  const roundedProgress = Math.round(displayedProgress);

  return createPortal(
    <div
      className="fixed bottom-5 right-4 z-[95] flex max-w-[9rem] flex-col items-center rounded-[22px] border border-emerald-100/90 bg-white/90 px-3 py-3 shadow-[0_14px_38px_rgba(34,132,104,.24)] backdrop-blur-md dark:border-emerald-400/20 dark:bg-slate-900/90 sm:bottom-7 sm:right-7"
      role="status"
      aria-live="polite"
      title={message || `网页直传 ${roundedProgress}%`}
    >
      <div
        className="relative h-[76px] w-[76px] overflow-hidden rounded-full border-[3px] border-white bg-emerald-50 shadow-[inset_0_0_16px_rgba(43,143,115,.16),0_7px_18px_rgba(43,143,115,.2)] ring-2 ring-emerald-200/80 dark:border-slate-800 dark:bg-slate-800 dark:ring-emerald-400/30"
        role="progressbar"
        aria-label="网页直传进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={roundedProgress}
      >
        <div
          className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#20a96d] via-[#32c89a] to-[#61d9c6] transition-[height] duration-500 ease-out"
          style={{ height: `${displayedProgress}%` }}
        >
          <span className="v1pro-transfer-wave v1pro-transfer-wave-front" />
          <span className="v1pro-transfer-wave v1pro-transfer-wave-back" />
        </div>
        <span className="absolute left-[18px] top-[13px] h-3 w-2 rotate-[-28deg] rounded-full bg-white/70 blur-[.3px]" aria-hidden="true" />
        <span className="absolute inset-0 grid place-items-center text-[17px] font-extrabold tabular-nums text-slate-700 drop-shadow-[0_1px_1px_rgba(255,255,255,.9)] dark:text-white">
          {roundedProgress}%
        </span>
      </div>
      <span className="mt-2 text-center text-[11px] font-bold tracking-[.08em] text-emerald-700 dark:text-emerald-300">
        网页直传中
      </span>
    </div>,
    document.body,
  );
}
