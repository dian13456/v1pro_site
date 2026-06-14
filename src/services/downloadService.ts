import { apiFetch } from "./httpClient";
import { getAuthState, hasValidLocalAuth, verifyTokenRemote } from "./authService";
import { recordLocalDeviceDownload } from "./downloadStatsService";
import { isStaticMode } from "./runtimeMode";
import { parseDownloadStats } from "../types/downloadStats";
import type { SignedDownloadResult } from "../types/downloadStats";

interface GinResourceResponse {
  url?: string;
  error?: string;
  downloadStats?: Record<string, unknown>;
}

const PLAY_URL_TTL_MS = 8 * 60 * 1000;
const MAX_PLAY_PREFETCH = 3;
const playUrlCache = new Map<number, { url: string; fetchedAt: number }>();
const playUrlInflight = new Map<number, Promise<string>>();
let activePlayPrefetchCount = 0;

function getCachedPlayUrl(resourceId: number): string | null {
  const cached = playUrlCache.get(resourceId);
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > PLAY_URL_TTL_MS) {
    playUrlCache.delete(resourceId);
    return null;
  }
  return cached.url;
}

function rememberPlayUrl(resourceId: number, url: string): void {
  playUrlCache.set(resourceId, { url, fetchedAt: Date.now() });
}

export function prefetchPlayUrl(resourceId: number, fallbackDownloadUrl?: string): void {
  if (getCachedPlayUrl(resourceId)) return;
  if (playUrlInflight.has(resourceId)) return;
  if (activePlayPrefetchCount >= MAX_PLAY_PREFETCH) return;

  activePlayPrefetchCount += 1;
  const promise = createDownloadUrl(resourceId, fallbackDownloadUrl, { forDownload: false })
    .then((result) => {
      if (result.url) {
        rememberPlayUrl(resourceId, result.url);
        return result.url;
      }
      return "";
    })
    .finally(() => {
      activePlayPrefetchCount = Math.max(0, activePlayPrefetchCount - 1);
      playUrlInflight.delete(resourceId);
    });
  playUrlInflight.set(resourceId, promise);
  void promise;
}

export async function createDownloadUrl(
  resourceId: number,
  fallbackDownloadUrl?: string,
  options: { forDownload?: boolean } = {}
): Promise<SignedDownloadResult> {
  const forDownload = options.forDownload === true;
  const auth = getAuthState();
  if (!hasValidLocalAuth() || !auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  if (forDownload) {
    const valid = await verifyTokenRemote();
    if (!valid) {
      throw new Error("认证已失效，请重新验证设备");
    }
  } else {
    const cached = getCachedPlayUrl(resourceId);
    if (cached) {
      return { url: cached };
    }
  }
  if (isStaticMode()) {
    if (!fallbackDownloadUrl) {
      throw new Error("静态模式下缺少下载地址");
    }
    if (forDownload) {
      const stats = recordLocalDeviceDownload(auth.serial, resourceId);
      return { url: fallbackDownloadUrl, stats };
    }
    return { url: fallbackDownloadUrl };
  }

  const query = forDownload
    ? `/api/resource/?id=${resourceId}&download=1`
    : `/api/resource/?id=${resourceId}&preview=1`;
  const signed = await apiFetch<GinResourceResponse>(query, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
  });

  if (signed.url) {
    if (!forDownload) {
      rememberPlayUrl(resourceId, signed.url);
    }
    return {
      url: signed.url,
      stats: parseDownloadStats(signed),
    };
  }
  throw new Error(signed.error || "下载链接生成失败");
}
