import { Link, useLocation } from "react-router-dom";

const PRIMARY_NAV_ITEMS = [
  { to: "/", label: "素材主页" },
  { to: "/share", label: "分享素材" },
  { to: "/webusb-test", label: "设备控制" },
  { to: "/activities", label: "活动中心" },
  { to: "/profile", label: "个人中心" },
];

const MORE_NAV_ITEMS = [
  { to: "/guide", label: "AI 助手", icon: "✦" },
  { to: "/ai-image", label: "AI 生图", icon: "◉" },
  { to: "/favorites", label: "我的收藏", icon: "☆" },
  { to: "/leaderboard", label: "积分榜", icon: "⌁" },
  { to: "/downloads", label: "资料中心", icon: "↓" },
  { to: "/shop", label: "积分商城", icon: "◇" },
  { to: "/mall", label: "实物商城", icon: "▢" },
  { to: "/board", label: "留言板", icon: "···" },
];

export function SiteNav() {
  const location = useLocation();
  const moreActive = MORE_NAV_ITEMS.some((item) => location.pathname === item.to);

  return (
    <nav className="hidden flex-wrap items-center gap-2 md:flex" aria-label="网站导航">
      {PRIMARY_NAV_ITEMS.map((item) => {
        const active = location.pathname === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              active
                ? "bg-[#0071e3] text-white shadow-[0_7px_20px_rgba(0,113,227,.22)]"
                : "border border-black/[.055] bg-white/55 text-slate-700 backdrop-blur-xl hover:-translate-y-0.5 hover:bg-white dark:border-white/10 dark:bg-white/[.055] dark:text-slate-200 dark:hover:bg-white/[.1]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
      <details className="group relative">
        <summary
          className={`cursor-pointer list-none rounded-full px-4 py-2 text-sm font-medium transition [&::-webkit-details-marker]:hidden ${
            moreActive
              ? "bg-[#0071e3] text-white shadow-[0_7px_20px_rgba(0,113,227,.22)]"
              : "border border-black/[.055] bg-white/55 text-slate-700 backdrop-blur-xl hover:bg-white dark:border-white/10 dark:bg-white/[.055] dark:text-slate-200 dark:hover:bg-white/[.1]"
          }`}
        >
          更多 <span className="ml-1 inline-block text-[10px] transition group-open:rotate-180">⌄</span>
        </summary>
        <div className="absolute right-0 top-[calc(100%+10px)] z-[110] grid w-44 gap-1 rounded-[18px] border border-black/[.07] bg-white/95 p-2 shadow-[0_20px_55px_rgba(15,23,42,.16)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/95">
          {MORE_NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition ${
                location.pathname === item.to
                  ? "bg-[#0071e3]/10 font-semibold text-[#0071e3] dark:text-sky-300"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/[.07]"
              }`}
            >
              <span className="w-4 text-center text-xs" aria-hidden="true">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </div>
      </details>
    </nav>
  );
}
