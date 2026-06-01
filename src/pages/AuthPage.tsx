import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { SiteFooter } from "../components/SiteFooter";
import { TERMS_TITLE } from "../content/termsOfUse";
import {
  DEVICE_MISMATCH_MESSAGE,
  hasGrantedAuthorizedDevice,
  requestUsbAndAuthorize,
  tryAuthorizeGrantedDevice,
} from "../services/authService";
import { acceptTerms } from "../services/termsService";

export default function AuthPage() {
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
    [navigate, redirectTarget]
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
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-950 px-4 py-8">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(56,189,248,0.28),transparent_45%),radial-gradient(circle_at_80%_22%,rgba(59,130,246,0.25),transparent_42%),radial-gradient(circle_at_70%_80%,rgba(168,85,247,0.2),transparent_40%)]" />
      <div className="relative w-full max-w-lg rounded-3xl border border-white/20 bg-white/8 p-8 text-center shadow-2xl backdrop-blur-xl">
        <p className="text-xs uppercase tracking-[0.28em] text-cyan-300">USB Authentication</p>
        <h1 className="mt-3 text-3xl font-semibold text-white">请连接设备</h1>
        <p className="mt-3 text-sm text-slate-200">
          请使用 Edge 或 Chrome。系统会自动识别佳点授权设备；已授权过的设备无需手动选择，插入即可进入。
        </p>

        <button
          type="button"
          onClick={() => void handleVerify()}
          disabled={busy}
          className="mt-8 w-full rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-900 transition hover:bg-slate-200 disabled:opacity-60"
        >
          {autoConnecting ? "正在自动连接设备…" : loading ? "连接中..." : "同意条款并连接"}
        </button>

        {!canSilentConnect && !autoConnecting ? (
          <p className="mt-3 text-xs text-slate-400">
            首次使用需在浏览器弹窗中确认一次授权，之后将自动连接，无需再手动选择。
          </p>
        ) : null}

        <p className="mt-4 text-xs leading-6 text-slate-400">
          点击连接即表示您已阅读并同意
          <Link to="/terms" className="mx-1 text-violet-300 underline-offset-2 hover:underline">
            {TERMS_TITLE}
          </Link>
          ，承诺不进行爬取、批量下载或未经授权的内容使用。
        </p>

        {error ? <p className="mt-4 text-sm text-rose-300">{error}</p> : null}
      </div>
      <div className="relative mt-8 w-full max-w-lg text-slate-400 [&_a]:text-violet-300">
        <SiteFooter />
      </div>
    </div>
  );
}
