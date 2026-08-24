import type { ReactNode } from "react";

interface SiteHeaderProps {
  title: string;
  subtitle?: string;
  rightSlot?: ReactNode;
}

export function SiteHeader({ title, subtitle, rightSlot }: SiteHeaderProps) {
  return (
    <header className="site-header-panel relative z-[80] mb-8 rounded-[28px] border border-white/25 bg-white/70 p-5 dark:border-white/10 dark:bg-slate-900/70 sm:p-6">
      <div className="min-w-0">
        <p className="site-accent-text text-xs uppercase tracking-[0.24em]">JiaDian HUB Resource Center</p>
        <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-[-0.025em] text-slate-950 dark:text-slate-50 sm:text-[28px]">{title}</h1>
        {subtitle ? (
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">{subtitle}</p>
        ) : null}
      </div>
      {rightSlot ? (
        <div className="mt-4 border-t border-white/20 pt-4 dark:border-white/10">{rightSlot}</div>
      ) : null}
    </header>
  );
}
