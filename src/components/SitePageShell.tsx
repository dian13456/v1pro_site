import type { ReactNode } from "react";

export const SITE_PAGE_SHELL_CLASS =
  "min-h-screen bg-[radial-gradient(circle_at_8%_14%,rgba(125,211,252,0.22),transparent_42%),radial-gradient(circle_at_90%_10%,rgba(147,197,253,0.2),transparent_38%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] text-slate-900 dark:bg-[radial-gradient(circle_at_8%_14%,rgba(14,116,144,0.25),transparent_42%),radial-gradient(circle_at_90%_10%,rgba(30,64,175,0.24),transparent_38%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] dark:text-slate-100";

export const SITE_PAGE_CONTAINER_CLASS = "mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8";

interface SitePageShellProps {
  children: ReactNode;
  beforeContent?: ReactNode;
}

export function SitePageShell({ children, beforeContent }: SitePageShellProps) {
  return (
    <div className={`${SITE_PAGE_SHELL_CLASS} min-h-screen`}>
      {beforeContent}
      <div className={`${SITE_PAGE_CONTAINER_CLASS} pb-8`}>{children}</div>
    </div>
  );
}
