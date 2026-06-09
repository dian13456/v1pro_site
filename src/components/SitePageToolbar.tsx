import { useNavigate } from "react-router-dom";
import { SiteNav } from "./SiteNav";
import { ThemeToggle } from "./ThemeToggle";
import { clearAuthState } from "../services/authService";

interface SitePageToolbarProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

export function SitePageToolbar({ theme, onToggleTheme }: SitePageToolbarProps) {
  const navigate = useNavigate();

  const handleLogout = () => {
    clearAuthState();
    navigate("/auth", { replace: true });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SiteNav />
      <ThemeToggle dark={theme === "dark"} onToggle={onToggleTheme} />
      <button
        type="button"
        onClick={handleLogout}
        className="rounded-full border border-white/30 bg-white/50 px-4 py-2 text-sm text-slate-700 backdrop-blur dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-100"
      >
        退出认证
      </button>
    </div>
  );
}
