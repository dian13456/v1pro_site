import type { ReactNode } from "react";

interface DevicePreviewFrameProps {
  children: ReactNode;
  className?: string;
  hoverGlow?: boolean;
}

/** 1.9 寸横屏预览框（320×170，与 ResourceCard 一致） */
export function DevicePreviewFrame({
  children,
  className = "",
  hoverGlow = false,
}: DevicePreviewFrameProps) {
  return (
    <div
      className={`rounded-[1.4rem] bg-black p-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] ${
        hoverGlow
          ? "transition duration-300 group-hover:shadow-[inset_0_0_0_1px_rgba(56,189,248,0.45),0_0_26px_-10px_rgba(56,189,248,0.8)]"
          : ""
      } ${className}`}
    >
      <div className="overflow-hidden rounded-[1rem] bg-slate-900" style={{ aspectRatio: "320 / 170" }}>
        {children}
      </div>
    </div>
  );
}
