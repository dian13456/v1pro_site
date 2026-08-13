export const THEME_PACKAGE_STORAGE_KEY = "jiadian_hub_custom_theme_v1";
export const THEME_PACKAGE_CHANGED_EVENT = "v1pro-theme-package-changed";

export type ThemeAppearance = "light" | "dark";
export type ThemeIconName =
  | "search"
  | "upload"
  | "activity"
  | "leaderboard"
  | "favorite"
  | "like"
  | "download"
  | "device"
  | "user"
  | "logout"
  | "block"
  | "restore"
  | "success"
  | "warning"
  | "error"
  | "theme";

export interface ThemeIconDefinition {
  viewBox?: string;
  mode?: "stroke" | "fill";
  strokeWidth?: number;
  paths: string[];
}

export interface ThemeTokens {
  background: string;
  backgroundAccentA: string;
  backgroundAccentB: string;
  surface: string;
  surfaceSolid: string;
  surfaceMuted: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  primaryHover: string;
  primarySoft: string;
  secondary: string;
  success: string;
  warning: string;
  danger: string;
  radiusSmall: string;
  radiusMedium: string;
  radiusLarge: string;
  shadow: string;
  fontFamily: string;
}

export interface V1ProThemePackage {
  kind: "v1pro-theme";
  schemaVersion: 1;
  id: string;
  name: string;
  author: string;
  version: string;
  description?: string;
  appearance: ThemeAppearance;
  tokens: ThemeTokens;
  icons?: Partial<Record<ThemeIconName, ThemeIconDefinition>>;
}

const MAX_THEME_FILE_BYTES = 64 * 1024;
const CUSTOM_STYLE_ID = "v1pro-imported-theme-style";
const TOKEN_KEYS: Array<keyof ThemeTokens> = [
  "background",
  "backgroundAccentA",
  "backgroundAccentB",
  "surface",
  "surfaceSolid",
  "surfaceMuted",
  "text",
  "textMuted",
  "border",
  "primary",
  "primaryHover",
  "primarySoft",
  "secondary",
  "success",
  "warning",
  "danger",
  "radiusSmall",
  "radiusMedium",
  "radiusLarge",
  "shadow",
  "fontFamily",
];
const COLOR_KEYS = new Set<keyof ThemeTokens>(TOKEN_KEYS.slice(0, 16));
const RADIUS_KEYS = new Set<keyof ThemeTokens>(["radiusSmall", "radiusMedium", "radiusLarge"]);
export const THEME_ICON_NAMES: ThemeIconName[] = [
  "search", "upload", "activity", "leaderboard", "favorite", "like", "download", "device",
  "user", "logout", "block", "restore", "success", "warning", "error", "theme",
];

export const DEFAULT_THEME_PACKAGE: V1ProThemePackage = {
  kind: "v1pro-theme",
  schemaVersion: 1,
  id: "aurora-glass",
  name: "极光玻璃",
  author: "V1PRO",
  version: "1.0.0",
  description: "适用于 V1PRO 素材网站的深色极光玻璃主题",
  appearance: "dark",
  tokens: {
    background: "#0b0f14",
    backgroundAccentA: "rgba(116, 104, 238, 0.28)",
    backgroundAccentB: "rgba(6, 182, 212, 0.20)",
    surface: "rgba(21, 27, 36, 0.88)",
    surfaceSolid: "#151b24",
    surfaceMuted: "#1c2430",
    text: "#edf3fb",
    textMuted: "#95a1b3",
    border: "rgba(205, 220, 239, 0.14)",
    primary: "#7b70f2",
    primaryHover: "#9188ff",
    primarySoft: "rgba(123, 112, 242, 0.16)",
    secondary: "#22d3ee",
    success: "#32d583",
    warning: "#f5a524",
    danger: "#f97066",
    radiusSmall: "10px",
    radiusMedium: "16px",
    radiusLarge: "22px",
    shadow: "0 20px 54px rgba(0, 0, 0, 0.34)",
    fontFamily: "Inter, SF Pro Display, Segoe UI, system-ui, sans-serif",
  },
  icons: {
    like: { paths: ["M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.7-7.5 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z"] },
    favorite: { paths: ["m12 2.8 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.5 6.3-.9L12 2.8Z"] },
    download: { paths: ["M12 3v12", "m7 10 5 5 5-5", "M5 21h14"] },
  },
};

