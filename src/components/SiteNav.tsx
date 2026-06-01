import { Link, useLocation } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/guide", label: "AI 助手", highlight: true },
  { to: "/", label: "素材中心", highlight: false },
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
                  ? "bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-500 text-white shadow-[0_10px_28px_-10px_rgba(139,92,246,0.9)] ring-2 ring-white/40"
                  : "bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-500 text-white shadow-[0_8px_24px_-8px_rgba(139,92,246,0.75)] hover:scale-[1.03] hover:brightness-110"
              }`}
            >
              <span aria-hidden="true">✨</span>
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
