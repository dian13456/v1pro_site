import { useCallback, useEffect, useRef, useState } from "react";
import { WebUsbDropZone } from "../components/WebUsbDropZone";
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
  listAuthorizedV1ProDevices,
  loadV1ProWebTransferSdk,
  WEBUSB_TRANSFER_VERSION,
} from "../services/v1proWebTransferClient";
import { getCustomDisplayName } from "../services/welcomeService";
import type { V1ProTransferResult, V1ProWebTransferClient } from "../types/v1proWebTransfer";

type StatusKind = "idle" | "ok" | "error";

function deviceKey(device: USBDevice): string {
  return `${device.vendorId}:${device.productId}:${device.serialNumber || "no-sn"}`;
}

function usbDeviceLabel(device: USBDevice): string {
  const namedDevice = device as USBDevice & { productName?: string };
  const sn = device.serialNumber?.trim() || "";
  const nickname = getCustomDisplayName(sn);
  return `${nickname || namedDevice.productName || "V1PRO"} · SN ${sn || "无序列号"}`;
}

function deviceLabel(client: V1ProWebTransferClient | null): string {
  const device = client?.device;
  if (!device) return "";
  const sn = device.serialNumber?.trim() || "无序列号";
  const nickname = getCustomDisplayName(device.serialNumber?.trim() || "");
  return `${nickname || device.productName || "V1PRO"} · SN ${sn}`;
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
  const transferLockRef = useRef(false);

  const [sdkReady, setSdkReady] = useState(false);
  const [sdkVersion, setSdkVersion] = useState(WEBUSB_TRANSFER_VERSION);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [statusText, setStatusText] = useState("未连接");
  const [statusKind, setStatusKind] = useState<StatusKind>("idle");
  const [metaText, setMetaText] = useState("连接设备后，将图片、GIF 或短视频拖入下方区域即可自动传输。");
  const [progress, setProgress] = useState(0);
  const [lastResult, setLastResult] = useState<V1ProTransferResult | null>(null);
  const [authorizedDevices, setAuthorizedDevices] = useState<USBDevice[]>([]);
  const [selectedDeviceKey, setSelectedDeviceKey] = useState("");

  const webUsbSupported = isWebUsbSupported();

  const refreshAuthorizedDevices = useCallback(async () => {
    if (!webUsbSupported) return;
    const devices = await listAuthorizedV1ProDevices();
    setAuthorizedDevices(devices);
    setSelectedDeviceKey((current) => {
      if (devices.some((device) => deviceKey(device) === current)) return current;
      return "";
    });
  }, [webUsbSupported]);

  useEffect(() => {
    let cancelled = false;
    void loadV1ProWebTransferSdk()
      .then((mod) => {
        if (!cancelled) {
          setSdkReady(true);
          if (mod.WEBUSB_TRANSFER_VERSION) {
            setSdkVersion(mod.WEBUSB_TRANSFER_VERSION);
          }
          void refreshAuthorizedDevices();
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const detail = formatError(err);
          setStatusText(
            detail && detail !== "[object Object]"
              ? `WebUSB SDK 加载失败：${detail}`
              : "WebUSB SDK 加载失败，请强制刷新（Ctrl+Shift+R）后重试。",
          );
          setStatusKind("error");
        }
      });
    return () => {
      cancelled = true;
      void clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, [refreshAuthorizedDevices]);

  useEffect(() => {
    if (!webUsbSupported) return;
    const refresh = () => void refreshAuthorizedDevices();
    navigator.usb.addEventListener("connect", refresh);
    navigator.usb.addEventListener("disconnect", refresh);
    return () => {
      navigator.usb.removeEventListener("connect", refresh);
      navigator.usb.removeEventListener("disconnect", refresh);
    };
  }, [refreshAuthorizedDevices, webUsbSupported]);

  const refreshConnectionState = useCallback(() => {
    const client = clientRef.current;
    setConnected(Boolean(client?.connected));
    setBusy(Boolean(client?.busy));
  }, []);

  const ensureClient = useCallback(async (): Promise<V1ProWebTransferClient> => {
    if (!clientRef.current) {
      clientRef.current = await createV1ProWebTransferClient();
    }
    return clientRef.current;
  }, []);

  const handleConnect = async () => {
    if (!webUsbSupported) return;
    setStatusText("正在请求设备…");
    setStatusKind("idle");
    setProgress(0);
    setLastResult(null);
    try {
      const client = await ensureClient();
      const selectedDevice = authorizedDevices.find(
        (device) => deviceKey(device) === selectedDeviceKey,
      );
      await client.connect(selectedDevice ? { device: selectedDevice } : undefined);
      if (client.device) {
        setSelectedDeviceKey(deviceKey(client.device as USBDevice));
      }
      await refreshAuthorizedDevices();
      setStatusText(`已连接：${deviceLabel(client)}`);
      setStatusKind("ok");
      const capacityLabel = client.getCapacityLabel?.() ?? "";
      setMetaText(
        capacityLabel
          ? `设备容量 ${capacityLabel}。将图片、GIF 或视频拖入下方区域即可自动传输（视频最高 30fps，必要时自动倍速）。`
          : "设备已连接，将图片、GIF 或视频拖入下方区域即可自动传输。",
      );
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
    setMetaText("连接设备后，将图片、GIF 或短视频拖入下方区域即可自动传输。");
  };

  const handleReadCapacity = async () => {
    if (!webUsbSupported || !sdkReady || busy) return;
    setStatusKind("idle");
    setProgress(0);
    setLastResult(null);
    try {
      const client = await ensureClient();
      if (!client.connected) {
        setStatusText("正在连接设备…");
        await client.connect();
      }
      setStatusText("正在读取设备容量（JEDEC）…");
      refreshConnectionState();
      const capacity = await client.refreshDeviceCapacity();
      if (!capacity) {
        const detail = client.capacityError || "设备未返回 JED 容量应答";
        setStatusText(`读取容量失败：${detail}`);
        setStatusKind("error");
        setMetaText("可再次点击「读取容量」重试，或断开后重新连接。");
        return;
      }
      const label = client.getCapacityLabel?.() || `${capacity.maxFrames}帧`;
      setStatusText(`容量读取成功：${label}`);
      setStatusKind("ok");
      setMetaText(label);
    } catch (err) {
      setStatusText(formatError(err));
      setStatusKind("error");
    } finally {
      refreshConnectionState();
    }
  };

  const runTransfer = useCallback(
    async (file: File, options: { connectIfNeeded?: boolean } = {}) => {
      if (!webUsbSupported || !sdkReady || transferLockRef.current) return;
      transferLockRef.current = true;
      setSelectedFile(file);
      setLastResult(null);
      setMetaText(`已选：${file.name}（${(file.size / 1024).toFixed(1)} KB）`);
      setStatusText("正在准备传输…");
      setStatusKind("idle");
      setProgress(0);

      try {
        const client = await ensureClient();
        if (!client.connected) {
          if (!options.connectIfNeeded) {
            setStatusText("请先连接设备");
            setStatusKind("error");
            return;
          }
          setStatusText("正在连接设备…");
          const selectedDevice = authorizedDevices.find(
            (device) => deviceKey(device) === selectedDeviceKey,
          );
          if (!selectedDevice) {
            setStatusText("请先从设备列表中选择要传输的 V1PRO（SN）");
            setStatusKind("error");
            return;
          }
          await client.connect({ device: selectedDevice });
          setStatusText(`已连接：${deviceLabel(client)}`);
          setStatusKind("ok");
          const capacityLabel = client.getCapacityLabel?.() ?? "";
          if (capacityLabel) {
            setMetaText(`设备容量 ${capacityLabel}`);
          }
        }

        setStatusText("正在编码并传输…");
        refreshConnectionState();

        const result = await client.transferFile(file, {
          pingFirst: !client.connected || !client.deviceCapacity,
          onProgress: (info) => {
            if (info.note && info.sent === 0) {
              setStatusText(info.note);
              return;
            }
            if (info.phase === "encode" && info.frameCount && info.sent < info.frameCount) {
              setStatusText(`正在编码… ${info.sent}/${info.frameCount} 帧`);
              setProgress(Math.max(5, Math.round((info.sent / info.frameCount) * 12)));
              return;
            }
            const ratio = 0.12 + info.ratio * 0.88;
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
        setMetaText("设备应已开始播放。可继续拖入其他素材。");
        setLastResult(result);
      } catch (err) {
        setStatusText(formatError(err));
        setStatusKind("error");
        setProgress(0);
      } finally {
        // Always release the interface and close the USBDevice so the desktop
        // V1PRO GUI can claim it immediately after this transfer attempt.
        const client = clientRef.current;
        clientRef.current = null;
        await client?.disconnect();
        transferLockRef.current = false;
        setConnected(false);
        setBusy(false);
        void refreshAuthorizedDevices();
      }
    },
    [
      authorizedDevices,
      ensureClient,
      refreshAuthorizedDevices,
      refreshConnectionState,
      sdkReady,
      selectedDeviceKey,
      webUsbSupported,
    ],
  );

  const handleIncomingFile = (file: File) => {
    void runTransfer(file, { connectIfNeeded: true });
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
        <SiteSectionTitle
          title="网页直传测试"
          action={
            <span className="rounded-full border border-violet-200/70 bg-violet-50/80 px-3 py-1 text-xs font-medium text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200">
              v{sdkVersion}
            </span>
          }
        />

        <div className={`mt-4 min-h-[1.4em] text-sm font-medium ${statusClass}`}>{statusText}</div>

        <div className="mt-3 h-2.5 overflow-hidden rounded-full border border-white/30 bg-slate-900/10 dark:border-white/10 dark:bg-slate-950/60">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-500 transition-[width] duration-150"
            style={{ width: `${progress}%` }}
            aria-hidden="true"
          />
        </div>

        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{metaText}</p>

        <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-200">
          选择 V1PRO 设备（按 SN）
          <select
            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            value={selectedDeviceKey}
            disabled={busy || connected}
            onChange={(event) => setSelectedDeviceKey(event.target.value)}
          >
            {authorizedDevices.length === 0 ? (
              <option value="">尚无已授权设备，请点击连接设备授权</option>
            ) : null}
            {authorizedDevices.map((device) => (
              <option key={deviceKey(device)} value={deviceKey(device)}>
                {usbDeviceLabel(device)}
              </option>
            ))}
          </select>
        </label>

        {lastResult?.note ? (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-200">提示：{lastResult.note}</p>
        ) : null}

        <WebUsbDropZone
          disabled={!webUsbSupported || !sdkReady || !selectedDeviceKey}
          busy={busy}
          connected={connected}
          selectedFileName={selectedFile?.name ?? null}
          onFile={handleIncomingFile}
          onInvalidFile={() => {
            setStatusText("仅支持 PNG、JPG、WebP、GIF 或 H.264 MP4 短视频（≤10 秒）");
            setStatusKind("error");
          }}
        />

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
            onClick={() => void handleReadCapacity()}
            disabled={!webUsbSupported || !sdkReady || busy}
          >
            读取容量
          </SiteButton>
          <SiteButton
            type="button"
            variant="secondary"
            onClick={() => void handleDisconnect()}
            disabled={!connected || busy}
          >
            断开
          </SiteButton>
          {selectedFile && connected && !busy ? (
            <SiteButton type="button" variant="secondary" onClick={() => void runTransfer(selectedFile)}>
              重新传输当前文件
            </SiteButton>
          ) : null}
        </div>
      </SitePanel>
    </SitePageLayout>
  );
}
