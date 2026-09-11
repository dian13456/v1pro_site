import { useI18n } from "../i18n";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ThemeIcon } from "./ThemeIcon";

const RECENT_SEARCH_KEY = "jiadian_resource_recent_searches_v1";
const POPULAR_SEARCHES = ["循环动画", "动漫", "像素风", "猫猫", "游戏", "桌搭"];

function readRecentSearches(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_SEARCH_KEY) || "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 6) : [];
  } catch {
    return [];
  }
}

export function ResourceSearchBox({
  keyword,
  onSearch,
  placeholder,
  open: controlledOpen,
  onOpenChange,
}: {
  keyword: string;
  onSearch: (value: string) => void;
  placeholder: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(keyword);
  const [internalOpen, setInternalOpen] = useState(false);
  const [recent, setRecent] = useState(readRecentSearches);
  const open = controlledOpen ?? internalOpen;

  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  useEffect(() => setDraft(keyword), [keyword]);

  const suggestions = useMemo(() => {
    const query = draft.trim().toLowerCase();
    const pool = Array.from(new Set([...recent, ...POPULAR_SEARCHES]));
    return (query ? pool.filter((item) => item.toLowerCase().includes(query) || (POPULAR_SEARCHES.includes(item) && t(item).toLowerCase().includes(query))) : pool).slice(0, 6);
  }, [draft, recent, t]);

  const applySearch = (value: string) => {
    const normalized = value.trim();
    if (normalized) {
      const next = [normalized, ...recent.filter((item) => item !== normalized)].slice(0, 6);
      setRecent(next);
      try { localStorage.setItem(RECENT_SEARCH_KEY, JSON.stringify(next)); } catch { /* Search works without persistent storage. */ }
    }
    setDraft(normalized);
    setOpen(false);
    onSearch(normalized);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    applySearch(draft);
  };

  return (
    <div className="relative min-w-0 w-full max-w-[390px] flex-1 max-[767px]:order-last max-[767px]:basis-full max-[767px]:max-w-none">
      <form onSubmit={submit} className="flex h-10 w-full items-center rounded-full border border-black/[.055] bg-black/[.035] px-3 transition focus-within:border-[#0071e3]/30 focus-within:bg-white focus-within:ring-4 focus-within:ring-[#0071e3]/10 dark:border-white/10 dark:bg-white/[.06] dark:focus-within:bg-slate-900 sm:px-4">
        <ThemeIcon name="search" size={16} className="mr-2 shrink-0 text-slate-400" />
        <input
          value={draft}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
          }}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[#2b3245] outline-none placeholder:text-[#8a93a8] dark:text-slate-100 dark:placeholder:text-slate-500"
          placeholder={t(placeholder)}
        />
        {draft ? (
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applySearch("")} className="ml-1 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs text-slate-400 transition hover:bg-slate-200 hover:text-slate-700" aria-label={t("清除搜索")}>×</button>
        ) : null}
      </form>
      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+10px)] z-[130] overflow-hidden rounded-[18px] border border-black/[.07] bg-white p-2 shadow-[0_22px_60px_rgba(15,23,42,.18)] dark:border-white/10 dark:bg-slate-900">
          <div className="flex items-center justify-between px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[.12em] text-slate-400">
            <span>{draft.trim() ? t("搜索建议") : recent.length ? t("最近与热门") : t("热门搜索")}</span>
            {recent.length ? (
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => {
                setRecent([]);
                try { localStorage.removeItem(RECENT_SEARCH_KEY); } catch { /* Keep the in-memory history cleared. */ }
              }} className="normal-case tracking-normal transition hover:text-slate-700 dark:hover:text-white">{t("清除历史")}</button>
            ) : null}
          </div>
          <div className="grid gap-1">
            {suggestions.map((item) => (
              <button key={item} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => applySearch(item)} className="flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-slate-600 transition hover:bg-slate-100 hover:text-[#0071e3] dark:text-slate-200 dark:hover:bg-white/[.07] dark:hover:text-sky-300">
                <span className="truncate">{POPULAR_SEARCHES.includes(item) ? t(item) : item}</span><span className="text-xs text-slate-300">↗</span>
              </button>
            ))}
            {suggestions.length === 0 ? <p className="px-3 py-4 text-center text-xs text-slate-400">{t("按 Enter 搜索“")}{draft.trim()}”</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
