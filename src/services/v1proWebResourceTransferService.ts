import type { ResourceItem } from "../types/resource";
import type { V1ProWebTransferClient } from "../types/v1proWebTransfer";
import { withApiSignature } from "./apiSign";
import { getAuthState, hasValidLocalAuth } from "./authService";
import { API_BASE, formatClientError } from "./httpClient";
import { isStaticMode } from "./runtimeMode";
import {
  createV1ProWebTransferClient,
  isWebUsbSupported,
  loadV1ProWebTransferSdk,
  WEBUSB_TRANSFER_VERSION,
} from "./v1proWebTransferClient";
import { guessTransferFileName } from "./v1proTransferService";

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
let transferInflight: Promise<{ bytes: number; frameCount: number; note?: string }> | null = null;
let transferInflightResourceId: number | null = null;
const TRANSFER_DOWNLOAD_TIMEOUT_MS = 120_000;

function formatUsbError(err: unknown): string {
  if (err && typeof err === "object" && "name" in err && err.name === "V1ProUsbError" && "message" in err) {
    return String(err.message);
  }
  if (err instanceof Error) {
    return formatClientError(err, "网页直传失败");
  }
  return "网页直传失败";
}

function transferBlobPath(resource: ResourceItem): string {
  const params = new URLSearchParams({
    id: String(resource.id),
    download: "1",
    blob: "1",
  });
  if (resource.materialType === "image") {
    return `/api/image/?${params.toString()}`;
  }
  return `/api/resource/?${params.toString()}`;
}

async function fetchTransferBlob(
  resource: ResourceItem,
  onProgress?: (received: number, total: number) => void,
): Promise<Blob> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  const auth = getAuthState();
  if (!auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  const path = transferBlobPath(resource);
  const init = await withApiSignature(path, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
  });

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), TRANSFER_DOWNLOAD_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    window.clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("视频下载超时，请检查网络后重试");
    }
    throw new Error(formatClientError(err, "素材下载失败，请检查网络后重试"));
  }

  if (!response.ok) {
    let message = `素材下载失败（HTTP ${response.status}）`;
    try {
      const payload = (await response.json()) as { error?: string; message?: string };
      message = payload.message || payload.error || message;
    } catch {
      // ignore non-json body
    }
    window.clearTimeout(timeout);
    throw new Error(message);
  }

  const total = Number.parseInt(response.headers.get("Content-Length") || "0", 10) || 0;
  if (!response.body) {
    try {
      return await response.blob();
    } finally {
      window.clearTimeout(timeout);
    }
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
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("视频下载超时，请检查网络后重试");
    }
    throw new Error(formatClientError(err, "视频下载中断，请重试"));
  } finally {
    window.clearTimeout(timeout);
    reader.releaseLock();
  }

  onProgress?.(received, total);
  return new Blob(chunks as BlobPart[], {
    type: response.headers.get("Content-Type") || "application/octet-stream",
  });
}

function formatDownloadProgress(received: number, total: number): string {
  const receivedMb = received / (1024 * 1024);
  if (total > 0) {
    const totalMb = total / (1024 * 1024);
    const percent = Math.min(100, Math.round((received / total) * 100));
    return `正在下载视频… ${receivedMb.toFixed(1)}/${totalMb.toFixed(1)} MB（${percent}%）`;
  }
  return `正在下载视频… ${receivedMb.toFixed(1)} MB`;
}

export function prefetchWebUsbTransferDownload(): void {
  // Blob 下载走同源 API，无需预取 COS 签名链接。
}

export async function transferResourceViaWebUsb(
  resource: ResourceItem,
  callbacks: {
    onStatus?: (message: string) => void;
  } = {},
): Promise<{ bytes: number; frameCount: number; note?: string }> {
  if (!canWebUsbDirectTransfer(resource)) {
    throw new Error("当前素材或浏览器不支持网页直传");
  }
  if (transferInflight) {
    if (transferInflightResourceId === resource.id) {
      throw new Error("正在传输中，请稍候…");
    }
    throw new Error("请先等待当前网页直传完成");
  }

  const task = (async () => {
    await loadV1ProWebTransferSdk();
    if (!sharedClient) {
      sharedClient = await createV1ProWebTransferClient();
    }
    const client = sharedClient;

    try {
      const isVideo = resource.materialType === "video";
      let connected = false;
      let downloadDone = false;
      callbacks.onStatus?.("正在连接设备…");
      const connectTask = client.connect({ reuseAuthorized: true }).then((device) => {
        connected = true;
        callbacks.onStatus?.(
          downloadDone
            ? "素材下载完成，正在准备设备…"
            : isVideo
              ? "设备已连接，正在下载视频…"
              : "设备已连接，正在获取素材…",
        );
        return device;
      });
      const downloadTask = fetchTransferBlob(
        resource,
        isVideo
          ? (received, total) => callbacks.onStatus?.(formatDownloadProgress(received, total))
          : undefined,
      ).then((blob) => {
        downloadDone = true;
        if (!connected) {
          callbacks.onStatus?.("素材下载完成，正在连接设备…");
        }
        return blob;
      });
      const [, blob] = await Promise.all([connectTask, downloadTask]);
      const capacityLabel = client.getCapacityLabel?.() ?? "";
      if (capacityLabel) {
        callbacks.onStatus?.(`设备容量 ${capacityLabel}`);
      }
      const fileName = guessTransferFileName(resource);

      callbacks.onStatus?.(isVideo ? "正在解码视频并传输…" : "正在编码并传输…");
      const result = await client.transferFile(blob, {
        fileName,
        pingFirst: false,
        onProgress: (info) => {
          if (info.note && info.sent === 0) {
            callbacks.onStatus?.(info.note);
            return;
          }
          if (info.phase === "encode" && info.frameCount && info.sent < info.frameCount) {
            callbacks.onStatus?.(
              isVideo
                ? `正在解码视频… ${info.sent}/${info.frameCount} 帧`
                : `正在编码… ${info.sent}/${info.frameCount} 帧`,
            );
            return;
          }
          callbacks.onStatus?.(`正在传输… ${(info.ratio * 100).toFixed(0)}%`);
        },
      });

      let message = `网页直传完成：${result.frameCount} 帧`;
      if (result.note) {
        message += `（${result.note}）`;
      }
      callbacks.onStatus?.(message);
      return result;
    } catch (err) {
      if (!client.busy && !client.connected) {
        sharedClient = null;
      }
      throw new Error(formatUsbError(err));
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
