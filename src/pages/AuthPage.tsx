import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { SiteFooter } from "../components/SiteFooter";
import { SitePageShell } from "../components/SitePageShell";
import { SiteAlert, SiteButton, SitePanel } from "../components/SiteUi";
import { ThemeSelector } from "../components/ThemeSelector";
import { TERMS_TITLE } from "../content/termsOfUse";
import { useThemeMode } from "../hooks/useThemeMode";
import {
  DEVICE_MISMATCH_MESSAGE,
  hasGrantedAuthorizedDevice,
  listGrantedAuthorizedDevices,
  requestUsbAndAuthorize,
  tryAuthorizeGrantedDevice,
} from "../services/authService";
import { acceptTerms } from "../services/termsService";

const AUTO_CONNECT_TIMEOUT_MS = 12_000;
const USB_PICKER_GUIDE_STORAGE_KEY = "jiadian_hub_usb_picker_guide_seen";

type SilentConnectResult = "ok" | "timeout" | "failed";

async function runSilentConnect(
  finishAuth: (serial: string) => void,
  timeoutMs: number,
): Promise<SilentConnectResult> {
  let settled = false;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve("timeout");
    }, timeoutMs);

    void tryAuthorizeGrantedDevice().then((state) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (!state) {
        resolve("failed");
        return;
      }
      finishAuth(state.serial);
      resolve("ok");
    });
  });
}