function isSafeText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function containsUnsafeCSS(value: string): boolean {
  return /[;{}]|url\s*\(|@import|expression\s*\(|javascript:/i.test(value);
}

function validateToken(key: keyof ThemeTokens, raw: unknown): string {
  if (!isSafeText(raw, key === "fontFamily" ? 160 : 120)) {
    throw new Error(`主题变量 ${key} 缺失或过长`);
  }
  const value = raw.trim();
  if (containsUnsafeCSS(value)) throw new Error(`主题变量 ${key} 含有不安全内容`);
  if (COLOR_KEYS.has(key) && !CSS.supports("color", value)) {
    throw new Error(`主题颜色 ${key} 格式无效`);
  }
  if (RADIUS_KEYS.has(key) && !/^\d+(?:\.\d+)?(?:px|rem)$/.test(value)) {
    throw new Error(`主题圆角 ${key} 仅支持 px 或 rem`);
  }
  if (key === "shadow" && !CSS.supports("box-shadow", value)) {
    throw new Error("主题阴影格式无效");
  }
  if (key === "fontFamily" && !/^[\w\s,.'"-]+$/.test(value)) {
    throw new Error("主题字体名称含有不支持的字符");
  }
  return value;
}

function validateIcons(raw: unknown): Partial<Record<ThemeIconName, ThemeIconDefinition>> | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("主题图标集合格式无效");
  const source = raw as Record<string, unknown>;
  const icons: Partial<Record<ThemeIconName, ThemeIconDefinition>> = {};
  for (const [rawName, rawDefinition] of Object.entries(source)) {
    if (!THEME_ICON_NAMES.includes(rawName as ThemeIconName)) throw new Error(`不支持的主题图标：${rawName}`);
    if (!rawDefinition || typeof rawDefinition !== "object" || Array.isArray(rawDefinition)) {
      throw new Error(`主题图标 ${rawName} 格式无效`);
    }
    const definition = rawDefinition as Partial<ThemeIconDefinition>;
    const viewBox = definition.viewBox || "0 0 24 24";
    if (!/^-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?){3}$/.test(viewBox)) {
      throw new Error(`主题图标 ${rawName} 的 viewBox 无效`);
    }
    const mode = definition.mode || "stroke";
    if (mode !== "stroke" && mode !== "fill") throw new Error(`主题图标 ${rawName} 的 mode 无效`);
    const strokeWidth = definition.strokeWidth ?? 1.8;
    if (!Number.isFinite(strokeWidth) || strokeWidth < 0.5 || strokeWidth > 4) {
      throw new Error(`主题图标 ${rawName} 的描边宽度应为 0.5–4`);
    }
    if (!Array.isArray(definition.paths) || definition.paths.length < 1 || definition.paths.length > 8) {
      throw new Error(`主题图标 ${rawName} 应包含 1–8 条 SVG path`);
    }
    const paths = definition.paths.map((path) => {
      if (typeof path !== "string" || path.length > 600 || !/^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/.test(path)) {
        throw new Error(`主题图标 ${rawName} 含有不安全的 SVG 路径`);
      }
      return path;
    });
    icons[rawName as ThemeIconName] = { viewBox, mode, strokeWidth, paths };
  }
  return icons;
}

export function parseThemePackage(raw: string): V1ProThemePackage {
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error("主题包不是有效的 JSON 文件");
  }
  if (!input || typeof input !== "object") throw new Error("主题包内容无效");
  const source = input as Partial<V1ProThemePackage> & { tokens?: Record<string, unknown> };
  if (source.kind !== "v1pro-theme" || source.schemaVersion !== 1) {
    throw new Error("不支持的主题包格式或版本");
  }
  if (!isSafeText(source.id, 48) || !/^[a-z0-9][a-z0-9-]*$/.test(source.id)) {
    throw new Error("主题 ID 只能包含小写字母、数字和连字符");
  }
  if (!isSafeText(source.name, 40) || !isSafeText(source.author, 40) || !isSafeText(source.version, 20)) {
    throw new Error("主题名称、作者或版本无效");
  }
  if (source.appearance !== "light" && source.appearance !== "dark") {
    throw new Error("主题 appearance 必须是 light 或 dark");
  }
  if (!source.tokens || typeof source.tokens !== "object") throw new Error("主题变量缺失");
  const tokens = {} as ThemeTokens;
  for (const key of TOKEN_KEYS) tokens[key] = validateToken(key, source.tokens[key]);
  return {
    kind: "v1pro-theme",
    schemaVersion: 1,
    id: source.id,
    name: source.name.trim(),
    author: source.author.trim(),
    version: source.version.trim(),
    description: typeof source.description === "string" ? source.description.trim().slice(0, 160) : "",
    appearance: source.appearance,
    tokens,
    icons: validateIcons(source.icons),
  };
}

