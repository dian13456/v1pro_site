import { useEffect, useState } from "react";
import { isThemeMode, type ThemeMode } from "../types/theme";
import { applyInstalledThemeStyle, getInstalledThemePackage } from "../services/themePackageService";

const STORAGE_KEY = "jiadian_hub_theme";

export function getInitialTheme(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (isThemeMode(saved) && (saved !== "custom" || getInstalledThemePackage())) return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyThemeToDocument(theme: ThemeMode): void {
  const root = document.documentElement;
  const customTheme = applyInstalledThemeStyle();
  const effectiveTheme = theme === "custom" && !customTheme ? "light" : theme;
  root.dataset.theme = effectiveTheme;
  root.classList.toggle("dark", effectiveTheme === "dark" || (effectiveTheme === "custom" && customTheme?.appearance === "dark"));
  root.classList.toggle("theme-cat", effectiveTheme === "cat");
  root.classList.toggle("theme-doro", effectiveTheme === "doro");
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
