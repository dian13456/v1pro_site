import type { ReactNode } from "react";

interface SiteHeaderProps {
  title: string;
  subtitle?: string;
  rightSlot?: ReactNode;
}

export function SiteHeader({ title, subtitle, rightSlot }: SiteHeaderProps) {
  return (
    <header className="site-header-panel mb-8 rounded-3xl border border-white/25 bg-white/70 p-5 dark:border-white/10 dark:bg-slate-900/70">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <p className="site-accent-text text-xs uppercase tracking-[0.24em]">JiaDian HUB Resource Center</p>
          <h1 className="mt-1 text-2xl font-semibold leading-tight text-slate-900 dark:text-slate-50">{title}</h1>
          {subtitle ? (
            <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{subtitle}</p>
          ) : null}
        </div>
        {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
      </div>
    </header>
  );
}
