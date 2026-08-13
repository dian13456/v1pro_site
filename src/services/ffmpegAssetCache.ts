const FFMPEG_ASSET_VERSION = "0.12.10-v1pro-1";
const DEFAULT_FFMPEG_COS_BASE =
  "https://v1pro-1311844229.cos.ap-guangzhou.myqcloud.com/ffmpeg/0.12.10-v1pro-1";
const FFMPEG_CACHE_PREFIX = "v1pro-ffmpeg-assets-";
const FFMPEG_DOWNLOAD_TIMEOUT_MS = 120_000;

export interface CachedFfmpegAssets {
  coreURL: string;
  wasmURL: string;
  cached: boolean;
}

let preloadScheduled = false;

function localAssetUrl(fileName: string): string {
  const base = `${import.meta.env.BASE_URL || "/"}ffmpeg`.replace(/\/$/, "");
  const url = new URL(`${base}/${fileName}`, window.location.origin);
  url.searchParams.set("v", FFMPEG_ASSET_VERSION);
  return url.href;
}

function cosAssetUrl(fileName: string): string {
  const configured = String(
    import.meta.env.VITE_FFMPEG_ASSET_BASE_URL || DEFAULT_FFMPEG_COS_BASE,
  ).trim().replace(/\/$/, "");
  return new URL(`${configured}/${fileName}`, window.location.origin).href;
}

function fetchWithTimeout(request: Request, cache: RequestCache): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FFMPEG_DOWNLOAD_TIMEOUT_MS);
  return fetch(request, { cache, signal: controller.signal })
    .finally(() => window.clearTimeout(timer));
}

export function getDirectFfmpegAssets(): CachedFfmpegAssets {
  return {
    coreURL: localAssetUrl("ffmpeg-core.js"),
    wasmURL: localAssetUrl("ffmpeg-core.wasm"),
    cached: false,
  };
}

export function getCachedFfmpegAssets(): Promise<CachedFfmpegAssets> {
  // Return immediately. The versioned COS URL has a one-year immutable HTTP
  // cache header, so Chromium downloads it once and can also retain its WASM
  // compilation cache. Converting a Cache Storage Response into a blob URL
  // made every conversion copy and recompile the entire 32 MB module.
  return Promise.resolve({
    coreURL: localAssetUrl("ffmpeg-core.js"),
    wasmURL: cosAssetUrl("ffmpeg-core.wasm"),
    cached: true,
  });
}

async function preloadFfmpegDownload(): Promise<void> {
  try {
    // Remove the obsolete app-managed blob cache from previous releases. The
    // browser HTTP cache now owns this immutable resource instead.
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith(FFMPEG_CACHE_PREFIX))
          .map((name) => caches.delete(name)),
      );
    }
    const response = await fetchWithTimeout(
      new Request(cosAssetUrl("ffmpeg-core.wasm"), {
        credentials: "omit",
        mode: "cors",
      }),
      "force-cache",
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // Drain the body so the HTTP cache entry is complete. Do not turn it into
    // a Blob; ffmpeg.load() must consume the original URL.
    await response.arrayBuffer();
  } catch {
    // Preload is opportunistic. Conversion retains its same-origin fallback.
  }
}

export function scheduleFfmpegAssetPreload(): void {
  if (preloadScheduled || typeof window === "undefined") return;
  preloadScheduled = true;

  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (connection?.saveData || connection?.effectiveType === "slow-2g") return;

  const start = () => { void preloadFfmpegDownload(); };
  const scheduleIdle = () => {
    const idle = window.requestIdleCallback;
    if (typeof idle === "function") {
      idle(start, { timeout: 2500 });
    } else {
      window.setTimeout(start, 500);
    }
  };

  if (document.readyState === "complete") scheduleIdle();
  else window.addEventListener("load", scheduleIdle, { once: true });
}
