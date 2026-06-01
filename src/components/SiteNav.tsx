import { Link, useLocation } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/", label: "素材中心" },
  { to: "/guide", label: "AI 导览" },
  { to: "/board", label: "留言板" },
];

export function SiteNav() {
  const location = useLocation();

  return (
    <nav className="flex flex-wrap items-center gap-2">
      {NAV_ITEMS.map((item) => {
        const active = location.pathname === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`rounded-full px-4 py-2 text-sm transition ${
              active
                ? "bg-violet-600 text-white"
                : "border border-white/25 bg-white/55 text-slate-700 hover:bg-white/80 dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-200 dark:hover:bg-slate-900/70"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
