import { getAuthState, hasValidLocalAuth } from "./authService";
import { recordLocalDeviceDownload } from "./downloadStatsService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";
import { parseDownloadStats } from "../types/downloadStats";
import type { SignedDownloadResult } from "../types/downloadStats";

interface ImageSignResponse {
  url?: string;
  error?: string;
  downloadStats?: Record<string, unknown>;
}

const imageUrlCache = new Map<number, string>();

export async function createImageUrl(
  resourceId: number,
  fallbackImageUrl?: string,
  options: { forDownload?: boolean } = {}
): Promise<SignedDownloadResult> {
  const forDownload = options.forDownload === true;
  if (!forDownload && imageUrlCache.has(resourceId)) {
    return { url: imageUrlCache.get(resourceId) as string };
  }

  if (isStaticMode()) {
    if (!fallbackImageUrl) {
      throw new Error("静态模式下缺少图片地址");
    }
    if (forDownload) {
      const auth = getAuthState();
      if (!auth?.serial) {
        throw new Error("认证状态无效，请重新验证设备");
      }
      const stats = recordLocalDeviceDownload(auth.serial, resourceId);
      return { url: fallbackImageUrl, stats };
    }
    imageUrlCache.set(resourceId, fallbackImageUrl);
    return { url: fallbackImageUrl };
  }

  const auth = getAuthState();
  if (!hasValidLocalAuth() || !auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  const query = forDownload ? `?id=${resourceId}&download=1` : `?id=${resourceId}`;
  const signed = await apiFetch<ImageSignResponse>(`/api/image/${query}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
  });

  if (!signed.url) {
    throw new Error(signed.error || "图片链接生成失败");
  }

  if (!forDownload) {
    imageUrlCache.set(resourceId, signed.url);
  }

  return {
    url: signed.url,
    stats: forDownload ? parseDownloadStats(signed) : null,
  };
}
