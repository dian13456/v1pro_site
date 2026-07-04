import type { ReactNode } from "react";

interface SitePageTransitionProps {
  routeKey: string;
  children: ReactNode;
}

export function SitePageTransition({ routeKey, children }: SitePageTransitionProps) {
  return (
    <div key={routeKey} className="site-page-enter">
      {children}
    </div>
  );
}
