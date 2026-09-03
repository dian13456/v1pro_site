import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { clearAuthState } from "../services/authService";
import { TechnicalSupportGroup } from "./TechnicalSupportGroup";
import { ThemeIcon } from "./ThemeIcon";
import { useThemeMode } from "../hooks/useThemeMode";
import { MobileSiteDock } from "./MobileSiteDock";
import { DeviceStatusCapsule } from "./DeviceStatusCapsule";
import { ResourceSearchBox } from "./ResourceSearchBox";

interface ResourceLibraryHeaderProps {
  keyword: string;
  onSearch: (value: string) => void;
  searchPlaceholder?: string;
}

const MORE_LINKS = [
  { to: "/guide", label: "AI 助手", icon: "✦" },
  { to: "/ai-image", label: "AI 生图", icon: "◉" },
  { to: "/favorites", label: "我的收藏", icon: "☆" },
  { to: "/leaderboard", label: "积分榜", icon: "⌁" },
  { to: "/downloads", label: "资料中心", icon: "↓" },
  { to: "/shop", label: "积分商城", icon: "◇" },
  { to: "/mall", label: "实物商城", icon: "▢" },
  { to: "/board", label: "留言板", icon: "···" },
  { to: "/admin/materials", label: "素材管理", icon: "⚙" },
];

type HeaderMenu = "search" | "device" | "more" | "support";

