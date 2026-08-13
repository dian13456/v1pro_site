const FFMPEG_ASSET_VERSION = "0.12.10-v1pro-1";
const FFMPEG_CACHE_NAME = `v1pro-ffmpeg-assets-${FFMPEG_ASSET_VERSION}`;
const FFMPEG_CACHE_PREFIX = "v1pro-ffmpeg-assets-";
const FFMPEG_DOWNLOAD_TIMEOUT_MS = 120_000;

export interface CachedFfmpegAssets {
  coreURL: string;
  wasmURL: string;
  cached: boolean;
}

let assetPromise: Promise<CachedFfmpegAssets> | null = null;
let preloadScheduled = false;

function assetUrl(fileName: string): string {
  const base = `${import.meta.env.BASE_URL || "/"}ffmpeg`.replace(/\/$/, "");
  const url = new URL(`${base}/${fileName}`, window.location.origin);
  url.searchParams.set("v", FFMPEG_ASSET_VERSION);
  return url.href;
}

function fetchWithTimeout(request: Request, cache: RequestCache): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FFMPEG_DOWNLOAD_TIMEOUT_MS);
  return fetch(request, { cache, signal: controller.signal })
    .finally(() => window.clearTimeout(timer));
}

async function fetchAndPersist(url: string): Promise<Response> {
  const request = new Request(url, { credentials: "same-origin" });
  if (!("caches" in window)) {
    const response = await fetchWithTimeout(request, "force-cache");
    if (!response.ok) throw new Error(`FFmpeg 资源下载失败（HTTP ${response.status}）`);
    return response;
  }

  const cache = await caches.open(FFMPEG_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetchWithTimeout(request, "reload");
  if (!response.ok) throw new Error(`FFmpeg 资源下载失败（HTTP ${response.status}）`);
  await cache.put(request, response.clone());
  return response;
}

async function responseBlobUrl(response: Response, mimeType: string): Promise<string> {
  const source = await response.blob();
  const blob = source.type === mimeType
    ? source
    : new Blob([await source.arrayBuffer()], { type: mimeType });
  return URL.createObjectURL(blob);
}

async function loadCachedAssets(): Promise<CachedFfmpegAssets> {
  const coreSource = assetUrl("ffmpeg-core.js");
  const wasmSource = assetUrl("ffmpeg-core.wasm");
  try {
    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith(FFMPEG_CACHE_PREFIX) && name !== FFMPEG_CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
    }
    const [coreResponse, wasmResponse] = await Promise.all([
      fetchAndPersist(coreSource),
      fetchAndPersist(wasmSource),
    ]);
    // Keep the module script on its same-origin URL. Loading that script from
    // a blob URL is blocked by strict production CSP in some browsers and the
    // FFmpeg worker can then wait forever without reporting the worker error.
    // The 32 MB WASM is the expensive asset, so expose only it as a persistent
    // Cache Storage-backed blob URL.
    void coreResponse;
    const wasmURL = await responseBlobUrl(wasmResponse, "application/wasm");
    // Ask the browser to protect site storage from routine eviction. This is
    // best-effort; browsers may decline and the Cache Storage entry still works.
    try {
      void navigator.storage?.persist?.().catch(() => { /* optional API */ });
    } catch { /* optional API */ }
    return { coreURL: coreSource, wasmURL, cached: true };
  } catch {
    // Private browsing, storage quota limits, or old browsers must not block
    // conversion. FFmpeg can still use the original same-origin URLs.
    return { coreURL: coreSource, wasmURL: wasmSource, cached: false };
  }
}

export function getDirectFfmpegAssets(): CachedFfmpegAssets {
  return {
    coreURL: assetUrl("ffmpeg-core.js"),
    wasmURL: assetUrl("ffmpeg-core.wasm"),
    cached: false,
  };
}

export function getCachedFfmpegAssets(): Promise<CachedFfmpegAssets> {
  assetPromise ??= loadCachedAssets();
  return assetPromise;
}

export function scheduleFfmpegAssetPreload(): void {
  if (preloadScheduled || typeof window === "undefined") return;
  preloadScheduled = true;

  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (connection?.saveData || connection?.effectiveType === "slow-2g") return;

  const start = () => { void getCachedFfmpegAssets(); };
  const scheduleIdle = () => {
    const idle = window.requestIdleCallback;
    if (typeof idle === "function") {
      idle(start, { timeout: 5000 });
    } else {
      window.setTimeout(start, 1200);
    }
  };

  if (document.readyState === "complete") scheduleIdle();
  else window.addEventListener("load", scheduleIdle, { once: true });
}
