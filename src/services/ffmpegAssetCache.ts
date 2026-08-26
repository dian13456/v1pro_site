const FFMPEG_ASSET_VERSION = "0.12.10-v1pro-1";

export interface CachedFfmpegAssets {
  coreURL: string;
  wasmURL: string;
  cached: boolean;
}

function localAssetUrl(fileName: string, forceRefresh = false): string {
  const base = `${import.meta.env.BASE_URL || "/"}ffmpeg`.replace(/\/$/, "");
  const url = new URL(`${base}/${fileName}`, window.location.origin);
  url.searchParams.set("v", FFMPEG_ASSET_VERSION);
  if (forceRefresh) {
    url.searchParams.set("retry", String(Date.now()));
  }
  return url.href;
}

export function getDirectFfmpegAssets(): CachedFfmpegAssets {
  return {
    // A retry gets a fresh browser-cache key while remaining on the website CDN.
    coreURL: localAssetUrl("ffmpeg-core.js", true),
    wasmURL: localAssetUrl("ffmpeg-core.wasm", true),
    cached: false,
  };
}

export function getCachedFfmpegAssets(): Promise<CachedFfmpegAssets> {
  // FFmpeg is loaded only when a conversion starts. Both files are deployed
  // with the website and delivered through www.jadot.cn's CDN, so opening the
  // share page no longer downloads 32 MB from the COS origin.
  return Promise.resolve({
    coreURL: localAssetUrl("ffmpeg-core.js"),
    wasmURL: localAssetUrl("ffmpeg-core.wasm"),
    cached: true,
  });
}
