export type ThemeMode = "light" | "dark" | "cat" | "doro";

export const THEME_MODES: ThemeMode[] = ["light", "dark", "cat", "doro"];

export const THEME_OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "cat", label: "粉色猫咪" },
  { value: "doro", label: "Doro" },
];

export function isThemeMode(value: string | null): value is ThemeMode {
  return THEME_MODES.includes(value as ThemeMode);
}
