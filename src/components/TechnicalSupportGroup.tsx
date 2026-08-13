import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const SUPPORT_QQ_GROUP = "1029622084";
const POPUP_WIDTH = 280;
const POPUP_ESTIMATED_HEIGHT = 360;
const VIEWPORT_GAP = 12;

interface TechnicalSupportGroupProps {
  compact?: boolean;
}

interface PopupPosition {
  top: number;
  right: number;
}

export function TechnicalSupportGroup({ compact = false }: TechnicalSupportGroupProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const popupId = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopupPosition | null>(null);

  const updatePosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const popupWidth = Math.min(POPUP_WIDTH, window.innerWidth - VIEWPORT_GAP * 2);
    const popupHeight = Math.min(POPUP_ESTIMATED_HEIGHT, window.innerHeight - VIEWPORT_GAP * 2);
    const roomBelow = window.innerHeight - rect.bottom - VIEWPORT_GAP;
    const top = roomBelow >= popupHeight
      ? rect.bottom + 10
      : Math.max(VIEWPORT_GAP, rect.top - popupHeight - 10);
    const right = Math.min(
      window.innerWidth - popupWidth - VIEWPORT_GAP,
      Math.max(VIEWPORT_GAP, window.innerWidth - rect.right)
    );

    setPosition({ top, right });
  }, []);

  const togglePopup = () => {
    if (open) {
      setOpen(false);
      return;
    }
    updatePosition();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !popupRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, updatePosition]);

  const popup = open && position
    ? createPortal(
        <div
          ref={popupRef}
          id={popupId}
          role="dialog"
          aria-label="技术支持QQ群二维码"
          className="fixed z-[2147483000] w-[280px] max-w-[calc(100vw-24px)] rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_22px_60px_-20px_rgba(15,23,42,0.45)] dark:border-white/10 dark:bg-slate-900"
          style={{ top: position.top, right: position.right }}
        >
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
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={togglePopup}
        className={`flex shrink-0 cursor-pointer items-center gap-2 rounded-full border font-semibold transition ${
          compact
            ? "border-[#d8e7ff] bg-[#f4f8ff] px-3 py-2 text-[12px] text-[#3974c8] hover:border-[#73a9f2] hover:bg-[#eaf3ff]"
            : "border-cyan-300/50 bg-cyan-50/80 px-4 py-2 text-sm text-cyan-800 shadow-sm hover:border-cyan-400 hover:bg-cyan-100 dark:border-cyan-400/25 dark:bg-cyan-400/10 dark:text-cyan-200 dark:hover:bg-cyan-400/15"
        }`}
        aria-label={`查看技术支持QQ群 ${SUPPORT_QQ_GROUP}`}
        aria-expanded={open}
        aria-controls={popupId}
      >
        <span aria-hidden="true" className="text-base leading-none">QQ</span>
        <span className="hidden whitespace-nowrap sm:inline">技术支持QQ群</span>
        <span className={`${compact ? "hidden sm:inline" : "whitespace-nowrap"} tabular-nums`}>
          {SUPPORT_QQ_GROUP}
        </span>
        <span aria-hidden="true" className={`text-[10px] transition ${open ? "rotate-180" : ""}`}>▼</span>
      </button>
      {popup}
    </>
  );
}
