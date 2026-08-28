import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getAuthState, matchesAuthenticatedUsbDevice } from "../services/authService";
import { getDisplayName } from "../services/welcomeService";
import { ThemeIcon } from "./ThemeIcon";

type DevicePresence = "checking" | "online" | "offline" | "unsupported";

export function DeviceStatusCapsule({
  open,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const auth = getAuthState();
  const [presence, setPresence] = useState<DevicePresence>("checking");

  const refresh = useCallback(async () => {
    const current = getAuthState();
    if (!current?.serial) {
      setPresence("offline");
      return;
    }
    if (!("usb" in navigator)) {
      setPresence("unsupported");
      return;
    }
    try {
      const devices = await navigator.usb.getDevices();
      setPresence(devices.some((device) => matchesAuthenticatedUsbDevice(device, current.serial)) ? "online" : "offline");
    } catch {
      setPresence("offline");
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!("usb" in navigator)) return;
    const handleChange = () => void refresh();
    navigator.usb.addEventListener("connect", handleChange);
    navigator.usb.addEventListener("disconnect", handleChange);
    window.addEventListener("focus", handleChange);
    return () => {
      navigator.usb.removeEventListener("connect", handleChange);
      navigator.usb.removeEventListener("disconnect", handleChange);
      window.removeEventListener("focus", handleChange);
    };
  }, [refresh]);

  if (!auth?.serial) {
    return (
      <Link to="/auth" className="hidden h-10 shrink-0 items-center gap-2 rounded-full border border-black/[.06] bg-white/70 px-3 text-[12px] font-medium text-slate-500 transition hover:bg-white hover:text-[#0071e3] dark:border-white/10 dark:bg-white/[.06] dark:text-slate-300 lg:inline-flex">
        <span className="h-2 w-2 rounded-full bg-slate-300" />连接设备
      </Link>
    );
  }

  const online = presence === "online";
  const displayName = auth.displayName?.trim() || getDisplayName(auth.serial);

  return (
    <details
      className="group/device-status relative hidden shrink-0 lg:block"
      open={open}
      onToggle={(event) => onOpenChange?.(event.currentTarget.open)}
    >
      <summary className="flex h-10 max-w-[190px] cursor-pointer list-none items-center gap-2 rounded-full border border-black/[.06] bg-white/72 px-3 text-[12px] font-medium text-slate-600 transition hover:bg-white dark:border-white/10 dark:bg-white/[.06] dark:text-slate-200 [&::-webkit-details-marker]:hidden">
        <span className={`h-2 w-2 shrink-0 rounded-full ${online ? "bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,.12)]" : "bg-slate-300"}`} />
        <span className="truncate">{displayName}</span>
        <span className="text-[10px] text-slate-400">⌄</span>
      </summary>
      <div className="absolute right-0 top-[calc(100%+10px)] z-[125] w-72 rounded-[20px] border border-black/[.07] bg-white/96 p-4 shadow-[0_22px_60px_rgba(15,23,42,.18)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-900/96">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-[#0071e3]/10 text-[#0071e3] dark:bg-sky-500/15 dark:text-sky-300">
            <ThemeIcon name="device" size={21} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{displayName}</p>
            <p className={`mt-1 text-xs font-medium ${online ? "text-emerald-600 dark:text-emerald-300" : "text-slate-400"}`}>
              {presence === "checking" ? "正在检测设备…" : online ? "设备已插入，可进行网页直传" : presence === "unsupported" ? "当前浏览器不支持 WebUSB" : "设备未插入或尚未授权"}
            </p>
          </div>
        </div>
        <div className="mt-3 rounded-[14px] bg-slate-50 px-3 py-2.5 dark:bg-white/[.055]">
          <p className="text-[10px] uppercase tracking-[.14em] text-slate-400">Serial Number</p>
          <p className="mt-1 break-all font-mono text-[11px] text-slate-600 dark:text-slate-300">{auth.serial}</p>
        </div>
        <Link to="/webusb-test" onClick={() => onOpenChange?.(false)} className="mt-3 flex h-10 items-center justify-center rounded-full bg-[#0071e3] text-sm font-semibold text-white shadow-[0_7px_18px_rgba(0,113,227,.22)] transition hover:bg-[#0878e8]">
          打开设备控制
        </Link>
      </div>
    </details>
  );
}
