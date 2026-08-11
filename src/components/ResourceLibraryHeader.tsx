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
    <header className="sticky top-0 z-30 h-[60px] border-b border-[#e6e9f2] bg-white">
      <div className="flex h-full items-center gap-6 px-4 sm:px-8">
        <Link to="/" className="flex shrink-0 items-center gap-2.5 text-xl font-extrabold text-[#2b3245]">
          <span className="grid h-[30px] w-[30px] place-items-center rounded-[10px] bg-gradient-to-br from-[#ff8a5c] to-[#7c6cf0] text-[17px] text-white">🐱</span>
          <span className="hidden sm:inline">佳点电子素材库</span>
        </Link>
        <form onSubmit={submit} className="flex h-9 min-w-0 max-w-[420px] flex-1 items-center rounded-full border border-[#e6e9f2] bg-[#f8f9fd] px-4">
          <span className="mr-2 text-slate-400">⌕</span>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#8a93a8]"
            placeholder="搜索素材，如「孤独摇滚」「眨眼」…"
          />
        </form>
        <Link
          to="/profile"
          className="hidden max-w-xs truncate rounded-full bg-[#f5f6fb] px-3 py-1.5 text-xs text-[#8a93a8] md:block"
          title={`SN: ${serial}`}
        >
          {nickname ? `${nickname} · ` : ""}SN: {serial}{credits != null ? ` · ${credits} 积分` : ""}
        </Link>
        <Link
          to="/share"
          className="shrink-0 rounded-full bg-gradient-to-br from-[#ff8a5c] to-[#ff6f9c] px-5 py-[9px] text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(255,138,92,.35)] transition hover:-translate-y-0.5"
        >
          ＋ 分享素材
        </Link>
      </div>
    </header>
  );
}
