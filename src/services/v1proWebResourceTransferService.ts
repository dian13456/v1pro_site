import type { ResourceItem } from "../types/resource";
import type { V1ProWebTransferClient } from "../types/v1proWebTransfer";
import { withApiSignature } from "./apiSign";
import { getAuthState, hasValidLocalAuth } from "./authService";
import { API_BASE, formatClientError } from "./httpClient";
import { isStaticMode } from "./runtimeMode";
import {
  createV1ProWebTransferClient,
  isWebUsbSupported,
  listAuthorizedV1ProDevices,
  loadV1ProWebTransferSdk,
  WEBUSB_TRANSFER_VERSION,
} from "./v1proWebTransferClient";
import { guessTransferFileName } from "./v1proTransferService";
import {
  convertBrowserRasterWithFfmpeg,
  convertBrowserVideoWithFfmpeg,
} from "./browserFfmpegVideoService";

export { WEBUSB_TRANSFER_VERSION };

export function canWebUsbDirectTransfer(resource: ResourceItem): boolean {
  if (isStaticMode()) {
    return false;
  }
  if (!isWebUsbSupported()) {
    return false;
  }
  if (resource.category === "software") {
    return false;
  }
  return (
    resource.materialType === "image" ||
    resource.materialType === "gif" ||
    resource.materialType === "video"
  );
}

let sharedClient: V1ProWebTransferClient | null = null;
let transferInflight: Promise<{ bytes: number; frameCount: number; fps?: number; predictedFrameCount?: number; note?: string }> | null = null;
let transferInflightResourceId: number | "album" | null = null;
const TRANSFER_DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;
const ALBUM_FRAME_WIDTH = 320;
const ALBUM_FRAME_HEIGHT = 170;
const ALBUM_TRANSITION_STEPS = 6;
const ALBUM_TRANSITION_FRAME_MS = 50;

export type AlbumTransition = "none" | "fade" | "slide-left";

export function albumTransitionExtraFrames(imageCount: number, transition: AlbumTransition): number {
  if (transition === "none" || imageCount < 2) return 0;
  return imageCount * (ALBUM_TRANSITION_STEPS - 1);
}

export function albumRequiredFrames(
  imageCount: number,
  _switchDelayMs: number,
  transition: AlbumTransition,
): number {
  if (imageCount <= 0) return 0;
  return imageCount + albumTransitionExtraFrames(imageCount, transition);
}

function blendRgb565Frames(from: Uint8Array, to: Uint8Array, ratio: number): Uint8Array {
  const output = new Uint8Array(from.length);
  for (let offset = 0; offset < from.length; offset += 2) {
    const fromPixel = from[offset] | (from[offset + 1] << 8);
    const toPixel = to[offset] | (to[offset + 1] << 8);
    const fromR = (fromPixel >> 11) & 0x1f;
    const fromG = (fromPixel >> 5) & 0x3f;
    const fromB = fromPixel & 0x1f;
    const toR = (toPixel >> 11) & 0x1f;
    const toG = (toPixel >> 5) & 0x3f;
    const toB = toPixel & 0x1f;
    const red = Math.round(fromR + (toR - fromR) * ratio);
    const green = Math.round(fromG + (toG - fromG) * ratio);
    const blue = Math.round(fromB + (toB - fromB) * ratio);
    const pixel = (red << 11) | (green << 5) | blue;
    output[offset] = pixel & 0xff;
    output[offset + 1] = pixel >> 8;
  }
  return output;
}

function slideLeftRgb565Frames(from: Uint8Array, to: Uint8Array, ratio: number): Uint8Array {
  const output = new Uint8Array(from.length);
  const shiftPixels = Math.max(1, Math.min(ALBUM_FRAME_WIDTH - 1, Math.round(ALBUM_FRAME_WIDTH * ratio)));
  const currentPixels = ALBUM_FRAME_WIDTH - shiftPixels;
  for (let row = 0; row < ALBUM_FRAME_HEIGHT; row += 1) {
    const rowOffset = row * ALBUM_FRAME_WIDTH * 2;
    const currentStart = rowOffset + shiftPixels * 2;
    const currentEnd = rowOffset + ALBUM_FRAME_WIDTH * 2;
    output.set(from.subarray(currentStart, currentEnd), rowOffset);
    output.set(to.subarray(rowOffset, rowOffset + shiftPixels * 2), rowOffset + currentPixels * 2);
  }
  return output;
}

