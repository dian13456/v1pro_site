import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { WebUsbDropZone } from "../components/WebUsbDropZone";
import { ResourceLibraryHeader } from "../components/ResourceLibraryHeader";
import { SiteFooter } from "../components/SiteFooter";
import {
  createV1ProWebTransferClient,
  isWebUsbSupported,
  listAuthorizedV1ProDevices,
  loadV1ProWebTransferSdk,
  WEBUSB_TRANSFER_VERSION,
} from "../services/v1proWebTransferClient";
import { convertBrowserRasterWithFfmpeg } from "../services/browserFfmpegVideoService";
import { getCustomDisplayName } from "../services/welcomeService";
import type {
  V1ProDisplayStatus,
  V1ProTransferResult,
  V1ProWebTransferClient,
} from "../types/v1proWebTransfer";

type StatusKind = "idle" | "ok" | "error";

function deviceKey(device: USBDevice): string {
  return `${device.vendorId}:${device.productId}:${device.serialNumber || "no-sn"}`;
}

function displayUsbProductName(productName?: string | null): string {
  const name = productName?.trim() || "";
  return !name || /^paired(?:\s+device)?$/i.test(name) ? "V1PRO" : name;
}

function usbDeviceLabel(device: USBDevice): string {
  const namedDevice = device as USBDevice & { productName?: string };
  const sn = device.serialNumber?.trim() || "";
  const nickname = getCustomDisplayName(sn);
  return `${nickname || displayUsbProductName(namedDevice.productName)} · SN ${sn || "无序列号"}`;
}

function deviceLabel(client: V1ProWebTransferClient | null): string {
  const device = client?.device;
  if (!device) return "";
  const sn = device.serialNumber?.trim() || "无序列号";
  const nickname = getCustomDisplayName(device.serialNumber?.trim() || "");
  return `${nickname || displayUsbProductName(device.productName)} · SN ${sn}`;
}

function formatError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/claimInterface|claim interface|Unable to claim|LIBUSB_ERROR_BUSY|USB.*(?:busy|claimed|占用)/i.test(message)) {
    return "USB 接口被本地软件占用，请关闭本地软件后重试！";
  }
  if (err && typeof err === "object" && "name" in err && err.name === "V1ProUsbError" && "message" in err) {
    return String(err.message);
  }
  return message;
}

function rasterMediaType(file: File): "image" | "gif" | null {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (type === "image/gif" || name.endsWith(".gif")) return "gif";
  if (type.startsWith("image/")) return "image";
  return null;
}

