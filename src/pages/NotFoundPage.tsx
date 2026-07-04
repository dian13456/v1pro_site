import { Link } from "react-router-dom";
import { SitePageLayout } from "../components/SitePageLayout";
import { SiteButton, SitePanel } from "../components/SiteUi";
import { useThemeMode } from "../hooks/useThemeMode";

export default function NotFoundPage() {
  const { theme, setTheme } = useThemeMode();

  return (
    <SitePageLayout
      subtitle="页面不存在"
      theme={theme}
      onSetTheme={setTheme}
      toolbarMode="theme-only"
      contentClassName="flex min-h-[60vh] items-center justify-center"
    >
      <SitePanel className="max-w-md text-center">
        <p className="text-xs uppercase tracking-[0.24em] text-cyan-500">404</p>
        <h1 className="mt-2 text-4xl font-semibold text-slate-900 dark:text-slate-50">页面不存在</h1>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">你访问的地址可能已失效或输入有误。</p>
        <Link to="/" className="mt-6 inline-block">
          <SiteButton type="button">返回素材中心</SiteButton>
        </Link>
      </SitePanel>
    </SitePageLayout>
  );
}
