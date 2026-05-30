import type { ReactNode } from "react";

interface SiteHeaderProps {
  title: string;
  subtitle: string;
  rightSlot?: ReactNode;
}

export function SiteHeader({ title, subtitle, rightSlot }: SiteHeaderProps) {
  return (
    <header className="sticky top-4 z-20 mb-8 rounded-3xl border border-white/25 bg-white/50 p-5 shadow-[0_24px_45px_-20px_rgba(0,0,0,0.35)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/55">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-500">JiaDian HUB Resource Center</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">{title}</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{subtitle}</p>
        </div>
        {rightSlot}
      </div>
    </header>
  );
}
