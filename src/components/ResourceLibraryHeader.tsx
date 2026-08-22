import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { clearAuthState } from "../services/authService";
import { TechnicalSupportGroup } from "./TechnicalSupportGroup";
import { ThemeIcon } from "./ThemeIcon";
import { useThemeMode } from "../hooks/useThemeMode";

interface ResourceLibraryHeaderProps {
  keyword: string;
  onSearch: (value: string) => void;
}

export function ResourceLibraryHeader({ keyword, onSearch }: ResourceLibraryHeaderProps) {
  const navigate = useNavigate();
  const { theme, setTheme } = useThemeMode();
  const [draft, setDraft] = useState(keyword);

  useEffect(() => setDraft(keyword), [keyword]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(draft.trim());
  };

  const handleLogout = () => {
    clearAuthState();
    navigate("/auth", { replace: true });
  };

  return (
    <header className="sticky top-0 z-[80] h-[60px] border-b border-[#e6e9f2] bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="flex h-full items-center gap-3 px-4 sm:px-8">
        <Link to="/" className="flex shrink-0 items-center gap-2.5 text-xl font-extrabold text-[#2b3245] dark:text-white">
          <span className="grid h-[30px] w-[30px] place-items-center rounded-[10px] bg-gradient-to-br from-[#ff8a5c] to-[#7c6cf0] text-[17px] text-white">🐱</span>
          <span className="hidden sm:inline">佳点电子素材库</span>
        </Link>
        <form onSubmit={submit} className="flex h-9 min-w-0 max-w-[300px] flex-1 items-center rounded-full border border-[#e6e9f2] bg-[#f8f9fd] px-4 dark:border-slate-700 dark:bg-slate-900">
          <ThemeIcon name="search" size={16} className="mr-2 shrink-0 text-slate-400" />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[#2b3245] outline-none placeholder:text-[#8a93a8] dark:text-slate-100 dark:placeholder:text-slate-500"
            placeholder="搜索素材，如「孤独摇滚」「眨眼」…"
          />
        </form>
        <Link
          to="/shop"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-2 text-[13px] font-semibold text-violet-700 transition hover:border-violet-400 hover:bg-violet-100 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200 dark:hover:bg-violet-500/20 sm:px-4"
        >
          <span aria-hidden="true">🎁</span>
          <span className="hidden sm:inline">积分商城</span>
        </Link>
        <Link
          to="/share"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-br from-[#ff8a5c] to-[#ff6f9c] px-5 py-[9px] text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(255,138,92,.35)] transition hover:-translate-y-0.5"
        >
          <ThemeIcon name="upload" size={15} /> 分享素材
        </Link>
        <Link
          to="/activities"
          className="hidden shrink-0 items-center gap-1.5 rounded-full border border-[#e6e9f2] bg-white px-4 py-2 text-[13px] font-semibold text-[#4a5270] transition hover:border-[#ff8a5c] hover:text-[#ff8a5c] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 lg:inline-flex"
        >
          <ThemeIcon name="activity" size={15} /> 活动中心
        </Link>
        <Link
          to="/leaderboard"
          className="hidden shrink-0 items-center gap-1.5 rounded-full border border-[#e6e9f2] bg-white px-4 py-2 text-[13px] font-semibold text-[#4a5270] transition hover:border-[#ff8a5c] hover:text-[#ff8a5c] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 xl:inline-flex"
        >
          <ThemeIcon name="leaderboard" size={15} /> 积分榜
        </Link>
        <Link
          to="/favorites"
          className="hidden shrink-0 items-center gap-1.5 rounded-full border border-[#e6e9f2] bg-white px-4 py-2 text-[13px] font-semibold text-[#4a5270] transition hover:border-[#ff8a5c] hover:text-[#ff8a5c] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 xl:inline-flex"
        >
          <ThemeIcon name="favorite" size={15} /> 我的收藏
        </Link>
        <Link
          to="/downloads"
          className="hidden shrink-0 items-center gap-1.5 rounded-full border border-[#e6e9f2] bg-white px-4 py-2 text-[13px] font-semibold text-[#4a5270] transition hover:border-[#ff8a5c] hover:text-[#ff8a5c] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 lg:inline-flex"
        >
          <ThemeIcon name="download" size={15} /> 资料中心
        </Link>
        <Link
          to="/webusb-test"
          className="hidden shrink-0 items-center gap-1.5 rounded-full border border-[#e6e9f2] bg-white px-4 py-2 text-[13px] font-semibold text-[#4a5270] transition hover:border-[#ff8a5c] hover:text-[#ff8a5c] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 xl:inline-flex"
        >
          <ThemeIcon name="device" size={15} /> 网页直传
        </Link>
        <Link
          to="/profile"
          className="hidden shrink-0 items-center gap-1.5 rounded-full border border-[#e6e9f2] bg-white px-4 py-2 text-[13px] font-semibold text-[#4a5270] transition hover:border-[#ff8a5c] hover:text-[#ff8a5c] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 lg:inline-flex"
        >
          <ThemeIcon name="user" size={15} /> 个人中心
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          className="hidden shrink-0 items-center gap-1.5 rounded-full border border-[#ffd9d4] bg-[#fff7f5] px-4 py-2 text-[13px] font-semibold text-[#ef6b62] transition hover:border-[#ef6b62] hover:bg-[#fff0ed] dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15 xl:inline-flex"
        >
          <ThemeIcon name="logout" size={15} /> 退出认证
        </button>
        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#e6e9f2] bg-white text-[#4a5270] transition hover:border-[#7c6cf0] hover:text-[#7c6cf0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          aria-label={theme === "dark" ? "切换为浅色模式" : "切换为深色模式"}
          title={theme === "dark" ? "切换为浅色模式" : "切换为深色模式"}
        >
          <span aria-hidden="true">{theme === "dark" ? "☀️" : "🌙"}</span>
        </button>
        <TechnicalSupportGroup compact />
      </div>
    </header>
  );
}
