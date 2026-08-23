import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface DeviceAuthenticationDialogProps {
  message: string;
  onClose: () => void;
  onReauthenticate: () => void;
}

export function DeviceAuthenticationDialog({
  message,
  onClose,
  onReauthenticate,
}: DeviceAuthenticationDialogProps) {
  const reauthenticateButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    reauthenticateButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-[rgba(30,35,55,.55)] p-4 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="device-auth-error-title"
        aria-describedby="device-auth-error-message"
        className="w-full max-w-md rounded-[20px] border border-rose-100 bg-white p-6 shadow-[0_28px_80px_rgba(30,35,55,.32)] dark:border-rose-400/20 dark:bg-slate-900"
      >
        <div className="flex items-start gap-4">
          <div
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-rose-50 text-xl text-rose-500 dark:bg-rose-500/10"
            aria-hidden="true"
          >
            !
          </div>
          <div className="min-w-0">
            <h2 id="device-auth-error-title" className="text-lg font-bold text-slate-900 dark:text-white">
              设备认证失效
            </h2>
            <p
              id="device-auth-error-message"
              className="mt-2 break-words text-sm leading-6 text-slate-600 dark:text-slate-300"
            >
              {message}
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            知道了
          </button>
          <button
            ref={reauthenticateButtonRef}
            type="button"
            onClick={onReauthenticate}
            className="rounded-full bg-rose-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-400"
          >
            重新认证
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
