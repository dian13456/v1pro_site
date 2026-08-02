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
  return resource.materialType === "image" || resource.materialType === "gif";
}

let sharedClient: V1ProWebTransferClient | null = null;
let transferInflight: Promise<{ bytes: number; frameCount: number; note?: string }> | null = null;
let transferInflightResourceId: number | null = null;

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

async function fetchTransferBlob(resource: ResourceItem): Promise<Blob> {
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

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (err) {
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
    throw new Error(message);
  }

  return response.blob();
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
      if (!client.connected) {
        callbacks.onStatus?.("正在连接设备…");
        await client.connect({ reuseAuthorized: true });
      }

      callbacks.onStatus?.("正在获取素材…");
      const blob = await fetchTransferBlob(resource);
      const fileName = guessTransferFileName(resource);

      callbacks.onStatus?.("正在编码并传输…");
      const result = await client.transferFile(blob, {
        fileName,
        onProgress: (info) => {
          if (info.phase === "encode") {
            callbacks.onStatus?.("正在编码 GFM1…");
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
