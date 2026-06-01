import type { ReactNode } from "react";

interface SiteHeaderProps {
  title: string;
  subtitle?: string;
  rightSlot?: ReactNode;
}

export function SiteHeader({ title, subtitle, rightSlot }: SiteHeaderProps) {
  return (
    <header className="mb-8 rounded-3xl border border-white/25 bg-white/70 p-5 dark:border-white/10 dark:bg-slate-900/70">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-500">JiaDian HUB Resource Center</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-50">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{subtitle}</p> : null}
        </div>
        {rightSlot}
      </div>
    </header>
  );
}
