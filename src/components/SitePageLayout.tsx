import type { ReactNode } from "react";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { SitePageShell } from "./SitePageShell";
import { SitePageToolbar } from "./SitePageToolbar";
import { SITE_CONTENT_DEFAULT } from "./SiteUi";
import type { ThemeMode } from "../types/theme";

interface SitePageLayoutProps {
  subtitle?: string;
  theme: ThemeMode;
  onSetTheme: (theme: ThemeMode) => void;
  beforeContent?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  showFooter?: boolean;
  toolbarMode?: "app" | "theme-only";
}

export function SitePageLayout({
  subtitle,
  theme,
  onSetTheme,
  beforeContent,
  children,
  contentClassName = SITE_CONTENT_DEFAULT,
  showFooter = true,
  toolbarMode = "app",
}: SitePageLayoutProps) {
  return (
    <SitePageShell beforeContent={beforeContent}>
      <SiteHeader
        title="佳点电子资源中心"
        subtitle={subtitle}
        rightSlot={
          <SitePageToolbar theme={theme} onSetTheme={onSetTheme} mode={toolbarMode} />
        }
      />
      <div className={contentClassName}>{children}</div>
      {showFooter ? <SiteFooter /> : null}
    </SitePageShell>
  );
}
