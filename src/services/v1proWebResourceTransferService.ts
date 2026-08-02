import type { ResourceItem } from "../types/resource";
import type { V1ProWebTransferClient } from "../types/v1proWebTransfer";
import {
  createV1ProWebTransferClient,
  isWebUsbSupported,
  loadV1ProWebTransferSdk,
} from "./v1proWebTransferClient";
import { isStaticMode } from "./runtimeMode";
import {
  guessTransferFileName,
  prefetchTransferDownloadUrl,
  waitForTransferDownloadUrl,
} from "./v1proTransferService";

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

function formatUsbError(err: unknown): string {
  if (err && typeof err === "object" && "name" in err && err.name === "V1ProUsbError" && "message" in err) {
    return String(err.message);
  }
  return err instanceof Error ? err.message : "网页直传失败";
}

export function prefetchWebUsbTransferDownload(resource: ResourceItem, options?: { urgent?: boolean }): void {
  if (!canWebUsbDirectTransfer(resource)) {
    return;
  }
  prefetchTransferDownloadUrl(resource, options);
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
    const cache = await waitForTransferDownloadUrl(resource);
    const response = await fetch(cache.url);
    if (!response.ok) {
      throw new Error("素材下载失败，请稍后重试");
    }
    const blob = await response.blob();
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
    if (client.busy) {
      // leave client for retry
    } else if (!client.connected) {
      sharedClient = null;
    }
    throw new Error(formatUsbError(err));
  }
}
