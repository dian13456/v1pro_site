import type { ThemeMode } from "../types/theme";
import { THEME_OPTIONS } from "../types/theme";

interface ThemeSelectorProps {
  theme: ThemeMode;
  onChange: (theme: ThemeMode) => void;
}

export function ThemeSelector({ theme, onChange }: ThemeSelectorProps) {
  return (
    <div
      className="inline-flex flex-wrap items-center gap-1 rounded-full border border-white/30 bg-white/50 p-1 backdrop-blur dark:border-white/10 dark:bg-slate-900/45"
      role="group"
      aria-label="主题切换"
    >
      {THEME_OPTIONS.map((option) => {
        const active = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition sm:text-sm ${
              active
                ? option.value === "cat"
                  ? "bg-pink-500 text-white shadow-sm shadow-pink-500/30"
                  : "bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900"
                : "text-slate-600 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-slate-800/70"
            }`}
          >
            {option.value === "cat" ? "🐱 " : ""}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
