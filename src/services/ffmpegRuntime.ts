import { FFmpeg } from "@ffmpeg/ffmpeg";
import {
  getCachedFfmpegAssets,
  getDirectFfmpegAssets,
  type CachedFfmpegAssets,
} from "./ffmpegAssetCache";

const FFMPEG_INIT_TIMEOUT_MS = 60_000;

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

export async function loadBrowserFfmpeg(
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
