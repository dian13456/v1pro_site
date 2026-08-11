import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAuthState } from "../services/authService";
import { fetchProfile } from "../services/profileService";
import { getCustomDisplayName } from "../services/welcomeService";

interface ResourceLibraryHeaderProps {
  keyword: string;
  onSearch: (value: string) => void;
}

export function ResourceLibraryHeader({ keyword, onSearch }: ResourceLibraryHeaderProps) {
  const [draft, setDraft] = useState(keyword);
  const [credits, setCredits] = useState<number | null>(null);
  const auth = getAuthState();
  const serial = auth?.serial?.trim() || "未认证";
  const nickname = auth?.serial ? getCustomDisplayName(auth.serial) : "";

  useEffect(() => setDraft(keyword), [keyword]);
  useEffect(() => {
    let active = true;
    void fetchProfile()
      .then((profile) => {
        if (active && typeof profile.credits === "number") setCredits(profile.credits);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [serial]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(draft.trim());
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90">
      <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-4 py-3 sm:px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-amber-400 via-rose-400 to-violet-500 text-lg shadow-sm">🐱</span>
          <span className="hidden sm:inline">佳点电子素材库</span>
        </Link>
        <form onSubmit={submit} className="flex min-w-0 max-w-xl flex-1 items-center rounded-full border border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-900">
          <span className="mr-2 text-slate-400">⌕</span>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
            placeholder="搜索素材，如「孤独摇滚」「眨眼」…"
          />
        </form>
        <Link
          to="/profile"
          className="hidden max-w-xs truncate rounded-full bg-slate-50 px-4 py-2 text-xs text-slate-500 md:block dark:bg-slate-900 dark:text-slate-300"
          title={`SN: ${serial}`}
        >
          {nickname ? `${nickname} · ` : ""}SN: {serial}{credits != null ? ` · ${credits} 积分` : ""}
        </Link>
        <Link
          to="/share"
          className="shrink-0 rounded-full bg-gradient-to-r from-orange-400 to-rose-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-rose-400/20 transition hover:-translate-y-0.5"
        >
          ＋ 分享素材
        </Link>
      </div>
    </header>
  );
}