export default function WebUsbTransferTestPage() {
  const navigate = useNavigate();
  const clientRef = useRef<V1ProWebTransferClient | null>(null);
  const transferLockRef = useRef(false);
  const displayControlLockRef = useRef(false);
  const brightnessTimerRef = useRef<number | null>(null);

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
  const [displayControlBusy, setDisplayControlBusy] = useState(false);
  const [displayControlSupported, setDisplayControlSupported] = useState<boolean | null>(null);
  const [displayControlMessage, setDisplayControlMessage] = useState("连接设备后自动读取当前显示设置。");
  const [brightnessPercent, setBrightnessPercent] = useState(50);
  const [screenOff, setScreenOff] = useState(false);
  const [screenRotation, setScreenRotation] = useState<0 | 2>(2);
  const [followScreenOff, setFollowScreenOffState] = useState(false);

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
      if (brightnessTimerRef.current !== null) {
        window.clearTimeout(brightnessTimerRef.current);
        brightnessTimerRef.current = null;
      }
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

  const applyDisplayStatus = useCallback((status: V1ProDisplayStatus) => {
    const percent = Math.round((Math.max(0, Math.min(255, status.brightness)) * 100) / 255);
    setBrightnessPercent(percent);
    setScreenOff(status.screenOff);
    setScreenRotation(status.rotation === 0 ? 0 : 2);
    setFollowScreenOffState(status.followScreenOff);
    setDisplayControlSupported(true);
    setDisplayControlMessage(
      `已同步：亮度 ${percent}% · ${status.rotation === 0 ? "0°" : "180°"} · 跟随熄屏${status.followScreenOff ? "已开启" : "已关闭"}`,
    );
  }, []);

  const syncDisplayStatus = useCallback(async (client: V1ProWebTransferClient) => {
    setDisplayControlMessage("正在读取设备显示设置…");
    try {
      applyDisplayStatus(await client.getDisplayStatus());
    } catch (err) {
      setDisplayControlSupported(false);
      setDisplayControlMessage(formatError(err));
    }
  }, [applyDisplayStatus]);

  const runDisplayControl = useCallback(async (
    action: (client: V1ProWebTransferClient) => Promise<void>,
    successMessage: string,
  ) => {
    const client = clientRef.current;
    if (!client?.connected) {
      setDisplayControlMessage("请先连接设备后再调整显示设置。");
      return;
    }
    if (displayControlLockRef.current || transferLockRef.current) return;
    displayControlLockRef.current = true;
    setDisplayControlBusy(true);
    setDisplayControlMessage("正在写入设备设置…");
    try {
      await action(client);
      setDisplayControlSupported(true);
      setDisplayControlMessage(successMessage);
    } catch (err) {
      setDisplayControlMessage(formatError(err));
    } finally {
      displayControlLockRef.current = false;
      setDisplayControlBusy(false);
      refreshConnectionState();
    }
  }, [refreshConnectionState]);

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
      await syncDisplayStatus(client);
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
    if (brightnessTimerRef.current !== null) {
      window.clearTimeout(brightnessTimerRef.current);
      brightnessTimerRef.current = null;
    }
    await clientRef.current?.disconnect();
    clientRef.current = null;
    setConnected(false);
    setBusy(false);
    setStatusText("已断开");
    setStatusKind("idle");
    setProgress(0);
    setDisplayControlSupported(null);
    setDisplayControlMessage("连接设备后自动读取当前显示设置。");
    setMetaText("连接设备后，将图片、GIF 或短视频拖入下方区域即可自动传输。");
  };

  const handleReadCapacity = async () => {
    if (!webUsbSupported || !sdkReady || busy || displayControlLockRef.current) return;
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

  const handleRefreshDisplayStatus = async () => {
    const client = clientRef.current;
    if (!client?.connected || displayControlLockRef.current || transferLockRef.current) return;
    displayControlLockRef.current = true;
    setDisplayControlBusy(true);
    try {
      await syncDisplayStatus(client);
    } finally {
      displayControlLockRef.current = false;
      setDisplayControlBusy(false);
      refreshConnectionState();
    }
  };

  const handleBrightnessChange = (nextPercent: number) => {
    const percent = Math.max(0, Math.min(100, Math.round(nextPercent)));
    setBrightnessPercent(percent);
    if (brightnessTimerRef.current !== null) {
      window.clearTimeout(brightnessTimerRef.current);
    }
    brightnessTimerRef.current = window.setTimeout(() => {
      brightnessTimerRef.current = null;
      const deviceLevel = Math.round((percent * 255) / 100);
      void runDisplayControl(async (client) => {
        const acknowledged = await client.setDisplayBrightness(deviceLevel);
        const actualPercent = Math.round((acknowledged * 100) / 255);
        setBrightnessPercent(actualPercent);
        setScreenOff(acknowledged === 0);
      }, percent === 0 ? "屏幕已关闭；向右拖动亮度滑块可重新点亮。" : `亮度已设置为 ${percent}%。`);
    }, 220);
  };

  const handleRotationChange = (rotation: 0 | 2) => {
    void runDisplayControl(async (client) => {
      const acknowledged = await client.setDisplayRotation(rotation);
      setScreenRotation(acknowledged === 0 ? 0 : 2);
    }, `屏幕方向已切换为 ${rotation === 0 ? "0°" : "180°"}。`);
  };

  const handleFollowScreenOffChange = () => {
    const enabled = !followScreenOff;
    void runDisplayControl(async (client) => {
      setFollowScreenOffState(await client.setFollowScreenOff(enabled));
    }, `跟随熄屏已${enabled ? "开启" : "关闭"}。`);
  };

  const runTransfer = useCallback(
    async (file: File, options: { connectIfNeeded?: boolean } = {}) => {
      if (!webUsbSupported || !sdkReady || transferLockRef.current || displayControlLockRef.current) return;
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

        const selectedRasterType = rasterMediaType(file);
        let transferSource: Blob = file;
        let preparedRaster: {
          mediaType: "image" | "gif";
          maxFrames: number;
          frameCount: number;
          note: string;
        } | null = null;
        if (selectedRasterType) {
          const capacity = client.deviceCapacity ?? await client.refreshDeviceCapacity();
          if (!capacity?.maxFrames) {
            throw new Error("无法读取设备容量，请重新连接设备后重试");
          }
          const converted = await convertBrowserRasterWithFfmpeg(file, {
            fileName: file.name,
            mediaType: selectedRasterType,
            maxFrames: capacity.maxFrames,
            fitMode: "contain",
            colorProfile: "normal",
            onStatus: setStatusText,
            onProgress: (ratio) => setProgress(Math.round(ratio * 25)),
          });
          transferSource = converted.blob;
          preparedRaster = {
            mediaType: selectedRasterType,
            maxFrames: capacity.maxFrames,
            frameCount: converted.frameCount,
            note: converted.note,
          };
        }

        const result = await client.transferFile(transferSource, {
          fileName: file.name,
          mediaType: preparedRaster?.mediaType,
          maxFrames: preparedRaster?.maxFrames,
          prebuiltGfm1: preparedRaster ? {
            frameCount: preparedRaster.frameCount,
            note: preparedRaster.note,
          } : undefined,
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
            const ratio = preparedRaster
              ? 0.25 + info.ratio * 0.75
              : 0.12 + info.ratio * 0.88;
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
      ? "border-[#ccefe0] bg-[#effbf6] text-[#29966b]"
      : statusKind === "error"
        ? "border-[#ffd8d5] bg-[#fff4f3] text-[#dc5d55]"
        : "border-[#e6e9f2] bg-[#fafbfe] text-[#6f7890]";
  const displayControlsDisabled =
    !connected || busy || displayControlBusy || displayControlSupported === false;

  return (
    <div className="site-page-shell resource-library-shell min-h-screen text-[#2b3245]">
      <ResourceLibraryHeader keyword="" onSearch={(value) => navigate(value ? `/?q=${encodeURIComponent(value)}` : "/")} />
      <main className="mx-auto max-w-[1120px] space-y-[14px] px-4 py-6 sm:px-6">
        <section className="overflow-hidden rounded-[18px] border border-[#e6e9f2] bg-white shadow-[0_10px_30px_rgba(43,50,69,.06)]">
          <div className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-5 py-6 sm:px-8">
            <div className="grid h-16 w-16 place-items-center rounded-[20px] bg-gradient-to-br from-[#ff8a5c] to-[#7c6cf0] text-3xl text-white shadow-[0_8px_20px_rgba(124,108,240,.24)]">⚙</div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#ff8a5c]">WebUSB Device Control</p>
              <h1 className="mt-1 text-2xl font-extrabold">设备控制</h1>
            </div>
            <div className="col-start-3 row-start-1 rounded-[16px] bg-[#f0edff] px-4 py-3 text-center sm:row-span-2 sm:px-6">
              <p className="text-[11px] font-semibold text-[#8a93a8]">控制组件</p>
              <p className="mt-0.5 text-sm font-extrabold text-[#7c6cf0]">v{sdkVersion}</p>
            </div>
            <p className="col-span-3 max-w-2xl text-[13px] leading-6 text-[#8a93a8] sm:col-span-1 sm:col-start-2">选择指定 SN 的 V1PRO，调节屏幕亮度、方向和跟随熄屏，也可将图片、GIF 或短视频直接传输到设备。</p>
          </div>
        </section>

        {!webUsbSupported ? (
          <div className="rounded-[14px] border border-[#ffd8d5] bg-[#fff4f3] px-5 py-4 text-sm text-[#dc5d55]">当前浏览器不支持 WebUSB，请使用 Chrome 或 Edge 桌面版。</div>
        ) : null}

        <div className="grid items-stretch gap-[14px] lg:grid-cols-2">
          <section className="rounded-[18px] border border-[#e6e9f2] bg-white p-5 shadow-[0_8px_24px_rgba(43,50,69,.04)] sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[#fff4e8] text-sm font-extrabold text-[#ff8a5c]">1</span>
              <div>
                <h2 className="text-[17px] font-extrabold">选择并连接设备</h2>
                <p className="mt-1 text-xs text-[#8a93a8]">从浏览器已授权设备中选择对应 SN</p>
              </div>
            </div>

            <label className="mt-5 block text-[12px] font-semibold text-[#4a5270]">
              V1PRO 设备（按 SN）
              <select
                className="mt-2 w-full rounded-[10px] border border-[#e6e9f2] bg-[#fafbfe] px-3 py-2.5 text-[13px] outline-none transition focus:border-[#ff8a5c] disabled:opacity-60"
                value={selectedDeviceKey}
                disabled={busy || connected}
                onChange={(event) => setSelectedDeviceKey(event.target.value)}
              >
                {authorizedDevices.length === 0 ? <option value="">尚无已授权设备，请点击连接设备授权</option> : null}
                {authorizedDevices.map((device) => (
                  <option key={deviceKey(device)} value={deviceKey(device)}>{usbDeviceLabel(device)}</option>
                ))}
              </select>
            </label>

            <div className={`mt-4 rounded-[12px] border px-4 py-3 text-[13px] font-semibold ${statusClass}`}>{statusText}</div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#eef0f6]">
              <div className="h-full rounded-full bg-gradient-to-r from-[#ff8a5c] via-[#ff6f9c] to-[#7c6cf0] transition-[width] duration-150" style={{ width: `${progress}%` }} aria-hidden="true" />
            </div>
            <p className="mt-3 min-h-[3rem] text-[12px] leading-6 text-[#8a93a8]">{metaText}</p>
            {lastResult?.note ? <p className="mt-2 text-xs text-amber-600">提示：{lastResult.note}</p> : null}

            <div className="mt-5 flex flex-wrap gap-2.5">
              <button type="button" onClick={() => void handleConnect()} disabled={!webUsbSupported || !sdkReady || connected || busy || displayControlBusy} className="rounded-full bg-gradient-to-br from-[#ff8a5c] to-[#ff6f9c] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(255,138,92,.25)] disabled:cursor-not-allowed disabled:opacity-50">连接设备</button>
              <button type="button" onClick={() => void handleReadCapacity()} disabled={!webUsbSupported || !sdkReady || busy || displayControlBusy} className="rounded-full border border-[#e6e9f2] bg-white px-5 py-2.5 text-[13px] font-semibold text-[#4a5270] transition hover:border-[#7c6cf0] hover:text-[#7c6cf0] disabled:cursor-not-allowed disabled:opacity-50">读取容量</button>
              <button type="button" onClick={() => void handleDisconnect()} disabled={!connected || busy || displayControlBusy} className="rounded-full border border-[#e6e9f2] bg-white px-5 py-2.5 text-[13px] font-semibold text-[#4a5270] transition hover:border-[#ef6b62] hover:text-[#ef6b62] disabled:cursor-not-allowed disabled:opacity-50">断开</button>
              {selectedFile && connected && !busy && !displayControlBusy ? <button type="button" onClick={() => void runTransfer(selectedFile)} className="rounded-full bg-[#32b879] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(50,184,121,.24)] transition hover:bg-[#299f69]">重新传输当前文件</button> : null}
            </div>
          </section>

          <section className="rounded-[18px] border border-[#e6e9f2] bg-white p-5 shadow-[0_8px_24px_rgba(43,50,69,.04)] sm:p-6">
            <div className="flex items-start gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[#f0edff] text-sm font-extrabold text-[#7c6cf0]">2</span>
              <div>
                <h2 className="text-[17px] font-extrabold">屏幕显示控制</h2>
                <p className="mt-1 text-xs text-[#8a93a8]">设置会写入当前连接设备并由设备保存</p>
              </div>
            </div>

            <div className="mt-5 rounded-[14px] border border-[#e6e9f2] bg-[#fafbfe] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[12.5px] font-bold text-[#4a5270]">屏幕亮度</p>
                  <p className="mt-1 text-[11px] text-[#8a93a8]">0% 为关闭屏幕，拖动停止后写入</p>
                </div>
                <span className={`rounded-full px-3 py-1 text-sm font-extrabold ${screenOff ? "bg-slate-200 text-slate-600" : "bg-amber-100 text-amber-700"}`}>
                  {screenOff ? "已熄屏" : `${brightnessPercent}%`}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={brightnessPercent}
                disabled={displayControlsDisabled}
                onChange={(event) => handleBrightnessChange(Number(event.target.value))}
                className="mt-4 h-2 w-full cursor-pointer accent-[#ff8a5c] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="屏幕亮度"
              />
              <div className="mt-1 flex justify-between text-[10px] text-[#9aa2b7]"><span>熄屏</span><span>100%</span></div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[14px] border border-[#e6e9f2] bg-[#fafbfe] p-4">
                <p className="text-[12.5px] font-bold text-[#4a5270]">屏幕旋转</p>
                <p className="mt-1 text-[11px] text-[#8a93a8]">切换设备横屏朝向</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {([0, 2] as const).map((rotation) => {
                    const active = screenRotation === rotation;
                    const label = rotation === 0 ? "0°" : "180°";
                    return (
                      <button
                        key={rotation}
                        type="button"
                        disabled={displayControlsDisabled}
                        onClick={() => handleRotationChange(rotation)}
                        className={`rounded-[10px] border px-3 py-2 text-[12px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${active ? "border-[#7c6cf0] bg-[#f0edff] text-[#7c6cf0]" : "border-[#e1e5ef] bg-white text-[#69728a] hover:border-[#7c6cf0]"}`}
                      >
                        ↻ {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[14px] border border-[#e6e9f2] bg-[#fafbfe] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[12.5px] font-bold text-[#4a5270]">跟随熄屏</p>
                    <p className="mt-1 text-[11px] leading-5 text-[#8a93a8]">电脑 USB 挂起时熄屏，恢复后自动点亮</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={followScreenOff}
                    aria-label="跟随熄屏"
                    disabled={displayControlsDisabled}
                    onClick={handleFollowScreenOffChange}
                    className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${followScreenOff ? "bg-[#32b879]" : "bg-[#cfd5e2]"}`}
                  >
                    <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${followScreenOff ? "translate-x-5" : "translate-x-0"}`} />
                  </button>
                </div>
                <p className={`mt-3 text-[11px] font-semibold ${followScreenOff ? "text-[#29966b]" : "text-[#8a93a8]"}`}>
                  当前：{followScreenOff ? "已开启" : "已关闭"}
                </p>
              </div>
            </div>

            <div className={`mt-3 rounded-[12px] border px-4 py-3 text-[12px] leading-5 ${displayControlSupported === false ? "border-[#ffd8d5] bg-[#fff4f3] text-[#dc5d55]" : "border-[#dce6fb] bg-[#f5f8ff] text-[#66708d]"}`}>
              {displayControlMessage}
            </div>
            <button
              type="button"
              disabled={!connected || busy || displayControlBusy}
              onClick={() => void handleRefreshDisplayStatus()}
              className="mt-3 text-[11.5px] font-semibold text-[#7c6cf0] hover:underline disabled:cursor-not-allowed disabled:opacity-40"
            >
              {displayControlBusy ? "正在同步…" : "重新读取设备设置"}
            </button>
          </section>

          <section className="flex flex-col rounded-[18px] border border-[#e6e9f2] bg-white p-5 shadow-[0_8px_24px_rgba(43,50,69,.04)] sm:p-6 lg:col-span-2">
            <div className="flex items-start gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-[#e8f8f0] text-sm font-extrabold text-[#32b879]">3</span>
              <div>
                <h2 className="text-[17px] font-extrabold">选择传输素材</h2>
                <p className="mt-1 text-xs text-[#8a93a8]">拖入文件或点击区域选择本地素材，完成后自动释放 USB</p>
              </div>
            </div>
            <div className="flex flex-1 flex-col justify-center">
              <WebUsbDropZone
                disabled={!webUsbSupported || !sdkReady || !selectedDeviceKey || displayControlBusy}
                busy={busy}
                connected={connected}
                selectedFileName={selectedFile?.name ?? null}
                onFile={handleIncomingFile}
                onInvalidFile={() => {
                  setStatusText("仅支持 PNG、JPG、WebP、GIF 或 H.264 MP4 短视频（≤10 秒）");
                  setStatusKind("error");
                }}
              />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px] text-[#8a93a8]">
              <span className="rounded-[10px] bg-[#fafbfe] px-2 py-2">多设备 SN 选择</span>
              <span className="rounded-[10px] bg-[#fafbfe] px-2 py-2">最高 30 fps</span>
              <span className="rounded-[10px] bg-[#fafbfe] px-2 py-2">完成自动释放</span>
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