export async function readThemePackageFile(file: File): Promise<V1ProThemePackage> {
  if (file.size <= 0 || file.size > MAX_THEME_FILE_BYTES) {
    throw new Error("主题包大小必须在 1 B 到 64 KB 之间");
  }
  if (!/\.(?:v1theme|json)$/i.test(file.name)) {
    throw new Error("请选择 .v1theme 或 .json 主题包");
  }
  return parseThemePackage(await file.text());
}

export function getInstalledThemePackage(): V1ProThemePackage | null {
  try {
    const raw = localStorage.getItem(THEME_PACKAGE_STORAGE_KEY);
    return raw ? parseThemePackage(raw) : null;
  } catch {
    return null;
  }
}

export function installThemePackage(themePackage: V1ProThemePackage): void {
  localStorage.setItem(THEME_PACKAGE_STORAGE_KEY, JSON.stringify(themePackage));
  window.dispatchEvent(new CustomEvent(THEME_PACKAGE_CHANGED_EVENT));
}

export function removeInstalledThemePackage(): void {
  localStorage.removeItem(THEME_PACKAGE_STORAGE_KEY);
  document.getElementById(CUSTOM_STYLE_ID)?.remove();
  window.dispatchEvent(new CustomEvent(THEME_PACKAGE_CHANGED_EVENT));
}

function buildThemeCSS(themePackage: V1ProThemePackage): string {
  const t = themePackage.tokens;
  return `
html[data-theme="custom"] {
  color-scheme: ${themePackage.appearance};
  --site-shell-bg: radial-gradient(circle at 10% 4%, ${t.backgroundAccentA}, transparent 34%), radial-gradient(circle at 92% 12%, ${t.backgroundAccentB}, transparent 32%), ${t.background};
  --site-accent: ${t.primary};
  --site-scrollbar-top: ${t.primary};
  --site-scrollbar-bottom: ${t.secondary};
  --v1-custom-bg: ${t.background};
  --v1-custom-surface: ${t.surface};
  --v1-custom-surface-solid: ${t.surfaceSolid};
  --v1-custom-surface-muted: ${t.surfaceMuted};
  --v1-custom-text: ${t.text};
  --v1-custom-muted: ${t.textMuted};
  --v1-custom-border: ${t.border};
  --v1-custom-primary: ${t.primary};
  --v1-custom-primary-hover: ${t.primaryHover};
  --v1-custom-primary-soft: ${t.primarySoft};
  --v1-custom-secondary: ${t.secondary};
  --v1-custom-success: ${t.success};
  --v1-custom-warning: ${t.warning};
  --v1-custom-danger: ${t.danger};
  --v1-custom-radius-sm: ${t.radiusSmall};
  --v1-custom-radius-md: ${t.radiusMedium};
  --v1-custom-radius-lg: ${t.radiusLarge};
  --v1-custom-shadow: ${t.shadow};
  font-family: ${t.fontFamily};
}
html[data-theme="custom"] body,
html[data-theme="custom"] .site-page-shell,
html[data-theme="custom"] .resource-library-shell { color: var(--v1-custom-text); background: var(--site-shell-bg) !important; }
html[data-theme="custom"] .site-header-panel,
html[data-theme="custom"] .site-panel-surface { color: var(--v1-custom-text); border-color: var(--v1-custom-border) !important; background: var(--v1-custom-surface) !important; box-shadow: var(--v1-custom-shadow); }
html[data-theme="custom"] .site-btn-primary { color: #fff !important; background: var(--v1-custom-primary) !important; }
html[data-theme="custom"] .site-btn-primary:hover { background: var(--v1-custom-primary-hover) !important; }
html[data-theme="custom"] .resource-library-shell > header { color: var(--v1-custom-text); border-color: var(--v1-custom-border) !important; background: var(--v1-custom-surface-solid) !important; }
html[data-theme="custom"] .resource-library-shell main > section,
html[data-theme="custom"] .resource-library-shell main > aside { border-color: var(--v1-custom-border) !important; }
`;
}

export function applyInstalledThemeStyle(): V1ProThemePackage | null {
  const installed = getInstalledThemePackage();
  const existing = document.getElementById(CUSTOM_STYLE_ID);
  if (!installed) {
    existing?.remove();
    return null;
  }
  const style = existing instanceof HTMLStyleElement ? existing : document.createElement("style");
  style.id = CUSTOM_STYLE_ID;
  style.textContent = buildThemeCSS(installed);
  if (!style.isConnected) document.head.appendChild(style);
  return installed;
}

export function downloadDefaultThemePackage(): void {
  const blob = new Blob([JSON.stringify(DEFAULT_THEME_PACKAGE, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "V1PRO-aurora-glass.v1theme";
  anchor.click();
  URL.revokeObjectURL(url);
}
