import { FFmpeg } from "@ffmpeg/ffmpeg";
import {
  getCachedFfmpegAssets,
  getDirectFfmpegAssets,
  type CachedFfmpegAssets,
} from "./ffmpegAssetCache";

const FFMPEG_INIT_TIMEOUT_MS = 180_000;
let runtime: FFmpeg | null = null;
let runtimePromise: Promise<FFmpeg> | null = null;
let operationTail: Promise<void> = Promise.resolve();
let prewarmScheduled = false;

export interface BrowserFfmpegLease {
  ffmpeg: FFmpeg;
  release: () => void;
}

async function loadWithTimeout(
  ffmpeg: FFmpeg,
  assets: CachedFfmpegAssets,
): Promise<void> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FFMPEG_INIT_TIMEOUT_MS);
  try {
    await ffmpeg.load(
      { coreURL: assets.coreURL, wasmURL: assets.wasmURL },
      { signal: controller.signal },
    );
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("FFmpeg 初始化超时，请检查网络后重试");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

async function loadBrowserFfmpeg(
  ffmpeg: FFmpeg,
  onStatus?: (message: string) => void,
): Promise<void> {
  onStatus?.("正在准备 FFmpeg 核心（首次使用约下载 32MB）…");
  const cachedAssets = await getCachedFfmpegAssets();
  onStatus?.(cachedAssets.cached
    ? "正在从浏览器缓存初始化 FFmpeg…"
    : "正在初始化浏览器 FFmpeg…");

  try {
    await loadWithTimeout(ffmpeg, cachedAssets);
  } catch (cachedError) {
    if (!cachedAssets.cached) throw cachedError;
    ffmpeg.terminate();
    onStatus?.("缓存初始化失败，正在切换兼容加载…");
    await loadWithTimeout(ffmpeg, getDirectFfmpegAssets());
  }
}

function getOrCreateBrowserFfmpeg(
  onStatus?: (message: string) => void,
): Promise<FFmpeg> {
  if (runtime) {
    onStatus?.("FFmpeg 已预热，正在准备转换…");
    return Promise.resolve(runtime);
  }
  if (runtimePromise) {
    onStatus?.("正在等待后台 FFmpeg 初始化完成…");
    return runtimePromise;
  }

  runtimePromise = (async () => {
    const ffmpeg = new FFmpeg();
    try {
      await loadBrowserFfmpeg(ffmpeg, onStatus);
      runtime = ffmpeg;
      return ffmpeg;
    } catch (error) {
      ffmpeg.terminate();
      throw error;
    }
  })().catch((error) => {
    runtime = null;
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}

export async function acquireBrowserFfmpeg(
  onStatus?: (message: string) => void,
): Promise<BrowserFfmpegLease> {
  let unlock = () => {};
  const gate = new Promise<void>((resolve) => { unlock = resolve; });
  const previous = operationTail;
  operationTail = previous.then(() => gate);
  await previous;

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    unlock();
  };
  try {
    return { ffmpeg: await getOrCreateBrowserFfmpeg(onStatus), release };
  } catch (error) {
    release();
    throw error;
  }
}

export function scheduleBrowserFfmpegPrewarm(): void {
  if (prewarmScheduled || typeof window === "undefined") return;
  prewarmScheduled = true;

  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (connection?.saveData || connection?.effectiveType === "slow-2g") return;

  const start = () => { void getOrCreateBrowserFfmpeg().catch(() => {}); };
  const scheduleIdle = () => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(start, { timeout: 1500 });
    } else {
      window.setTimeout(start, 500);
    }
  };
  if (document.readyState === "complete") scheduleIdle();
  else window.addEventListener("load", scheduleIdle, { once: true });
}