function composeAlbumFrames(
  sourceFrames: Uint8Array[],
  switchDelayMs: number,
  transition: AlbumTransition,
): { frames: Uint8Array[]; delaysMs: number[] } {
  const frames: Uint8Array[] = [];
  const delaysMs: number[] = [];
  for (let index = 0; index < sourceFrames.length; index += 1) {
    const current = sourceFrames[index];
    frames.push(current);
    delaysMs.push(switchDelayMs);
    if (transition === "none" || sourceFrames.length < 2) continue;

    const next = sourceFrames[(index + 1) % sourceFrames.length];
    for (let step = 1; step < ALBUM_TRANSITION_STEPS; step += 1) {
      const ratio = step / ALBUM_TRANSITION_STEPS;
      frames.push(
        transition === "fade"
          ? blendRgb565Frames(current, next, ratio)
          : slideLeftRgb565Frames(current, next, ratio),
      );
      delaysMs.push(ALBUM_TRANSITION_FRAME_MS);
    }
  }
  return { frames, delaysMs };
}

type BrowserGfm1Module = {
  decodeBlobToFrames: (
    blob: Blob,
    options?: {
      maxFrames?: number;
      maxVideoFps?: number;
      minVideoFps?: number;
      maxVideoSpeed?: number;
      fileName?: string;
      mediaType?: "image" | "gif" | "video";
      fitMode?: "fill" | "contain";
      onFrameEncoded?: (frameIndex: number, frameCount: number) => void;
    },
  ) => Promise<{ frames: Uint8Array[]; delaysMs: number[]; note?: string }>;
  buildGfm1Blob: (frames: Uint8Array[], delaysMs: number[]) => Uint8Array;
};

let browserGfm1Promise: Promise<BrowserGfm1Module> | null = null;

function loadBrowserGfm1Module(): Promise<BrowserGfm1Module> {
  if (!browserGfm1Promise) {
    // @ts-expect-error Browser SDK is maintained as a checked-in JavaScript module.
    browserGfm1Promise = import("@v1pro-webusb/v1pro-gfm1.js") as Promise<BrowserGfm1Module>;
  }
  return browserGfm1Promise;
}

async function resolveAuthenticatedV1ProDevice(): Promise<USBDevice> {
  const authenticatedSerial = getAuthState()?.serial?.trim();
  if (!authenticatedSerial) {
    throw new Error("认证 SN 无效，请重新选择设备进行认证");
  }

  const devices = await listAuthorizedV1ProDevices();
  const matched = devices.find(
    (device) => device.serialNumber?.trim() === authenticatedSerial,
  );
  if (!matched) {
    throw new Error(`未找到当前认证的 V1PRO（SN ${authenticatedSerial}），请重新认证该设备`);
  }
  return matched;
}

function formatUsbError(err: unknown): string {
  if (err && typeof err === "object" && "name" in err && err.name === "V1ProUsbError" && "message" in err) {
    return String(err.message);
  }
  if (err instanceof Error) {
    return formatClientError(err, "网页直传失败");
  }
  return "网页直传失败";
}

function transferPath(resource: ResourceItem, mode: "direct" | "proxyFallback"): string {
  const params = new URLSearchParams({
    id: String(resource.id),
    webusb: "1",
  });
  if (mode === "direct") {
    params.set("download", "1");
  } else {
    params.set("preview", "1");
    params.set("blob", "1");
  }
  if (resource.materialType === "image") {
    return `/api/image/?${params.toString()}`;
  }
  return `/api/resource/?${params.toString()}`;
}

async function authorizedApiResponse(path: string, signal?: AbortSignal): Promise<Response> {
  const auth = getAuthState();
  if (!auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  const init = await withApiSignature(path, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
  });
  return fetch(`${API_BASE}${path}`, { ...init, signal });
}

async function readBlobResponse(
  response: Response,
  onProgress?: (received: number, total: number) => void,
): Promise<Blob> {
  if (!response.ok) {
    let message = `素材下载失败（HTTP ${response.status}）`;
    try {
      const payload = (await response.json()) as { error?: string; message?: string };
      message = payload.message || payload.error || message;
    } catch {
      // ignore non-json body
    }
    throw new Error(message);
  }

  const total = Number.parseInt(response.headers.get("Content-Length") || "0", 10) || 0;
  if (!response.body) {
    return response.blob();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastReportedAt = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      chunks.push(value);
      received += value.byteLength;
      const now = Date.now();
      if (now - lastReportedAt >= 200 || (total > 0 && received >= total)) {
        lastReportedAt = now;
        onProgress?.(received, total);
      }
    }
  } catch (err) {
    throw err;
  } finally {
    reader.releaseLock();
  }

  onProgress?.(received, total);
  return new Blob(chunks as BlobPart[], {
    type: response.headers.get("Content-Type") || "application/octet-stream",
  });
}

