/* eslint-disable react-refresh/only-export-components -- The shared locale store and its React bindings intentionally expose one public module. */
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { createTranslator, detectLocale, LOCALE_STORAGE_KEY, type MessageValues, type SiteLocale } from "./core";
import { messages } from "./messages";
import { apiMessages } from "./apiMessages";
import { transferMessages } from "./transferMessages";
import { deviceMessages } from "./deviceMessages";
import { resourceMessages } from "./resourceMessages";
import { commerceMessages } from "./commerceMessages";
import { termsMessages } from "./termsMessages";

export type { SiteLocale } from "./core";
function initialLocale(): SiteLocale {
  let saved: string | null = null;
  try { saved = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY) ?? null; } catch { /* Storage may be unavailable. */ }
  return detectLocale(saved, typeof navigator === "undefined" ? [] : navigator.languages || [navigator.language]);
}
let activeLocale = initialLocale();
const listeners = new Set<() => void>();
const localize = createTranslator({ ...transferMessages, ...apiMessages, ...deviceMessages, ...resourceMessages, ...commerceMessages, ...termsMessages, ...messages });
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function getLocale(): SiteLocale { return activeLocale; }
function applyLocale() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = activeLocale;
  document.title = translate("佳点 HUB 资源中心");
}
export function setLocale(locale: SiteLocale): void {
  if (locale !== "en" && locale !== "zh-CN") return;
  activeLocale = locale;
  try { localStorage.setItem(LOCALE_STORAGE_KEY, locale); } catch { /* Keep the in-memory preference. */ }
  applyLocale();
  listeners.forEach((listener) => listener());
}
export function translate(source: string, english?: string, values?: MessageValues): string {
  return localize(activeLocale, source, english, values);
}
export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getLocale, () => "en" as SiteLocale);
  return useMemo(() => ({ locale, setLocale, t: (source: string, english?: string, values?: MessageValues) => localize(locale, source, english, values) }), [locale]);
}
export function formatDate(value: string | number | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(activeLocale === "en" ? "en-US" : "zh-CN", options ?? { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(activeLocale === "en" ? "en-US" : "zh-CN", options).format(value);
}
export function I18nProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    applyLocale();
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LOCALE_STORAGE_KEY) return;
      activeLocale = detectLocale(event.newValue, navigator.languages);
      applyLocale();
      listeners.forEach((listener) => listener());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return <>{children}</>;
}
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return <label className="inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border border-slate-200 bg-white/70 px-2 text-sm text-slate-700 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100">
    <span aria-hidden="true">◎</span>
    <select aria-label={t("语言 / Language", "Language / 语言")} value={locale} onChange={(event) => setLocale(event.target.value as SiteLocale)} className={`min-w-0 cursor-pointer bg-transparent py-2 outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${compact ? "max-w-[95px]" : "max-w-[120px]"}`}>
      <option value="zh-CN" lang="zh-CN">简体中文</option>
      <option value="en" lang="en">English</option>
    </select>
  </label>;
}
