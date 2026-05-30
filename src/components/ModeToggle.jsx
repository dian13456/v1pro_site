import { useEffect, useState } from "react";

const THEME_KEY = "jiadian_hub_theme";

function getInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function ModeToggle() {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return (
    <button
      type="button"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="rounded-full border border-white/25 bg-white/15 px-4 py-2 text-sm text-slate-700 backdrop-blur dark:text-slate-100"
    >
      {theme === "dark" ? "切换浅色" : "切换深色"}
    </button>
  );
}
