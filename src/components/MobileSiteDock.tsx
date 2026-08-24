import { Link, useLocation } from "react-router-dom";

const MOBILE_NAV_ITEMS = [
  { to: "/", label: "素材", icon: "⌂" },
  { to: "/share", label: "分享", icon: "↑" },
  { to: "/webusb-test", label: "设备", icon: "▣" },
  { to: "/activities", label: "活动", icon: "⌁" },
  { to: "/profile", label: "我的", icon: "○" },
];

export function MobileSiteDock() {
  const location = useLocation();

  return (
    <nav className="fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-[95] grid h-[62px] grid-cols-5 rounded-[22px] border border-white/60 bg-white/86 p-1.5 shadow-[0_18px_55px_rgba(15,23,42,.2)] backdrop-blur-2xl md:hidden dark:border-white/10 dark:bg-slate-900/88" aria-label="手机快捷导航">
      {MOBILE_NAV_ITEMS.map((item) => {
        const active = location.pathname === item.to;
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`flex min-w-0 flex-col items-center justify-center rounded-[16px] text-[10px] font-medium transition ${
              active
                ? "bg-[#0071e3] text-white shadow-[0_6px_16px_rgba(0,113,227,.24)]"
                : "text-slate-500 active:bg-slate-100 dark:text-slate-300 dark:active:bg-white/10"
            }`}
          >
            <span className="mb-0.5 text-[17px] leading-none" aria-hidden="true">{item.icon}</span>
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
