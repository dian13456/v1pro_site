import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { clearAuthState } from "../services/authService";
import { TechnicalSupportGroup } from "./TechnicalSupportGroup";

interface ResourceLibraryHeaderProps {
  keyword: string;
  onSearch: (value: string) => void;
}

export function ResourceLibraryHeader({ keyword, onSearch }: ResourceLibraryHeaderProps) {
  const navigate = useNavigate();
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
    <header className="sticky top-0 z-[80] h-[60px] border-b border-[#e6e9f2] bg-white">
      <div className="flex h-full items-center gap-3 px-4 sm:px-8">
        <Link to="/" className="flex shrink-0 items-center gap-2.5 text-xl font-extrabold text-[#2b3245]">
          <span className="grid h-[30px] w-[30px] place-items-center rounded-[10px] bg-gradient-to-br from-[#ff8a5c] to-[#7c6cf0] text-[17px] text-white">🐱</span>
          <span className="hidden sm:inline">佳点电子素材库</span>
        </Link>
        <form onSubmit={submit} className="flex h-9 min-w-0 max-w-[300px] flex-1 items-center rounded-full border border-[#e6e9f2] bg-[#f8f9fd] px-4">
          <span className="mr-2 text-slate-400">⌕</span>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#8a93a8]"
            placeholder="搜索素材，如「孤独摇滚」「眨眼」…"
          />
        </form>
        <Link
          to="/"
          className="hidden shrink-0 rounded-full border border-[#e6e9f2] bg-white px-4 py-2 text-[13px] font-semibold text-[#4a5270] transition hover:border-[#ff8a5c] hover:text-[#ff8a5c] sm:inline-flex"
        >
          素材主页
        </Link>
        <Link
          to="/share"
          className="shrink-0 rounded-full bg-gradient-to-br from-[#ff8a5c] to-[#ff6f9c] px-5 py-[9px] text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(255,138,92,.35)] transition hover:-translate-y-0.5"
        >
          ＋ 分享素材
        </Link>
        <Link
          to="/activities"
          className="hidden shrink-0 rounded-full border border-[#e6e9f2] bg-white px-4 py-2 text-[13px] font-semibold text-[#4a5270] transition hover:border-[#ff8a5c] hover:text-[#ff8a5c] lg:inline-flex"
        >
          活动中心
        </Link>
        <Link
          to="/leaderboard"
          className="hidden shrink-0 rounded-full border border-[#e6e9f2] bg-white px-4 py-2 text-[13px] font-semibold text-[#4a5270] transition hover:border-[#ff8a5c] hover:text-[#ff8a5c] xl:inline-flex"
        >
          积分榜
        </Link>
        <Link
          to="/favorites"
          className="hidden shrink-0 rounded-full border border-[#e6e9f2] bg-white px-4 py-2 text-[13px] font-semibold text-[#4a5270] transition hover:border-[#ff8a5c] hover:text-[#ff8a5c] xl:inline-flex"
        >
          我的收藏
        </Link>
        <Link
          to="/downloads"
          className="hidden shrink-0 rounded-full border border-[#e6e9f2] bg-white px-4 py-2 text-[13px] font-semibold text-[#4a5270] transition hover:border-[#ff8a5c] hover:text-[#ff8a5c] lg:inline-flex"
        >
          资料中心
        </Link>
        <Link
          to="/webusb-test"
          className="hidden shrink-0 rounded-full border border-[#e6e9f2] bg-white px-4 py-2 text-[13px] font-semibold text-[#4a5270] transition hover:border-[#ff8a5c] hover:text-[#ff8a5c] xl:inline-flex"
        >
          网页直传
        </Link>
        <Link
          to="/profile"
          className="hidden shrink-0 rounded-full border border-[#e6e9f2] bg-white px-4 py-2 text-[13px] font-semibold text-[#4a5270] transition hover:border-[#ff8a5c] hover:text-[#ff8a5c] lg:inline-flex"
        >
          个人中心
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          className="hidden shrink-0 rounded-full border border-[#ffd9d4] bg-[#fff7f5] px-4 py-2 text-[13px] font-semibold text-[#ef6b62] transition hover:border-[#ef6b62] hover:bg-[#fff0ed] xl:inline-flex"
        >
          退出认证
        </button>
        <TechnicalSupportGroup compact />
      </div>
    </header>
  );
}
