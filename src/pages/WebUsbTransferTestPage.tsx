import { useEffect, useRef, useState } from "react";
import { SitePageLayout } from "../components/SitePageLayout";
import {
  SiteAlert,
  SiteButton,
  SitePanel,
  SiteSectionTitle,
  SITE_CONTENT_NARROW,
} from "../components/SiteUi";
import { useThemeMode } from "../hooks/useThemeMode";
import {
  createV1ProWebTransferClient,
  isWebUsbSupported,
  loadV1ProWebTransferSdk,
} from "../services/v1proWebTransferClient";
import type { V1ProTransferResult, V1ProWebTransferClient } from "../types/v1proWebTransfer";

type StatusKind = "idle" | "ok" | "error";

function deviceLabel(client: V1ProWebTransferClient | null): string {
  const device = client?.device;
  if (!device) return "";
  const sn = device.serialNumber?.trim() || "无序列号";
  return `${device.productName || "V1PRO"} · SN ${sn}`;
}

function formatError(err: unknown): string {
  if (err && typeof err === "object" && "name" in err && err.name === "V1ProUsbError" && "message" in err) {
    return String(err.message);
  }
  return err instanceof Error ? err.message : String(err);
}

export default function WebUsbTransferTestPage() {
  const { theme, setTheme } = useThemeMode();
  const clientRef = useRef<V1ProWebTransferClient | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sdkReady, setSdkReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [statusText, setStatusText] = useState("未连接");
  const [statusKind, setStatusKind] = useState<StatusKind>("idle");
  const [metaText, setMetaText] = useState("选择图片或短 GIF 后点击「传到设备」。");
  const [progress, setProgress] = useState(0);
  const [lastResult, setLastResult] = useState<V1ProTransferResult | null>(null);

  const webUsbSupported = isWebUsbSupported();

  useEffect(() => {
    let cancelled = false;
    void loadV1ProWebTransferSdk()
      .then(() => {
        if (!cancelled) setSdkReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setStatusText("WebUSB SDK 加载失败，请刷新页面重试。");
          setStatusKind("error");
        }
      });
    return () => {
      cancelled = true;
      void clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, []);

  const refreshConnectionState = () => {
    const client = clientRef.current;
    setConnected(Boolean(client?.connected));
    setBusy(Boolean(client?.busy));
  };

  const handleConnect = async () => {
    if (!webUsbSupported) return;
    setStatusText("正在请求设备…");
    setStatusKind("idle");
    setProgress(0);
    setLastResult(null);
    try {
      if (!clientRef.current) {
        clientRef.current = await createV1ProWebTransferClient();
      }
      await clientRef.current.connect();
      setStatusText(`已连接：${deviceLabel(clientRef.current)}`);
      setStatusKind("ok");
      setMetaText("设备已连接，可选择图片或 GIF。");
    } catch (err) {
      setStatusText(formatError(err));
      setStatusKind("error");
    } finally {
      refreshConnectionState();
    }
  };

  const handleDisconnect = async () => {
    await clientRef.current?.disconnect();
    clientRef.current = null;
    setConnected(false);
    setBusy(false);
    setStatusText("已断开");
    setStatusKind("idle");
    setProgress(0);
  };

  const handleFileChange = (file: File | null) => {
    setSelectedFile(file);
    setLastResult(null);
    if (file) {
      setMetaText(`已选：${file.name}（${(file.size / 1024).toFixed(1)} KB）`);
    } else {
      setMetaText("选择图片或短 GIF 后点击「传到设备」。");
    }
  };

  const handleTransfer = async () => {
    const client = clientRef.current;
    if (!client || !selectedFile) return;

    setStatusText("正在编码并传输…");
    setStatusKind("idle");
    setProgress(0);
    setLastResult(null);
    refreshConnectionState();

    try {
      const result = await client.transferFile(selectedFile, {
        onProgress: (info) => {
          if (info.phase === "encode") {
            setStatusText("正在编码 GFM1…");
            setProgress(5);
            return;
          }
          const ratio = 0.05 + info.ratio * 0.95;
          setStatusText(`正在传输… ${(info.ratio * 100).toFixed(0)}%`);
          setProgress(Math.round(ratio * 100));
        },
      });
      setProgress(100);
      let message = `传输完成：${result.bytes} 字节，${result.frameCount} 帧`;
      if (result.note) {
        message += `（${result.note}）`;
      }
      setStatusText(message);
      setStatusKind("ok");
      setMetaText("设备应已开始播放。可继续选择其他素材。");
      setLastResult(result);
    } catch (err) {
      setStatusText(formatError(err));
      setStatusKind("error");
      setProgress(0);
    } finally {
      refreshConnectionState();
    }
  };

  const statusClass =
    statusKind === "ok"
      ? "text-emerald-600 dark:text-emerald-300"
      : statusKind === "error"
        ? "text-rose-600 dark:text-rose-300"
        : "text-slate-600 dark:text-slate-300";

  return (
    <SitePageLayout
      subtitle="WebUSB 网页直传 · 测试页"
      theme={theme}
      onSetTheme={setTheme}
      contentClassName={SITE_CONTENT_NARROW}
    >
      {!webUsbSupported ? (
        <SiteAlert variant="error">当前浏览器不支持 WebUSB，请使用 Chrome 或 Edge 桌面版。</SiteAlert>
      ) : null}

      <SitePanel>
        <SiteSectionTitle title="网页直传测试" />

        <div className={`mt-4 min-h-[1.4em] text-sm font-medium ${statusClass}`}>{statusText}</div>

        <div className="mt-3 h-2.5 overflow-hidden rounded-full border border-white/30 bg-slate-900/10 dark:border-white/10 dark:bg-slate-950/60">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-500 transition-[width] duration-150"
            style={{ width: `${progress}%` }}
            aria-hidden="true"
          />
        </div>

        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{metaText}</p>

        {lastResult?.note ? (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-200">提示：{lastResult.note}</p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <SiteButton
            type="button"
            onClick={() => void handleConnect()}
            disabled={!webUsbSupported || !sdkReady || connected || busy}
          >
            连接设备
          </SiteButton>
          <SiteButton
            type="button"
            variant="secondary"
            onClick={() => void handleDisconnect()}
            disabled={!connected || busy}
          >
            断开
          </SiteButton>
          <SiteButton
            type="button"
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={!connected || busy}
          >
            选择图片 / GIF
          </SiteButton>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              handleFileChange(file);
            }}
          />
          <SiteButton
            type="button"
            onClick={() => void handleTransfer()}
            disabled={!connected || !selectedFile || busy}
          >
            {busy ? "传输中…" : "传到设备"}
          </SiteButton>
        </div>
      </SitePanel>
    </SitePageLayout>
  );
}
