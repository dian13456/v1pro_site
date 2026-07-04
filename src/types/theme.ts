export type ThemeMode = "light" | "dark" | "cat";

export const THEME_OPTIONS: Array<{ value: ThemeMode; label: string }> = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "cat", label: "粉色猫咪" },
];
