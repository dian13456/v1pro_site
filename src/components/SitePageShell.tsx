import type { ReactNode } from "react";
import type { ThemeMode } from "../types/theme";

export const SITE_PAGE_CONTAINER_CLASS = "mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8";

interface SitePageShellProps {
  children: ReactNode;
  beforeContent?: ReactNode;
}

export function SitePageShell({ children, beforeContent }: SitePageShellProps) {
  return (
    <div className="site-page-shell min-h-screen text-slate-900 dark:text-slate-100">
      {beforeContent}
      <div className={`${SITE_PAGE_CONTAINER_CLASS} pb-8`}>{children}</div>
    </div>
  );
}
