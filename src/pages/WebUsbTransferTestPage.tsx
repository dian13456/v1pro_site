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
import {
  convertBrowserRasterWithFfmpeg,
  convertBrowserVideoWithFfmpeg,
  planBrowserFfmpegVideo,
  probeBrowserVideoDuration,
} from "../services/browserFfmpegVideoService";
import { getCustomDisplayName } from "../services/welcomeService";
import { markBootWebsiteEntryHandled } from "../services/bootWebsiteService";
import type {
  V1ProDisplayStatus,
  V1ProTransferResult,
  V1ProWebTransferClient,
} from "../types/v1proWebTransfer";
import {
  COMPATIBLE_VIDEO_FPS,
  parseVideoFpsSelection,
  resolveVideoFps,
  type VideoFpsSelection,
} from "../utils/resourceCapacity";

type StatusKind = "idle" | "ok" | "error";
type MaterialTransferMode = "auto" | "image" | "gif" | "video";
type MaterialRotation = "auto" | 0 | 90 | 180 | 270;
type MaterialFitMode = "fill" | "contain";
type MaterialColorProfile = "normal" | "vivid" | "professional";
const DEFAULT_BOOT_WEBSITE_URL = "https://www.jadot.cn/";

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

function isVideoFile(file: File): boolean {
  return file.type.toLowerCase().startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(file.name);
}

