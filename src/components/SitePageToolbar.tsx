import { useI18n, LanguageSwitcher } from "../i18n";
import { useNavigate } from "react-router-dom";
import { SiteNav } from "./SiteNav";
import { ThemeSelector } from "./ThemeSelector";
import { clearAuthState } from "../services/authService";
import { TechnicalSupportGroup } from "./TechnicalSupportGroup";
import type { ThemeMode } from "../types/theme";
import { DeviceStatusCapsule } from "./DeviceStatusCapsule";

interface SitePageToolbarProps {
  theme: ThemeMode;
  onSetTheme: (theme: ThemeMode) => void;
  mode?: "app" | "theme-only";
}

export function SitePageToolbar({ theme, onSetTheme, mode = "app" }: SitePageToolbarProps) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const handleLogout = () => {
    clearAuthState();
    navigate("/auth", { replace: true });
  };

  if (mode === "theme-only") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <LanguageSwitcher />
        <ThemeSelector theme={theme} onChange={onSetTheme} />
        <TechnicalSupportGroup />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SiteNav />
      <DeviceStatusCapsule />
      <LanguageSwitcher />
        <ThemeSelector theme={theme} onChange={onSetTheme} />
      <button
        type="button"
        onClick={handleLogout}
        className="rounded-full border border-white/30 bg-white/50 px-4 py-2 text-sm text-slate-700 backdrop-blur dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-100"
      >{t("退出认证")}</button>
      <TechnicalSupportGroup />
    </div>
  );
}