async function fetchDirectTransferUrl(resource: ResourceItem, signal?: AbortSignal): Promise<string> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  const signedResponse = await authorizedApiResponse(transferPath(resource, "direct"), signal);
  if (!signedResponse.ok) {
    await readBlobResponse(signedResponse);
    throw new Error("COS 下载地址生成失败");
  }
  const payload = (await signedResponse.json()) as { url?: string; error?: string };
  if (!payload.url) {
    throw new Error(payload.error || "COS 下载地址生成失败");
  }
  return payload.url;
}

async function fetchTransferBlob(
  resource: ResourceItem,
  onProgress?: (received: number, total: number) => void,
  onFallback?: () => void,
  preparedDirectUrl?: string,
): Promise<Blob> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  const controller = new AbortController();
  let downloadTimedOut = false;
  let timeout = 0;
  const resetIdleTimeout = () => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(() => {
      downloadTimedOut = true;
      controller.abort();
    }, TRANSFER_DOWNLOAD_IDLE_TIMEOUT_MS);
  };
  const reportProgress = (received: number, total: number) => {
    resetIdleTimeout();
    onProgress?.(received, total);
  };
  resetIdleTimeout();
  try {
    const directUrl =
      preparedDirectUrl || (await fetchDirectTransferUrl(resource, controller.signal));

    try {
      const directResponse = await fetch(directUrl, {
        method: "GET",
        mode: "cors",
        signal: controller.signal,
      });
      return await readBlobResponse(directResponse, reportProgress);
    } catch (directError) {
      if (controller.signal.aborted) throw directError;
      onFallback?.();
      resetIdleTimeout();
      const fallbackPath = transferPath(resource, "proxyFallback");
      const fallbackResponse = await authorizedApiResponse(fallbackPath, controller.signal);
      return await readBlobResponse(fallbackResponse, reportProgress);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        downloadTimedOut
          ? "视频下载连续60秒未收到数据，请检查网络后重试"
          : "视频下载已取消",
      );
    }
    throw new Error(formatClientError(err, "素材下载失败，请检查网络后重试"));
  } finally {
    window.clearTimeout(timeout);
  }
}

function formatDownloadProgress(received: number, total: number, usingProxyFallback = false): string {
  const receivedMb = received / (1024 * 1024);
  const sourceLabel = usingProxyFallback ? "服务器中转" : "COS 直链";
  if (total > 0) {
    const totalMb = total / (1024 * 1024);
    const percent = Math.min(100, Math.round((received / total) * 100));
    return `正在从${sourceLabel}下载视频… ${receivedMb.toFixed(1)}/${totalMb.toFixed(1)} MB（${percent}%）`;
  }
  return `正在从${sourceLabel}下载视频… ${receivedMb.toFixed(1)} MB`;
}

async function validateTransferBlob(resource: ResourceItem, blob: Blob): Promise<void> {
  if (blob.size <= 0) {
    throw new Error("下载到的素材为空，请重试");
  }

  const prefix = new TextDecoder()
    .decode(await blob.slice(0, Math.min(blob.size, 128)).arrayBuffer())
    .replace(/\0/g, "")
    .trimStart()
    .toLowerCase();
  const contentType = (blob.type || "").toLowerCase();
  const looksLikeTextPayload =
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType.includes("html") ||
    contentType.includes("text/") ||
    prefix.startsWith("<!doctype") ||
    prefix.startsWith("<html") ||
    prefix.startsWith("<?xml") ||
    prefix.startsWith("{") ||
    prefix.startsWith("[");

  if (resource.materialType === "video") {
    if (looksLikeTextPayload) {
      throw new Error("服务器返回的不是视频文件，请刷新页面后重试");
    }
    return;
  }

  if (resource.materialType === "image" || resource.materialType === "gif") {
    if (looksLikeTextPayload) {
      throw new Error("服务器返回的不是图片文件，请刷新页面后重试");
    }
  }
}