async function resolveMaterialRotation(
  file: File,
  rotation: MaterialRotation,
): Promise<0 | 90 | 180 | 270> {
  if (rotation !== "auto") return rotation;
  if (isVideoFile(file)) {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    try {
      const portrait = await new Promise<boolean>((resolve, reject) => {
        video.onloadedmetadata = () => resolve(video.videoHeight > video.videoWidth);
        video.onerror = () => reject(new Error("无法读取视频方向"));
        video.src = url;
      }).catch(() => false);
      return portrait ? 90 : 0;
    } finally {
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    }
  }
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return 0;
  try {
    return bitmap.height > bitmap.width ? 90 : 0;
  } finally {
    bitmap.close();
  }
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
  const [bootWebsiteEnabled, setBootWebsiteEnabled] = useState(false);
  const [bootWebsiteUrl, setBootWebsiteUrl] = useState(DEFAULT_BOOT_WEBSITE_URL);
  const [bootWebsiteSupported, setBootWebsiteSupported] = useState<boolean | null>(null);
  const [bootWebsiteMessage, setBootWebsiteMessage] = useState("连接设备后自动读取上电打开网页设置。");
  const [materialTransferMode, setMaterialTransferMode] = useState<MaterialTransferMode>("auto");
  const [materialFpsSelection, setMaterialFpsSelection] = useState<VideoFpsSelection>(COMPATIBLE_VIDEO_FPS);
  const materialFps = resolveVideoFps(materialFpsSelection);
  const [materialRotation, setMaterialRotation] = useState<MaterialRotation>("auto");
  const [materialScale, setMaterialScale] = useState<50 | 75 | 100 | 125 | 150>(100);
  const [materialFitMode, setMaterialFitMode] = useState<MaterialFitMode>("contain");
  const [materialColor, setMaterialColor] = useState<MaterialColorProfile>("normal");
  const [materialPlaybackSpeed, setMaterialPlaybackSpeed] = useState(1);

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

  const syncBootWebsiteConfig = useCallback(async (client: V1ProWebTransferClient) => {
    setBootWebsiteMessage("正在读取上电打开网页设置…");
    try {
      const config = await client.getBootWebsiteConfig();
      setBootWebsiteEnabled(config.enabled);
      setBootWebsiteUrl(config.url || DEFAULT_BOOT_WEBSITE_URL);
      setBootWebsiteSupported(true);
      if (client.device) {
        markBootWebsiteEntryHandled(client.device as USBDevice);
      }
      setBootWebsiteMessage(
        config.enabled
          ? `已开启：设备下次上电时将自动打开 ${config.url}`
          : config.url
            ? `已关闭，设备中已保存网址：${config.url}`
            : "当前未开启，可填写网址后打开开关。",
      );
    } catch (err) {
      setBootWebsiteSupported(false);
      setBootWebsiteMessage(formatError(err));
    }
  }, []);

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
      await syncBootWebsiteConfig(client);
      setStatusText(`已连接：${deviceLabel(client)}`);
      setStatusKind("ok");
      const capacityLabel = client.getCapacityLabel?.() ?? "";
      setMetaText(
        capacityLabel
          ? `设备容量 ${capacityLabel}。将图片、GIF 或视频拖入下方区域即可自动传输（默认兼容 20/25/30fps，必要时自动倍速）。`
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
    setBootWebsiteEnabled(false);
    setBootWebsiteSupported(null);
    setBootWebsiteMessage("连接设备后自动读取上电打开网页设置。");
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

  const handleRefreshDeviceStatus = async () => {
    const client = clientRef.current;
    if (!client?.connected || displayControlLockRef.current || transferLockRef.current) return;
    displayControlLockRef.current = true;
    setDisplayControlBusy(true);
    try {
      await syncDisplayStatus(client);
      await syncBootWebsiteConfig(client);
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

  const handleBootWebsiteChange = async () => {
    const client = clientRef.current;
    if (!client?.connected) {
      setBootWebsiteMessage("请先连接设备后再设置上电打开网页。");
      return;
    }
    if (displayControlLockRef.current || transferLockRef.current) return;
    const enabled = !bootWebsiteEnabled;
    const url = bootWebsiteUrl.trim();
    if (enabled && !url) {
      setBootWebsiteMessage("请先填写要打开的完整网址。");
      return;
    }
    displayControlLockRef.current = true;
    setDisplayControlBusy(true);
    setBootWebsiteMessage("正在写入设备设置…");
    try {
      const config = await client.setBootWebsiteConfig(enabled, url);
      setBootWebsiteEnabled(config.enabled);
      setBootWebsiteUrl(config.url || DEFAULT_BOOT_WEBSITE_URL);
      setBootWebsiteSupported(true);
      setBootWebsiteMessage(
        config.enabled
          ? `已开启：设备下次上电时将自动打开 ${config.url}`
          : `已关闭${config.url ? `，已保留网址 ${config.url}` : ""}。`,
      );
    } catch (err) {
      setBootWebsiteMessage(formatError(err));
    } finally {
      displayControlLockRef.current = false;
      setDisplayControlBusy(false);
      refreshConnectionState();
    }
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

        const detectedRasterType = rasterMediaType(file);
        const detectedVideo = isVideoFile(file);
        if (materialTransferMode === "video" && !detectedVideo) {
          throw new Error("视频下传模式需要选择视频文件");
        }
        const selectedRasterType = materialTransferMode === "image" || materialTransferMode === "gif"
          ? materialTransferMode
          : materialTransferMode === "auto"
            ? detectedRasterType
            : null;
        const selectedVideo = materialTransferMode === "video"
          ? detectedVideo
          : materialTransferMode === "auto" && detectedVideo;
        const capacity = client.deviceCapacity ?? await client.refreshDeviceCapacity();
        if (!capacity?.maxFrames) {
          throw new Error("无法读取设备容量，请重新连接设备后重试");
        }
        const rotationDeg = await resolveMaterialRotation(file, materialRotation);
        let transferSource: Blob = file;
        let preparedMedia: {
          mediaType: "image" | "gif" | "video";
          maxFrames: number;
          frameCount: number;
          fps?: number;
          note: string;
        } | null = null;
        if (selectedRasterType) {
          const converted = await convertBrowserRasterWithFfmpeg(file, {
            fileName: file.name,
            mediaType: selectedRasterType,
            maxFrames: capacity.maxFrames,
            fitMode: materialFitMode,
            rotationDeg,
            scalePercent: materialScale,
            playbackSpeed: materialPlaybackSpeed,
            colorProfile: materialColor,
            onStatus: setStatusText,
            onProgress: (ratio) => setProgress(Math.round(ratio * 25)),
          });
          transferSource = converted.blob;
          preparedMedia = {
            mediaType: selectedRasterType,
            maxFrames: capacity.maxFrames,
            frameCount: converted.frameCount,
            note: converted.note,
          };
        } else if (selectedVideo) {
          setStatusText("正在读取视频信息…");
          const duration = await probeBrowserVideoDuration(file);
          const plan = planBrowserFfmpegVideo(
            duration,
            capacity.maxFrames,
            materialFps,
            materialPlaybackSpeed,
          );
          const converted = await convertBrowserVideoWithFfmpeg(file, {
            plan,
            fileName: file.name,
            fitMode: materialFitMode,
            rotationDeg,
            scalePercent: materialScale,
            colorProfile: materialColor,
            onStatus: setStatusText,
            onProgress: (ratio) => setProgress(Math.round(ratio * 25)),
          });
          transferSource = converted.blob;
          preparedMedia = {
            mediaType: "video",
            maxFrames: capacity.maxFrames,
            frameCount: converted.frameCount,
            fps: converted.fps,
            note: converted.note,
          };
        }

        const result = await client.transferFile(transferSource, {
          fileName: file.name,
          mediaType: preparedMedia?.mediaType,
          maxFrames: preparedMedia?.maxFrames,
          prebuiltGfm1: preparedMedia ? {
            frameCount: preparedMedia.frameCount,
            fps: preparedMedia.fps,
            note: preparedMedia.note,
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
            const ratio = preparedMedia
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
      materialColor,
      materialFitMode,
      materialFps,
      materialPlaybackSpeed,
      materialRotation,
      materialScale,
      materialTransferMode,
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
  const bootWebsiteControlsDisabled =
    !connected || busy || displayControlBusy || bootWebsiteSupported === false;
  const selectClassName = "mt-1.5 h-10 w-full rounded-[10px] border border-[#dfe3ed] bg-white px-3 text-[12px] font-semibold text-[#4a5270] outline-none transition focus:border-[#7c6cf0] focus:ring-2 focus:ring-[#7c6cf0]/10 disabled:cursor-not-allowed disabled:opacity-50";
  const advancedSettingsDisabled = busy || displayControlBusy;

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
            <p className="col-span-3 max-w-2xl text-[13px] leading-6 text-[#8a93a8] sm:col-span-1 sm:col-start-2">选择指定 SN 的 V1PRO，调节屏幕亮度、方向、跟随熄屏和上电打开网页，也可将图片、GIF 或短视频直接传输到设备。</p>
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
                <h2 className="text-[17px] font-extrabold">设备功能控制</h2>
                <p className="mt-1 text-xs text-[#8a93a8]">显示与开机网址设置会写入当前设备并保存</p>
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

            <div className="mt-3 rounded-[14px] border border-[#e2defe] bg-gradient-to-br from-[#faf9ff] to-[#f5f8ff] p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[12.5px] font-bold text-[#4a5270]">上电自动打开网页</p>
                  <p className="mt-1 text-[11px] leading-5 text-[#8a93a8]">设备上电后模拟键盘打开网址，适合自动进入佳点素材主页</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={bootWebsiteEnabled}
                  aria-label="上电自动打开网页"
                  disabled={bootWebsiteControlsDisabled}
                  onClick={() => void handleBootWebsiteChange()}
                  className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${bootWebsiteEnabled ? "bg-[#7c6cf0]" : "bg-[#cfd5e2]"}`}
                >
                  <span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${bootWebsiteEnabled ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  type="url"
                  maxLength={180}
                  value={bootWebsiteUrl}
                  disabled={!connected || busy || displayControlBusy || bootWebsiteEnabled || bootWebsiteSupported === false}
                  onChange={(event) => setBootWebsiteUrl(event.target.value)}
                  placeholder="https://www.jadot.cn/"
                  aria-label="上电自动打开的网址"
                  className="h-10 min-w-0 flex-1 rounded-[10px] border border-[#dfe3ed] bg-white px-3 text-[12px] font-semibold text-[#4a5270] outline-none transition focus:border-[#7c6cf0] focus:ring-2 focus:ring-[#7c6cf0]/10 disabled:cursor-not-allowed disabled:bg-[#f1f3f8] disabled:opacity-70"
                />
                <button
                  type="button"
                  disabled={!connected || busy || displayControlBusy || bootWebsiteEnabled || bootWebsiteSupported === false}
                  onClick={() => setBootWebsiteUrl(DEFAULT_BOOT_WEBSITE_URL)}
                  className="h-10 shrink-0 rounded-[10px] border border-[#ded9ff] bg-white px-4 text-[11.5px] font-bold text-[#7c6cf0] transition hover:bg-[#f0edff] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  使用佳点官网
                </button>
              </div>
              <p className={`mt-3 text-[11px] leading-5 ${bootWebsiteSupported === false ? "text-[#dc5d55]" : bootWebsiteEnabled ? "font-semibold text-[#6b5dde]" : "text-[#8a93a8]"}`}>
                {bootWebsiteMessage}
              </p>
            </div>

            <div className={`mt-3 rounded-[12px] border px-4 py-3 text-[12px] leading-5 ${displayControlSupported === false ? "border-[#ffd8d5] bg-[#fff4f3] text-[#dc5d55]" : "border-[#dce6fb] bg-[#f5f8ff] text-[#66708d]"}`}>
              {displayControlMessage}
            </div>
            <button
              type="button"
              disabled={!connected || busy || displayControlBusy}
              onClick={() => void handleRefreshDeviceStatus()}
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
            <div className="mt-5 grid flex-1 gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
              <aside className="rounded-[16px] border border-[#e2defe] bg-gradient-to-b from-[#faf9ff] to-[#f6f8ff] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-[14px] font-extrabold text-[#3f4660]">高级设置</h3>
                    <p className="mt-1 text-[11px] leading-5 text-[#8a93a8]">参数会参与本地转换，与 GUI 高级模式一致</p>
                  </div>
                  <button
                    type="button"
                    disabled={advancedSettingsDisabled}
                    onClick={() => {
                      setMaterialFpsSelection(COMPATIBLE_VIDEO_FPS);
                      setMaterialTransferMode("auto");
                      setMaterialRotation("auto");
                      setMaterialScale(100);
                      setMaterialFitMode("contain");
                      setMaterialColor("normal");
                      setMaterialPlaybackSpeed(1);
                    }}
                    className="shrink-0 rounded-full border border-[#ded9ff] bg-white px-3 py-1.5 text-[10.5px] font-bold text-[#7c6cf0] transition hover:bg-[#f0edff] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    恢复默认
                  </button>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3">
                  <label className="text-[11px] font-bold text-[#69728a]">
                    下传模式
                    <select
                      value={materialTransferMode}
                      disabled={advancedSettingsDisabled}
                      onChange={(event) => setMaterialTransferMode(event.target.value as MaterialTransferMode)}
                      className={selectClassName}
                      aria-label="下传模式"
                    >
                      <option value="auto">自动识别</option>
                      <option value="image">图片</option>
                      <option value="gif">GIF</option>
                      <option value="video">视频</option>
                    </select>
                  </label>
                  <label className="text-[11px] font-bold text-[#69728a]">
                    视频帧率
                    <select
                      value={materialFpsSelection}
                      disabled={advancedSettingsDisabled}
                      onChange={(event) => setMaterialFpsSelection(parseVideoFpsSelection(event.target.value))}
                      className={selectClassName}
                      aria-label="视频帧率"
                    >
                      <option value={COMPATIBLE_VIDEO_FPS}>兼容模式（20/25/30 fps）</option>
                      {[20, 25, 30].map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}
                    </select>
                  </label>
                  <label className="text-[11px] font-bold text-[#69728a]">
                    素材旋转
                    <select
                      value={materialRotation}
                      disabled={advancedSettingsDisabled}
                      onChange={(event) => {
                        const value = event.target.value;
                        setMaterialRotation(value === "auto" ? "auto" : Number(value) as 0 | 90 | 180 | 270);
                      }}
                      className={selectClassName}
                      aria-label="素材旋转"
                    >
                      <option value="auto">自动</option>
                      {[0, 90, 180, 270].map((rotation) => <option key={rotation} value={rotation}>{rotation}°</option>)}
                    </select>
                  </label>
                  <label className="text-[11px] font-bold text-[#69728a]">
                    画面缩放
                    <select
                      value={materialScale}
                      disabled={advancedSettingsDisabled}
                      onChange={(event) => setMaterialScale(Number(event.target.value) as 50 | 75 | 100 | 125 | 150)}
                      className={selectClassName}
                      aria-label="画面缩放"
                    >
                      {[50, 75, 100, 125, 150].map((scale) => <option key={scale} value={scale}>{scale}%</option>)}
                    </select>
                  </label>
                  <label className="text-[11px] font-bold text-[#69728a]">
                    铺满方式
                    <select
                      value={materialFitMode}
                      disabled={advancedSettingsDisabled}
                      onChange={(event) => setMaterialFitMode(event.target.value as MaterialFitMode)}
                      className={selectClassName}
                      aria-label="铺满方式"
                    >
                      <option value="contain">留黑边</option>
                      <option value="fill">铺满全屏</option>
                    </select>
                  </label>
                  <label className="text-[11px] font-bold text-[#69728a]">
                    素材色彩
                    <select
                      value={materialColor}
                      disabled={advancedSettingsDisabled}
                      onChange={(event) => setMaterialColor(event.target.value as MaterialColorProfile)}
                      className={selectClassName}
                      aria-label="素材色彩"
                    >
                      <option value="normal">普通</option>
                      <option value="vivid">鲜艳</option>
                      <option value="professional">专业</option>
                    </select>
                  </label>
                  <label className="col-span-2 text-[11px] font-bold text-[#69728a]">
                    播放倍速
                    <select
                      value={materialPlaybackSpeed}
                      disabled={advancedSettingsDisabled}
                      onChange={(event) => setMaterialPlaybackSpeed(Number(event.target.value))}
                      className={selectClassName}
                      aria-label="播放倍速"
                    >
                      {[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5, 6, 8, 10].map((speed) => (
                        <option key={speed} value={speed}>{speed.toFixed(speed % 1 === 0 ? 1 : 2)}×</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="mt-3 rounded-[10px] bg-white/80 px-3 py-2 text-[10.5px] leading-5 text-[#8a93a8]">
                  自动旋转会将竖屏素材转为横屏；倍速用于 GIF 和视频，空间不足时仍会自动提高倍速以适配设备容量。
                </p>
              </aside>

              <div className="flex min-w-0 flex-col justify-center lg:-mt-5">
                <WebUsbDropZone
                  disabled={!webUsbSupported || !sdkReady || !selectedDeviceKey || displayControlBusy}
                  busy={busy}
                  connected={connected}
                  selectedFileName={selectedFile?.name ?? null}
                  onFile={handleIncomingFile}
                  onInvalidFile={() => {
                    setStatusText("仅支持 PNG、JPG、WebP、GIF 或 H.264 MP4 短视频");
                    setStatusKind("error");
                  }}
                />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-[11px] text-[#8a93a8]">
              <span className="rounded-[10px] bg-[#fafbfe] px-2 py-2">多设备 SN 选择</span>
              <span className="rounded-[10px] bg-[#fafbfe] px-2 py-2">{materialFpsSelection === COMPATIBLE_VIDEO_FPS ? `兼容模式 · ${materialFps} fps` : `${materialFps} fps`} · {materialPlaybackSpeed}×</span>
              <span className="rounded-[10px] bg-[#fafbfe] px-2 py-2">完成自动释放</span>
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