export default function AuthPage() {
  const { theme, setTheme } = useThemeMode();
  const [loading, setLoading] = useState(false);
  const [autoConnecting, setAutoConnecting] = useState(false);
  const [canSilentConnect, setCanSilentConnect] = useState(false);
  const [authorizedCount, setAuthorizedCount] = useState(0);
  const [error, setError] = useState("");
  const [showUsbPickerGuide, setShowUsbPickerGuide] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const autoTriedRef = useRef(false);

  const redirectTarget =
    typeof location.state === "object" &&
    location.state &&
    "from" in location.state &&
    typeof (location.state as { from?: { pathname?: string } }).from?.pathname === "string"
      ? (location.state as { from: { pathname: string } }).from.pathname
      : "/";

  const finishAuth = useCallback(
    (serial: string) => {
      acceptTerms(serial);
      navigate(redirectTarget, { replace: true });
    },
    [navigate, redirectTarget],
  );

  const attemptSilentConnect = useCallback(async (): Promise<SilentConnectResult> => {
    return runSilentConnect(finishAuth, AUTO_CONNECT_TIMEOUT_MS);
  }, [finishAuth]);

  const handleVerify = async () => {
    try {
      setLoading(true);
      setError("");

      // A button click must always open the browser device picker. Do not
      // silently reuse the first authorized device when several V1PROs exist.
      const silent = "failed" as SilentConnectResult;
      if (silent === "ok") {
        return;
      }
      if (silent === "timeout") {
        setError("连接超时。请关闭「佳点V1PRO控制工具」和设备控制页后重试。");
        return;
      }

      const state = await requestUsbAndAuthorize();
      finishAuth(state.serial);
    } catch (err) {
      setError((err as Error)?.message || DEVICE_MISMATCH_MESSAGE);
    } finally {
      setLoading(false);
    }
  };

  const openUsbPicker = () => {
    localStorage.setItem(USB_PICKER_GUIDE_STORAGE_KEY, "1");
    setShowUsbPickerGuide(false);
    void handleVerify();
  };

  const handleConnectClick = () => {
    if (localStorage.getItem(USB_PICKER_GUIDE_STORAGE_KEY) === "1") {
      void handleVerify();
      return;
    }
    setShowUsbPickerGuide(true);
  };

  const refreshAuthorizedDevices = async () => {
    try {
      const devices = await listGrantedAuthorizedDevices();
      setAuthorizedCount(devices.length);
      setCanSilentConnect(devices.length > 0);
    } catch {
      setAuthorizedCount(0);
      setCanSilentConnect(false);
    }
  };

  useEffect(() => {
    void refreshAuthorizedDevices();
  }, []);

  useEffect(() => {
    // Device selection is always user initiated; never connect on page load.
    return;
    if (autoTriedRef.current) return;
    autoTriedRef.current = true;

    let active = true;
    void (async () => {
      try {
        const silentResult = await attemptSilentConnect();
        if (silentResult === "ok") {
          return;
        }
        if (silentResult === "timeout") {
          setError("自动连接超时。请关闭「佳点V1PRO控制工具」和设备控制页，确认设备已插入后点击「同意条款并连接」。");
        }
        await hasGrantedAuthorizedDevice().then((value) => {
          if (active) {
            setCanSilentConnect(value);
          }
        });
      } catch {
        // 等待用户手动点击连接
      } finally {
        if (active) {
          setAutoConnecting(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [attemptSilentConnect]);

  useEffect(() => {
    // Plugging in a device only updates browser state. It must not claim USB.
    return;
    if (!("usb" in navigator)) {
      return;
    }

    const onConnect = () => {
      void (async () => {
        setAutoConnecting(true);
        setError("");
        const silentResult = await attemptSilentConnect();
        if (silentResult === "timeout") {
          setError("自动连接超时。请关闭「佳点V1PRO控制工具」后重试，或点击「同意条款并连接」。");
        }
        if (silentResult !== "ok") {
          setAutoConnecting(false);
        }
      })();
    };

    navigator.usb.addEventListener("connect", onConnect);
    return () => {
      navigator.usb.removeEventListener("connect", onConnect);
    };
  }, [attemptSilentConnect]);

  const busy = loading || autoConnecting;

  return (
    <SitePageShell>
      <div className="mb-4 flex justify-end">
        <ThemeSelector theme={theme} onChange={setTheme} />
      </div>
      <div className="flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center py-4">
        <SitePanel className="w-full max-w-lg text-center sm:p-8">
          <p className="site-accent-text text-xs uppercase tracking-[0.24em]">USB Authentication</p>
          <h1 className="mt-3 text-3xl font-semibold text-slate-900 dark:text-slate-50">请连接设备</h1>
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
            请使用 Edge 或 Chrome。首次使用请选择设备并连接；已授权设备可快速连接，多台设备时请明确选择目标设备。
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            新设备首次进入网站并完成连接后，系统会自动关闭设备的“上电打开网站”，以后插入不会重复弹出。
          </p>

          <SiteButton type="button" className="mt-8 w-full" disabled={busy} onClick={handleConnectClick}>
            {loading ? "连接中..." : authorizedCount > 0 ? `选择并连接设备（已授权 ${authorizedCount} 台）` : "选择设备并连接"}
          </SiteButton>

          {!busy ? (
            <button
              type="button"
              className="mt-3 text-xs font-medium text-violet-600 underline-offset-4 hover:underline dark:text-violet-300"
              onClick={() => setShowUsbPickerGuide(true)}
            >
              不会连接？查看连接步骤
            </button>
          ) : null}

          {canSilentConnect && !autoConnecting ? (
            <p className="mt-3 text-xs text-emerald-600 dark:text-emerald-300">
              已发现 {authorizedCount} 台已授权设备，点击上方按钮后选择要使用的设备。
            </p>
          ) : !autoConnecting ? (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              首次使用需在浏览器弹窗中确认授权；之后可从已授权设备中快速选择。
            </p>
          ) : null}

          <p className="mt-4 text-xs leading-6 text-slate-500 dark:text-slate-400">
            点击连接即表示您已阅读并同意
            <Link to="/terms" className="mx-1 text-violet-600 underline-offset-2 hover:underline dark:text-violet-300">
              {TERMS_TITLE}
            </Link>
            ，承诺不进行爬取、批量下载或未经授权的内容使用。
          </p>

          {error ? <SiteAlert variant="error" className="mt-4">{error}</SiteAlert> : null}
        </SitePanel>
        <div className="mt-8 w-full max-w-lg">
          <SiteFooter />
        </div>
      </div>

      {showUsbPickerGuide ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm"
            aria-label="关闭连接引导"
            onClick={() => setShowUsbPickerGuide(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="usb-picker-guide-title"
            className="relative z-10 w-full max-w-xl overflow-hidden rounded-[2rem] border border-white/60 bg-white p-5 shadow-2xl shadow-slate-950/25 dark:border-white/10 dark:bg-slate-900 sm:p-7"
          >
            <div className="text-center">
              <p className="site-accent-text text-xs font-semibold uppercase tracking-[0.22em]">首次连接指引</p>
              <h2 id="usb-picker-guide-title" className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                浏览器弹窗打开后，只需两步
              </h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                请先点设备，设备高亮后再点右下角“连接”。
              </p>
            </div>

            <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-slate-950/60 sm:p-5">
              <div className="flex items-center gap-3">
                <span className="shrink-0 rounded-full bg-violet-600 px-3 py-1 text-sm font-bold text-white">1</span>
                <span className="font-semibold text-slate-800 dark:text-slate-100">点击设备名称这一行</span>
              </div>
              <div className="my-1 text-center text-6xl font-black leading-none text-violet-500 motion-safe:animate-bounce" aria-hidden="true">
                ↓
              </div>
              <div className="rounded-2xl border-2 border-violet-500 bg-violet-50 px-4 py-4 text-left shadow-lg shadow-violet-500/15 dark:bg-violet-500/10">
                <p className="font-semibold text-slate-900 dark:text-white">佳点V1PRO · 已配对</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  显示“来自 STMicroelectronics 的未知设备”时也点击这一行
                </p>
              </div>

              <div className="mt-5 flex items-center gap-3">
                <span className="shrink-0 rounded-full bg-cyan-600 px-3 py-1 text-sm font-bold text-white">2</span>
                <span className="font-semibold text-slate-800 dark:text-slate-100">再点击右下角“连接”</span>
              </div>
              <div className="mt-1 flex items-end justify-end gap-3">
                <span className="text-6xl font-black leading-none text-cyan-500 motion-safe:animate-pulse" aria-hidden="true">↘</span>
                <span className="rounded-xl bg-blue-600 px-8 py-3 font-semibold text-white shadow-lg shadow-blue-500/25">连接</span>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row">
              <SiteButton type="button" variant="secondary" className="w-full" onClick={() => setShowUsbPickerGuide(false)}>
                暂不连接
              </SiteButton>
              <SiteButton type="button" className="w-full" onClick={openUsbPicker}>
                我知道了，打开设备窗口
              </SiteButton>
            </div>
          </section>
        </div>
      ) : null}
    </SitePageShell>
  );
}