export function ResourceLibraryHeader({
  keyword,
  onSearch,
  searchPlaceholder = "搜索素材，如「孤独摇滚」「眨眼」…",
}: ResourceLibraryHeaderProps) {
  const navigate = useNavigate();
  const { theme, setTheme } = useThemeMode();
  const headerRef = useRef<HTMLElement>(null);
  const [activeMenu, setActiveMenu] = useState<HeaderMenu | null>(null);

  const updateMenu = (menu: HeaderMenu, open: boolean) => {
    setActiveMenu((current) => open ? menu : current === menu ? null : current);
  };

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (activeMenu === "support") return;
      const target = event.target;
      if (target instanceof Node && !headerRef.current?.contains(target)) {
        setActiveMenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveMenu(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeMenu]);

  const handleLogout = () => {
    clearAuthState();
    navigate("/auth", { replace: true });
  };

  return (
    <>
    <header ref={headerRef} className="resource-library-header sticky top-0 z-[80] min-h-[64px] border-b border-[#e6e9f2] bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="flex min-w-0 min-h-[64px] items-center gap-2.5 px-4 sm:px-6 xl:px-8 max-[479px]:flex-wrap max-[479px]:gap-1.5 max-[479px]:py-2">
        <Link to="/" className="flex shrink-0 items-center gap-2.5 text-xl font-extrabold tracking-[-0.025em] text-[#2b3245] dark:text-white">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-gradient-to-b from-[#2997ff] to-[#0071e3] text-[17px] text-white shadow-[0_5px_14px_rgba(0,113,227,.25)]">🐱</span>
          <span className="hidden 2xl:inline">佳点电子素材库</span>
        </Link>

        <ResourceSearchBox
          keyword={keyword}
          onSearch={onSearch}
          placeholder={searchPlaceholder}
          open={activeMenu === "search"}
          onOpenChange={(open) => updateMenu("search", open)}
        />

        <Link
          to="/share"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-b from-[#2997ff] to-[#0071e3] px-3.5 text-[13px] font-semibold text-white shadow-[0_6px_18px_rgba(0,113,227,.24)] transition hover:-translate-y-0.5 hover:shadow-[0_9px_24px_rgba(0,113,227,.3)] sm:px-5"
        >
          <ThemeIcon name="upload" size={15} /> <span className="hidden sm:inline">分享素材</span>
        </Link>
        <Link to="/activities" className="hidden h-10 shrink-0 items-center gap-1.5 rounded-full border border-black/[.06] bg-white/70 px-4 text-[13px] font-semibold text-[#4a5270] transition hover:bg-white hover:text-[#0071e3] dark:border-white/10 dark:bg-white/[.06] dark:text-slate-200 xl:inline-flex">
          <ThemeIcon name="activity" size={15} /> 活动中心
        </Link>
        <Link to="/webusb-test" className="hidden h-10 shrink-0 items-center gap-1.5 rounded-full border border-black/[.06] bg-white/70 px-4 text-[13px] font-semibold text-[#4a5270] transition hover:bg-white hover:text-[#0071e3] dark:border-white/10 dark:bg-white/[.06] dark:text-slate-200 lg:inline-flex">
          <ThemeIcon name="device" size={15} /> 设备控制
        </Link>
        <Link to="/profile" className="hidden h-10 shrink-0 items-center gap-1.5 rounded-full border border-black/[.06] bg-white/70 px-4 text-[13px] font-semibold text-[#4a5270] transition hover:bg-white hover:text-[#0071e3] dark:border-white/10 dark:bg-white/[.06] dark:text-slate-200 xl:inline-flex">
          <ThemeIcon name="user" size={15} /> 个人中心
        </Link>

        <DeviceStatusCapsule
          open={activeMenu === "device"}
          onOpenChange={(open) => updateMenu("device", open)}
        />

        <details
          className="group relative shrink-0"
          open={activeMenu === "more"}
          onToggle={(event) => updateMenu("more", event.currentTarget.open)}
        >
          <summary className="grid h-10 min-w-10 cursor-pointer list-none place-items-center rounded-full border border-black/[.06] bg-white/75 px-3 text-[13px] font-semibold text-[#4a5270] transition hover:bg-white hover:text-[#0071e3] dark:border-white/10 dark:bg-white/[.06] dark:text-slate-200 [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true">•••</span><span className="sr-only">更多功能</span>
          </summary>
          <div className="absolute right-0 top-[calc(100%+10px)] z-[120] w-48 rounded-[18px] border border-black/[.07] bg-white/95 p-2 shadow-[0_20px_55px_rgba(15,23,42,.18)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/95">
            <div className="grid gap-1 lg:hidden">
              <Link to="/webusb-test" onClick={() => setActiveMenu(null)} className="rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[.07]">设备控制</Link>
            </div>
            <div className="grid gap-1 xl:hidden">
              <Link to="/activities" onClick={() => setActiveMenu(null)} className="rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[.07]">活动中心</Link>
              <Link to="/profile" onClick={() => setActiveMenu(null)} className="rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[.07]">个人中心</Link>
            </div>
            <div className="grid gap-1">
              {MORE_LINKS.map((item) => (
                <Link key={item.to} to={item.to} onClick={() => setActiveMenu(null)} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[.07]">
                  <span className="w-4 text-center text-xs" aria-hidden="true">{item.icon}</span>{item.label}
                </Link>
              ))}
            </div>
            <div className="my-1 h-px bg-slate-100 dark:bg-white/10" />
            <button type="button" onClick={handleLogout} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-rose-500 transition hover:bg-rose-50 dark:hover:bg-rose-500/10">
              <ThemeIcon name="logout" size={15} />退出认证
            </button>
          </div>
        </details>

        <button
          type="button"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-black/[.06] bg-white/75 text-[#4a5270] transition hover:bg-white hover:text-[#0071e3] dark:border-white/10 dark:bg-white/[.06] dark:text-slate-200"
          aria-label={theme === "dark" ? "切换为浅色模式" : "切换为深色模式"}
          title={theme === "dark" ? "切换为浅色模式" : "切换为深色模式"}
        >
          <span aria-hidden="true">{theme === "dark" ? "☀️" : "🌙"}</span>
        </button>
        <TechnicalSupportGroup
          compact
          open={activeMenu === "support"}
          onOpenChange={(open) => updateMenu("support", open)}
        />
      </div>
    </header>
    <MobileSiteDock />
    </>
  );
}