export function prefetchWebUsbTransferDownload(): void {
  // Blob 下载走同源 API，无需预取 COS 签名链接。
}

export async function transferAlbumResourcesViaWebUsb(
  resources: ResourceItem[],
  callbacks: {
    onStatus?: (message: string) => void;
    onProgress?: (progress: number) => void;
  } = {},
  options: {
    targetFrameCapacity: 77 | 154 | 308;
    switchDelayMs: number;
    transition: AlbumTransition;
  },
): Promise<{ bytes: number; frameCount: number; note?: string }> {
  if (resources.length === 0) {
    throw new Error("请先选择要写入相册的素材");
  }
  if (resources.some((resource) => resource.materialType !== "image" || !canWebUsbDirectTransfer(resource))) {
    throw new Error("相册模式目前仅支持图片素材");
  }
  if (transferInflight) {
    throw new Error("请先等待当前网页直传完成");
  }

  const switchDelayMs = Math.max(100, Math.min(60_000, Math.round(options.switchDelayMs)));
  const targetFrameCapacity = options.targetFrameCapacity;
  const transitionLabel = options.transition === "fade"
    ? "淡入淡出"
    : options.transition === "slide-left"
      ? "向左滑动"
      : "无动画";
  const task = (async () => {
    let lastReportedProgress = 0;
    const reportProgress = (progress: number) => {
      lastReportedProgress = Math.max(lastReportedProgress, Math.max(0, Math.min(100, progress)));
      callbacks.onProgress?.(lastReportedProgress);
    };

    reportProgress(2);
    await Promise.all([loadV1ProWebTransferSdk(), loadBrowserGfm1Module()]);
    if (!sharedClient) {
      sharedClient = await createV1ProWebTransferClient();
    }
    const client = sharedClient;

    try {
      callbacks.onStatus?.("正在连接当前认证设备…");
      const targetDevice = await resolveAuthenticatedV1ProDevice();
      await client.connect({ device: targetDevice });
      const deviceFrameCapacity = client.deviceCapacity?.maxFrames;
      if (!deviceFrameCapacity) {
        throw new Error("无法读取设备容量，请重新连接设备后重试");
      }
      const frameLimit = Math.min(targetFrameCapacity, deviceFrameCapacity);
      if (deviceFrameCapacity < targetFrameCapacity) {
        callbacks.onStatus?.(`当前设备最多 ${deviceFrameCapacity} 帧，将按设备实际容量检查相册`);
      }

      const requiredFrames = albumRequiredFrames(resources.length, switchDelayMs, options.transition);
      if (requiredFrames > frameLimit) {
        throw new Error(`当前延时和动画共需 ${requiredFrames} 帧，超过当前设备的 ${frameLimit} 帧容量，请缩短延时、关闭动画或减少图片`);
      }

      const { buildGfm1Blob } = await loadBrowserGfm1Module();
      const sourceFrames: Uint8Array[] = [];

      for (let index = 0; index < resources.length; index += 1) {
        const resource = resources[index];
        const remainingFrames = resources.length - sourceFrames.length;
        if (remainingFrames <= 0) {
          throw new Error(`相册超过当前设备的 ${frameLimit} 帧容量，请减少素材`);
        }

        callbacks.onStatus?.(`正在获取相册素材 ${index + 1}/${resources.length}：${resource.title || resource.description}`);
        const blob = await fetchTransferBlob(
          resource,
          (received, total) => {
            if (total <= 0) return;
            const itemRatio = Math.min(1, received / total) * 0.4;
            reportProgress(5 + ((index + itemRatio) / resources.length) * 65);
          },
          () => callbacks.onStatus?.(`素材 ${index + 1}/${resources.length} COS 直连不可用，已切换服务器下载…`),
        );
        await validateTransferBlob(resource, blob);

        callbacks.onStatus?.(`正在转换相册素材 ${index + 1}/${resources.length}…`);
        const decoded = await convertBrowserRasterWithFfmpeg(blob, {
          fileName: guessTransferFileName(resource),
          mediaType: "image",
          maxFrames: 1,
          fitMode: "contain",
          colorProfile: "normal",
          includeFrames: true,
          onStatus: callbacks.onStatus,
          onProgress: (ratio) => {
            reportProgress(5 + ((index + 0.4 + ratio * 0.6) / resources.length) * 65);
          },
        });
        if (!decoded.frames?.length) {
          throw new Error(`素材“${resource.title || resource.description}”没有可写入的画面`);
        }
        sourceFrames.push(decoded.frames[0]);
        reportProgress(5 + ((index + 1) / resources.length) * 65);
      }

      callbacks.onStatus?.("正在生成图片切换动画…");
      const { frames, delaysMs } = composeAlbumFrames(sourceFrames, switchDelayMs, options.transition);
      if (frames.length > frameLimit) {
        throw new Error(`相册实际需要 ${frames.length} 帧，超过当前设备的 ${frameLimit} 帧容量`);
      }
      callbacks.onStatus?.(`正在打包相册：${resources.length} 张图片 · ${frames.length} 帧…`);
      const gfm1 = buildGfm1Blob(frames, delaysMs);
      const gfm1Buffer = gfm1.buffer.slice(
        gfm1.byteOffset,
        gfm1.byteOffset + gfm1.byteLength,
      ) as ArrayBuffer;
      reportProgress(72);

      callbacks.onStatus?.("正在通过 USB 写入相册…");
      const result = await client.transferFile(new Blob([gfm1Buffer], { type: "application/octet-stream" }), {
        fileName: "v1pro-album.gfm1",
        mediaType: "image",
        maxFrames: frameLimit,
        pingFirst: false,
        prebuiltGfm1: {
          frameCount: frames.length,
          note: `相册 ${resources.length} 张图片 · ${transitionLabel} · 切换延时 ${(switchDelayMs / 1000).toFixed(1)} 秒`,
        },
        onProgress: (info) => {
          callbacks.onStatus?.(`正在传输相册…${Math.round(info.ratio * 100)}%`);
          reportProgress(72 + info.ratio * 27);
        },
      });

      reportProgress(100);
      const note = `相册传输完成：${resources.length} 张图片 · ${result.frameCount} 帧 · ${transitionLabel} · 切换延时 ${(switchDelayMs / 1000).toFixed(1)} 秒`;
      callbacks.onStatus?.(note);
      return { bytes: result.bytes, frameCount: result.frameCount, note };
    } catch (err) {
      throw new Error(formatUsbError(err));
    } finally {
      await client.disconnect();
      sharedClient = null;
    }
  })();

  transferInflight = task;
  transferInflightResourceId = "album";
  try {
    return await task;
  } finally {
    transferInflight = null;
    transferInflightResourceId = null;
  }
}

