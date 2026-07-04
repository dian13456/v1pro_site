import { useEffect, useState } from "react";
import { isThemeMode, type ThemeMode } from "../types/theme";

const STORAGE_KEY = "jiadian_hub_theme";

export function getInitialTheme(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (isThemeMode(saved)) return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyThemeToDocument(theme: ThemeMode): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("theme-cat", theme === "cat");
  root.classList.toggle("theme-doro", theme === "doro");
}

export function useThemeMode() {
  const [theme, setThemeState] = useState<ThemeMode>(getInitialTheme);

  useEffect(() => {
    applyThemeToDocument(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = (next: ThemeMode) => {
    setThemeState(next);
  };

  return {
    theme,
    setTheme,
  };
}
