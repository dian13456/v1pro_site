import type { ChangeEvent } from "react";
import type { ThemeMode } from "../types/theme";
import { THEME_OPTIONS } from "../types/theme";

interface ThemeSelectorProps {
  theme: ThemeMode;
  onChange: (theme: ThemeMode) => void;
}

const THEME_ICONS: Record<ThemeMode, string> = {
  light: "☀️",
  dark: "🌙",
  cat: "🐱",
  doro: "🎀",
};

export function ThemeSelector({ theme, onChange }: ThemeSelectorProps) {
  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onChange(event.target.value as ThemeMode);
  };

  return (
    <select
      aria-label="主题切换"
      value={theme}
      onChange={handleChange}
      className="max-w-full cursor-pointer appearance-none rounded-full border border-white/30 bg-white/50 bg-[length:12px] bg-[position:right_12px_center] bg-no-repeat py-2 pl-3 pr-9 text-sm text-slate-700 backdrop-blur outline-none ring-violet-400/40 transition focus:ring-2 dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-100"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 20 20' fill='none'%3E%3Cpath d='M5 7.5L10 12.5L15 7.5' stroke='%2364748b' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")",
      }}
    >
      {THEME_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {THEME_ICONS[option.value]} {option.label}
        </option>
      ))}
    </select>
  );
}