export async function transferResourceViaWebUsb(
  resource: ResourceItem,
  callbacks: {
    onStatus?: (message: string) => void;
    onProgress?: (progress: number) => void;
  } = {},
  options: {
    videoFps?: number;
    fitMode?: "fill" | "contain";
    rotationDeg?: 0 | 90 | 180 | 270;
    colorProfile?: "normal" | "vivid" | "professional";
  } = {},
): Promise<{ bytes: number; frameCount: number; fps?: number; predictedFrameCount?: number; note?: string }> {
  if (!canWebUsbDirectTransfer(resource)) {
    throw new Error("当前素材或浏览器不支持网页直传");
  }
  if (transferInflight) {
    if (transferInflightResourceId === resource.id) {
      throw new Error("正在传输中，请稍候…");
    }
    throw new Error("请先等待当前网页直传完成");
  }

  const effectiveFitMode = options.fitMode ?? (resource.materialType === "gif" ? "contain" : "fill");

  const task = (async () => {
    let lastReportedProgress = 0;
    const reportProgress = (progress: number) => {
      const normalized = Math.max(0, Math.min(100, progress));
      // Download, decode and USB callbacks may complete on different tasks.
      // Never let an older stage overwrite a newer stage with a lower value.
      lastReportedProgress = Math.max(lastReportedProgress, normalized);
      callbacks.onProgress?.(lastReportedProgress);
    };
    reportProgress(2);
    await loadV1ProWebTransferSdk();
    if (!sharedClient) {
      sharedClient = await createV1ProWebTransferClient();
    }
    const client = sharedClient;

    let preEraseStarted = false;
    try {
      const targetDevice = await resolveAuthenticatedV1ProDevice();
      const isVideo = resource.materialType === "video";
      if (isVideo) {
        reportProgress(5);
        callbacks.onStatus?.("正在连接设备并获取视频信息…");
        const [, directUrl] = await Promise.all([
          client.connect({ device: targetDevice }),
          fetchDirectTransferUrl(resource),
        ]);
        const capacityLabel = client.getCapacityLabel?.() ?? "";
        if (!client.deviceCapacity) {
          const detail = client.capacityError ? `：${client.capacityError}` : "";
          throw new Error(`无法读取设备容量${detail}`);
        }
        callbacks.onStatus?.(`正在预测设备空间… ${capacityLabel}`);
        reportProgress(12);
        const videoFps = options.videoFps;
        if (!videoFps) {
          throw new Error("未指定视频下传帧率，请重新选择 20、25 或 30 fps。");
        }
        const prediction = await client.predictVideoUrl(directUrl, {
          maxVideoFps: videoFps,
          minVideoFps: videoFps,
          maxVideoSpeed: 10,
        });
        if (prediction.fps !== videoFps) {
          throw new Error(`视频帧率预处理不一致：选择 ${videoFps} fps，实际为 ${prediction.fps} fps。`);
        }
        callbacks.onStatus?.(
          `本次预计写入：${prediction.frameCount} 帧 · ${prediction.fps}fps，正在启动设备预擦除…`,
        );
        reportProgress(16);
        await client.beginPreparedVideoTransfer(prediction.totalBytes);
        preEraseStarted = true;
        callbacks.onStatus?.("设备正在预擦除，同时从 COS 直链下载视频…");
        reportProgress(18);
        let usingProxyFallback = false;
        const blob = await fetchTransferBlob(
          resource,
          (received, total) => {
            callbacks.onStatus?.(formatDownloadProgress(received, total, usingProxyFallback));
            if (total > 0) reportProgress(18 + (received / total) * 22);
          },
          () => {
            usingProxyFallback = true;
            callbacks.onStatus?.("COS 直连不可用，已切换服务器中转下载…");
          },
          directUrl,
        );
        await validateTransferBlob(resource, blob);
        const fileName = guessTransferFileName(resource);
        reportProgress(40);

        let result: Awaited<ReturnType<V1ProWebTransferClient["transferFile"]>>;
        try {
          const converted = await convertBrowserVideoWithFfmpeg(blob, {
            fileName,
            plan: {
              duration: prediction.duration,
              sourceSpan: prediction.sourceSpan,
              frameCount: prediction.frameCount,
              fps: prediction.fps,
              speed: prediction.speed,
              totalBytes: prediction.totalBytes,
              note: prediction.note || `FFmpeg 本地转换 · ${prediction.frameCount} 帧 · ${prediction.fps}fps`,
            },
            fitMode: effectiveFitMode,
            rotationDeg: options.rotationDeg ?? 0,
            colorProfile: options.colorProfile ?? "normal",
            onStatus: callbacks.onStatus,
            onProgress: (ratio) => reportProgress(40 + ratio * 25),
          });

          callbacks.onStatus?.("本地转换完成，正在继续设备传输…");
          callbacks.onStatus?.("正在通过 USB 传输…");
          result = await client.transferFile(converted.blob, {
            fileName,
            mediaType: "video",
            maxVideoFps: videoFps,
            minVideoFps: videoFps,
            pingFirst: false,
            preparedTotalBytes: converted.totalBytes,
            prebuiltGfm1: {
              frameCount: converted.frameCount,
              fps: converted.fps,
              note: converted.note,
            },
            onProgress: (info) => {
              callbacks.onStatus?.(`正在传输… ${(info.ratio * 100).toFixed(0)}%`);
              reportProgress(65 + info.ratio * 34);
            },
          });
        } catch (ffmpegError) {
          if (preEraseStarted) throw ffmpegError;
          callbacks.onStatus?.("浏览器 FFmpeg 不可用，已切换兼容转换…");
          result = await client.transferFile(blob, {
            fileName,
            mediaType: "video",
            maxVideoFps: videoFps,
            minVideoFps: videoFps,
            maxVideoSpeed: 10,
            fitMode: effectiveFitMode,
            rotationDeg: options.rotationDeg ?? 0,
            colorProfile: options.colorProfile ?? "normal",
            pingFirst: false,
            onProgress: (info) => {
              if (info.phase === "encode" && info.frameCount) {
                callbacks.onStatus?.(`兼容模式正在解码… ${info.sent}/${info.frameCount} 帧`);
                reportProgress(40 + Math.min(1, info.sent / info.frameCount) * 25);
                return;
              }
              callbacks.onStatus?.(`正在传输… ${(info.ratio * 100).toFixed(0)}%`);
              reportProgress(65 + info.ratio * 34);
            },
          });
        }
        if (result.fps !== videoFps) {
          throw new Error(`视频实际编码帧率不一致：选择 ${videoFps} fps，实际为 ${result.fps ?? "未知"} fps。`);
        }
        if (result.frameCount !== prediction.frameCount) {
          throw new Error(`视频写入帧数不一致：预计 ${prediction.frameCount} 帧，实际 ${result.frameCount} 帧。`);
        }
        let message = `网页直传完成：${result.frameCount} 帧 · ${result.fps}fps`;
        if (result.note) message += `（${result.note}）`;
        callbacks.onStatus?.(message);
        reportProgress(100);
        return { ...result, predictedFrameCount: prediction.frameCount };
      }

      let connected = false;
      let downloadDone = false;
      callbacks.onStatus?.("正在连接设备…");
      reportProgress(5);
      const connectTask = client.connect({ device: targetDevice }).then((device) => {
        connected = true;
        callbacks.onStatus?.(
          downloadDone
            ? "素材下载完成，正在准备设备…"
            : "设备已连接，正在获取素材…",
        );
        return device;
      });
      const downloadTask = fetchTransferBlob(
        resource,
        (received, total) => {
          if (total > 0) reportProgress(5 + (received / total) * 30);
        },
        () => callbacks.onStatus?.("COS 直连不可用，已切换服务器下载…"),
      ).then((blob) => {
        downloadDone = true;
        if (!connected) {
          callbacks.onStatus?.("素材下载完成，正在连接设备…");
        }
        return blob;
      });
      const [, blob] = await Promise.all([connectTask, downloadTask]);
      await validateTransferBlob(resource, blob);
      const capacityLabel = client.getCapacityLabel?.() ?? "";
      if (capacityLabel) {
        callbacks.onStatus?.(`设备容量 ${capacityLabel}`);
      }
      const fileName = guessTransferFileName(resource);

      callbacks.onStatus?.("正在编码并传输…");
      reportProgress(38);
      const maxFrames = client.deviceCapacity?.maxFrames;
      if (!maxFrames) {
        throw new Error("无法读取设备容量，请重新连接设备后重试");
      }
      const mediaType = resource.materialType === "gif" ? "gif" : "image";
      const converted = await convertBrowserRasterWithFfmpeg(blob, {
        fileName,
        mediaType,
        maxFrames,
        fitMode: options.fitMode ?? "fill",
        rotationDeg: options.rotationDeg ?? 0,
        colorProfile: options.colorProfile ?? "normal",
        onStatus: callbacks.onStatus,
        onProgress: (ratio) => reportProgress(38 + ratio * 17),
      });
      const result = await client.transferFile(converted.blob, {
        fileName,
        mediaType,
        maxFrames,
        pingFirst: false,
        prebuiltGfm1: {
          frameCount: converted.frameCount,
          note: converted.note,
        },
        fitMode: effectiveFitMode,
        rotationDeg: options.rotationDeg ?? 0,
        colorProfile: options.colorProfile ?? "normal",
        onProgress: (info) => {
          if (info.note && info.sent === 0) {
            callbacks.onStatus?.(info.note);
            return;
          }
          if (info.phase === "encode" && info.frameCount) {
            callbacks.onStatus?.(
              `正在编码… ${info.sent}/${info.frameCount} 帧`,
            );
            reportProgress(38 + Math.min(1, info.sent / info.frameCount) * 17);
            return;
          }
          callbacks.onStatus?.(`正在传输… ${(info.ratio * 100).toFixed(0)}%`);
          reportProgress(55 + info.ratio * 44);
        },
      });

      let message = `网页直传完成：${result.frameCount} 帧`;
      if (result.note) {
        message += `（${result.note}）`;
      }
      callbacks.onStatus?.(message);
      reportProgress(100);
      return result;
    } catch (err) {
      if (preEraseStarted) {
        await client.disconnect();
        sharedClient = null;
      }
      if (!client.busy && !client.connected) {
        sharedClient = null;
      }
      throw new Error(formatUsbError(err));
    } finally {
      // Website transfers are one-shot. Always release the selected device so
      // another V1PRO or the desktop GUI can claim its interface immediately.
      await client.disconnect();
      sharedClient = null;
    }
  })();

  transferInflight = task;
  transferInflightResourceId = resource.id;
  try {
    return await task;
  } finally {
    transferInflight = null;
    transferInflightResourceId = null;
  }
}
