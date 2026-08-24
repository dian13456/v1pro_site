import { Link, useLocation } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/guide", label: "AI 助手", highlight: true },
  { to: "/share", label: "分享", highlight: true },
  { to: "/ai-image", label: "AI 生图", highlight: true },
  { to: "/", label: "素材中心", highlight: false },
  { to: "/favorites", label: "我的收藏", highlight: false },
  { to: "/activities", label: "活动中心", highlight: false },
  { to: "/downloads", label: "资料中心", highlight: false },
  { to: "/shop", label: "积分商城", highlight: true },
  { to: "/mall", label: "实物商城", highlight: false },
  { to: "/profile", label: "个人中心", highlight: false },
  { to: "/webusb-test", label: "设备控制", highlight: false },
  { to: "/board", label: "留言板", highlight: false },
];

export function SiteNav() {
  const location = useLocation();

  return (
    <nav className="flex flex-wrap items-center gap-2">
      {NAV_ITEMS.map((item) => {
        const active = location.pathname === item.to;
        if (item.highlight) {
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold transition ${
                active
                  ? "bg-[#0071e3] text-white shadow-[0_7px_20px_rgba(0,113,227,.25)] ring-1 ring-white/50"
                  : "border border-black/[.055] bg-white/65 text-slate-700 shadow-sm backdrop-blur-xl hover:-translate-y-0.5 hover:bg-white dark:border-white/10 dark:bg-white/[.06] dark:text-slate-100 dark:hover:bg-white/[.1]"
              }`}
            >
              <span aria-hidden="true">{active ? "●" : "○"}</span>
              {item.label}
            </Link>
          );
        }
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`rounded-full px-4 py-2 text-sm transition ${
              active
                ? "bg-[#0071e3] text-white shadow-[0_7px_20px_rgba(0,113,227,.22)]"
                : "border border-black/[.055] bg-white/55 text-slate-700 backdrop-blur-xl hover:bg-white dark:border-white/10 dark:bg-white/[.055] dark:text-slate-200 dark:hover:bg-white/[.1]"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
