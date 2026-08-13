import type { SVGProps } from "react";
import {
  getInstalledThemePackage,
  type ThemeIconDefinition,
  type ThemeIconName,
} from "../services/themePackageService";

const DEFAULT_ICONS: Record<ThemeIconName, ThemeIconDefinition> = {
  search: { paths: ["m21 21-4.4-4.4", "M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z"] },
  upload: { paths: ["M12 16V4", "m7 9 5-5 5 5", "M5 20h14"] },
  activity: { paths: ["M4 14h4l2-7 4 12 2-5h4"] },
  leaderboard: { paths: ["M5 20V10h4v10", "M10 20V4h4v16", "M15 20v-7h4v7"] },
  favorite: { paths: ["m12 2.8 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.5 6.3-.9L12 2.8Z"] },
  like: { paths: ["M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.7-7.5 1.1-1.1a5.5 5.5 0 0 0 0-7.8Z"] },
  download: { paths: ["M12 3v12", "m7 10 5 5 5-5", "M5 21h14"] },
  device: { paths: ["M6 3h12v18H6z", "M10 17h4"] },
  user: { paths: ["M20 21a8 8 0 0 0-16 0", "M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"] },
  logout: { paths: ["M10 17l5-5-5-5", "M15 12H3", "M15 3h5v18h-5"] },
  block: { paths: ["M5 5l14 14", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"] },
  restore: { paths: ["M3 12a9 9 0 1 0 3-6.7", "M3 4v6h6"] },
  success: { paths: ["m5 12 4 4L19 6"] },
  warning: { paths: ["m12 3 10 18H2L12 3Z", "M12 9v5", "M12 18h.01"] },
  error: { paths: ["M6 6l12 12", "M18 6 6 18"] },
  theme: { paths: ["M12 3a9 9 0 1 0 9 9c0-1.1-.9-2-2-2h-2a2 2 0 0 1-2-2V6c0-1.7-1.3-3-3-3Z", "M7.5 10h.01", "M10 6.5h.01", "M7 15h.01"] },
};

export function ThemeIcon({
  name,
  size = 18,
  title,
  filled = false,
  ...props
}: SVGProps<SVGSVGElement> & { name: ThemeIconName; size?: number; title?: string; filled?: boolean }) {
  const custom = document.documentElement.dataset.theme === "custom"
    ? getInstalledThemePackage()?.icons?.[name]
    : undefined;
  const icon = custom || DEFAULT_ICONS[name];
  const mode = icon.mode || "stroke";
  return (
    <svg
      viewBox={icon.viewBox || "0 0 24 24"}
      width={size}
      height={size}
      fill={mode === "fill" || filled ? "currentColor" : "none"}
      stroke={mode === "stroke" ? "currentColor" : "none"}
      strokeWidth={icon.strokeWidth || 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {icon.paths.map((path, index) => <path key={`${name}-${index}`} d={path} />)}
    </svg>
  );
}
