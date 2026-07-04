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
  requestUsbAndAuthorize,
  tryAuthorizeGrantedDevice,
} from "../services/authService";
import { acceptTerms } from "../services/termsService";

export default function AuthPage() {
  const { theme, setTheme } = useThemeMode();
  const [loading, setLoading] = useState(false);
  const [autoConnecting, setAutoConnecting] = useState(true);
  const [canSilentConnect, setCanSilentConnect] = useState(false);
  const [error, setError] = useState("");
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

  const attemptSilentConnect = useCallback(async (): Promise<boolean> => {
    const state = await tryAuthorizeGrantedDevice();
    if (!state) {
      return false;
    }
    finishAuth(state.serial);
    return true;
  }, [finishAuth]);

  const handleVerify = async () => {
    try {
      setLoading(true);
      setError("");

      const silent = await attemptSilentConnect();
      if (silent) {
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

  useEffect(() => {
    if (autoTriedRef.current) return;
    autoTriedRef.current = true;

    let active = true;
    void (async () => {
      try {
        const [connected] = await Promise.all([
          attemptSilentConnect(),
          hasGrantedAuthorizedDevice().then((value) => {
            if (active) {
              setCanSilentConnect(value);
            }
          }),
        ]);
        if (connected) {
          return;
        }
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
    if (!("usb" in navigator)) {
      return;
    }

    const onConnect = () => {
      void (async () => {
        setAutoConnecting(true);
        setError("");
        const connected = await attemptSilentConnect();
        if (!connected) {
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
            请使用 Edge 或 Chrome。系统会自动识别佳点授权设备；已授权过的设备无需手动选择，插入即可进入。
          </p>

          <SiteButton type="button" className="mt-8 w-full" disabled={busy} onClick={() => void handleVerify()}>
            {autoConnecting ? "正在自动连接设备…" : loading ? "连接中..." : "同意条款并连接"}
          </SiteButton>

          {!canSilentConnect && !autoConnecting ? (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              首次使用需在浏览器弹窗中确认一次授权，之后将自动连接，无需再手动选择。
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
    </SitePageShell>
  );
}
