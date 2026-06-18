import type { ReactNode } from "react";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";
import { SitePageShell } from "./SitePageShell";
import { SitePageToolbar } from "./SitePageToolbar";

interface SitePageLayoutProps {
  subtitle?: string;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  beforeContent?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  showFooter?: boolean;
}

export function SitePageLayout({
  subtitle,
  theme,
  onToggleTheme,
  beforeContent,
  children,
  contentClassName,
  showFooter = true,
}: SitePageLayoutProps) {
  return (
    <SitePageShell beforeContent={beforeContent}>
      <SiteHeader
        title="佳点电子资源中心"
        subtitle={subtitle}
        rightSlot={<SitePageToolbar theme={theme} onToggleTheme={onToggleTheme} />}
      />
      <div className={contentClassName}>{children}</div>
      {showFooter ? <SiteFooter /> : null}
    </SitePageShell>
  );
}
