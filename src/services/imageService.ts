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

interface CachedImageUrl {
  url: string;
  expiresAt: number;
}

const PREVIEW_URL_CACHE_TTL_MS = 8 * 60 * 1000;
const imageUrlCache = new Map<number, CachedImageUrl>();

export function invalidateImageUrl(resourceId: number, failedUrl?: string): void {
  const cached = imageUrlCache.get(resourceId);
  if (!cached || !failedUrl || cached.url === failedUrl) {
    imageUrlCache.delete(resourceId);
  }
}

export async function createImageUrl(
  resourceId: number,
  fallbackImageUrl?: string,
  options: { forDownload?: boolean; forceRefresh?: boolean } = {}
): Promise<SignedDownloadResult> {
  const forDownload = options.forDownload === true;
  const forceRefresh = options.forceRefresh === true;
  const cached = imageUrlCache.get(resourceId);
  if (!forDownload && !forceRefresh && cached && cached.expiresAt > Date.now()) {
    return { url: cached.url };
  }
  if (cached && cached.expiresAt <= Date.now()) {
    imageUrlCache.delete(resourceId);
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
    imageUrlCache.set(resourceId, {
      url: fallbackImageUrl,
      expiresAt: Date.now() + PREVIEW_URL_CACHE_TTL_MS,
    });
    return { url: fallbackImageUrl };
  }

  const auth = getAuthState();
  if (!hasValidLocalAuth() || !auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  const query = forDownload
    ? `?id=${resourceId}&download=1`
    : `?id=${resourceId}${forceRefresh ? "&refresh=1" : ""}`;
  const signed = await apiFetch<ImageSignResponse>(`/api/image/${query}`, {
    method: "GET",
    cache: forceRefresh ? "no-store" : "default",
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
  });

  if (!signed.url) {
    throw new Error(signed.error || "图片链接生成失败");
  }

  if (!forDownload) {
    imageUrlCache.set(resourceId, {
      url: signed.url,
      expiresAt: Date.now() + PREVIEW_URL_CACHE_TTL_MS,
    });
  }

  return {
    url: signed.url,
    stats: forDownload ? parseDownloadStats(signed) : null,
  };
}
