import { FFmpeg, FFFSType, type ProgressEventCallback } from "@ffmpeg/ffmpeg";
import { loadBrowserFfmpeg } from "./ffmpegRuntime";

const LCD_WIDTH = 320;
const LCD_HEIGHT = 170;
const FRAME_BYTES = LCD_WIDTH * LCD_HEIGHT * 2;
const GFM1_HEADER_BYTES = 56;
export const MAX_BROWSER_DIRECT_TRANSFER_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_SPEED = 10;

export type BrowserVideoFitMode = "fill" | "contain";
export type BrowserVideoColorProfile = "normal" | "vivid" | "professional";

export interface BrowserFfmpegVideoPlan {
  duration: number;
  sourceSpan: number;
  frameCount: number;
  fps: number;
  speed: number;
  totalBytes: number;
  note: string;
}

interface ConvertBrowserVideoOptions {
  plan: BrowserFfmpegVideoPlan;
  fileName?: string;
  fitMode?: BrowserVideoFitMode;
  rotationDeg?: 0 | 90 | 180 | 270;
  colorProfile?: BrowserVideoColorProfile;
  onStatus?: (message: string) => void;
  onProgress?: (ratio: number) => void;
}

interface BrowserFfmpegVideoResult {
  blob: Blob;
  frameCount: number;
  fps: number;
  totalBytes: number;
  note: string;
}

function gfm1TotalBytes(frameCount: number): number {
  return GFM1_HEADER_BYTES + frameCount * 2 + frameCount * FRAME_BYTES;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function planBrowserFfmpegVideo(
  duration: number,
  maxFrames: number,
  fps: number,
): BrowserFfmpegVideoPlan {
  const safeDuration = finitePositive(duration, 0);
  const frameBudget = Math.max(1, Math.floor(maxFrames));
  const safeFps = Math.max(1, Math.floor(fps));
  if (!safeDuration) {
    throw new Error("无法读取视频时长");
  }

  const normalSpeedFrames = Math.max(1, Math.ceil(safeDuration * safeFps));
  const speed = normalSpeedFrames <= frameBudget
    ? 1
    : (safeDuration * safeFps) / frameBudget;
  if (speed > MAX_VIDEO_SPEED) {
    throw new Error(
      `设备空间不足：${safeFps}fps 下需要约 ${normalSpeedFrames} 帧，`
      + `即使加速到 ${MAX_VIDEO_SPEED} 倍也无法放入 ${frameBudget} 帧设备。`,
    );
  }

  const frameCount = normalSpeedFrames <= frameBudget ? normalSpeedFrames : frameBudget;
  const speedNote = speed > 1.0001 ? ` · 自动加速 ${speed.toFixed(2)}×` : " · 原速";
  return {
    duration: safeDuration,
    sourceSpan: safeDuration,
    frameCount,
    fps: safeFps,
    speed,
    totalBytes: gfm1TotalBytes(frameCount),
    note: `FFmpeg 本地转换 · ${frameCount} 帧 · ${safeFps}fps${speedNote}`,
  };
}

export async function probeBrowserVideoDuration(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "metadata";
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      video.onloadedmetadata = () => resolve(video.duration);
      video.onerror = () => reject(new Error("无法读取视频信息，请使用 H.264 8-bit MP4"));
      video.src = url;
    });
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("视频时长无效");
    }
    return duration;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function inputExtension(fileName: string, mimeType: string): string {
  const match = fileName.trim().toLowerCase().match(/\.(mp4|webm|mov|m4v)$/);
  if (match) return match[1];
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("quicktime")) return "mov";
  return "mp4";
}

function rotationFilters(rotationDeg: number): string[] {
  if (rotationDeg === 90) return ["transpose=clock"];
  if (rotationDeg === 180) return ["hflip", "vflip"];
  if (rotationDeg === 270) return ["transpose=cclock"];
  return [];
}

function resizeFilters(fitMode: BrowserVideoFitMode): string[] {
  if (fitMode === "contain") {
    return [
      `scale=${LCD_WIDTH}:${LCD_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos+accurate_rnd+full_chroma_int`,
      `pad=${LCD_WIDTH}:${LCD_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`,
    ];
  }
  return [
    `crop='if(gte(iw/ih,${LCD_WIDTH}/${LCD_HEIGHT}),ih*${LCD_WIDTH}/${LCD_HEIGHT},iw)':'if(gte(iw/ih,${LCD_WIDTH}/${LCD_HEIGHT}),ih,iw*${LCD_HEIGHT}/${LCD_WIDTH})'`,
    `scale=${LCD_WIDTH}:${LCD_HEIGHT}:flags=lanczos+accurate_rnd+full_chroma_int`,
  ];
}

function colorFilters(profile: BrowserVideoColorProfile): string[] {
  const values = {
    // RGB565 loses tonal precision quickly. Keep contrast moderate, lift the
    // midtones before quantisation, then sharpen only after the 320x170 resize.
    normal: {
      saturation: 1.0, contrast: 1.0, brightness: 0, gamma: 1.0,
      red: 1.0, green: 1.0, blue: 1.0, sharpness: 0.12,
    },
    vivid: {
      saturation: 1.10, contrast: 1.03, brightness: 0.002, gamma: 1.01,
      red: 1.005, green: 1.0, blue: 0.995, sharpness: 0.18,
    },
    professional: {
      saturation: 1.0, contrast: 1.025, brightness: 0.002, gamma: 1.01,
      red: 1.01, green: 1.0, blue: 0.99, sharpness: 0.16,
    },
  }[profile];
  const filters = [
    `eq=saturation=${values.saturation.toFixed(4)}`
      + `:contrast=${values.contrast.toFixed(4)}`
      + `:brightness=${values.brightness.toFixed(4)}`
      + `:gamma=${values.gamma.toFixed(4)}:gamma_weight=0.85`,
  ];
  if (values.red !== 1 || values.green !== 1 || values.blue !== 1) {
    filters.push(
      `colorchannelmixer=rr=${values.red.toFixed(4)}:gg=${values.green.toFixed(4)}:bb=${values.blue.toFixed(4)}`,
    );
  }
  filters.push(`unsharp=3:3:${values.sharpness.toFixed(3)}:3:3:0`);
  return filters;
}

function buildFilterChain(options: ConvertBrowserVideoOptions): string {
  const { plan } = options;
  const filters = [
    `trim=start=0:duration=${plan.sourceSpan.toFixed(6)}`,
    `setpts=(PTS-STARTPTS)/${plan.speed.toFixed(8)}`,
    `fps=${plan.fps}`,
    ...rotationFilters(options.rotationDeg ?? 0),
    ...resizeFilters(options.fitMode ?? "fill"),
    ...colorFilters(options.colorProfile ?? "normal"),
    "setsar=1",
  ];
  return filters.join(",");
}

function buildGfm1Header(frameCount: number, fps: number): Uint8Array {
  const header = new Uint8Array(GFM1_HEADER_BYTES + frameCount * 2);
  const view = new DataView(header.buffer);
  header.set([0x47, 0x46, 0x4d, 0x31], 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, LCD_WIDTH, true);
  view.setUint16(8, LCD_HEIGHT, true);
  view.setUint16(10, frameCount, true);
  view.setUint32(12, frameCount * FRAME_BYTES, true);
  const delayMs = Math.max(1, Math.min(0xffff, Math.round(1000 / fps)));
  for (let index = 0; index < frameCount; index += 1) {
    view.setUint16(GFM1_HEADER_BYTES + index * 2, delayMs, true);
  }
  return header;
}

function normalizeRawFrames(raw: Uint8Array, frameCount: number): Uint8Array {
  const availableFrames = Math.floor(raw.byteLength / FRAME_BYTES);
  if (availableFrames < 1) {
    throw new Error("FFmpeg 未输出有效视频帧");
  }
  const expectedBytes = frameCount * FRAME_BYTES;
  if (availableFrames >= frameCount) {
    return raw.slice(0, expectedBytes);
  }

  // FFmpeg timestamp rounding can occasionally omit the final frame. Repeat
  // only the last decoded frame so the pre-erased byte count remains exact.
  const normalized = new Uint8Array(expectedBytes);
  const availableBytes = availableFrames * FRAME_BYTES;
  normalized.set(raw.subarray(0, availableBytes));
  const lastFrame = raw.subarray(availableBytes - FRAME_BYTES, availableBytes);
  for (let index = availableFrames; index < frameCount; index += 1) {
    normalized.set(lastFrame, index * FRAME_BYTES);
  }
  return normalized;
}

export async function convertBrowserVideoWithFfmpeg(
  source: Blob,
  options: ConvertBrowserVideoOptions,
): Promise<BrowserFfmpegVideoResult> {
  if (source.size <= 0) throw new Error("视频文件为空");
  if (source.size > MAX_BROWSER_DIRECT_TRANSFER_VIDEO_BYTES) {
    throw new Error("网页 FFmpeg 转换暂支持 50MB 以内的视频");
  }

  const ffmpeg = new FFmpeg();
  const extension = inputExtension(options.fileName || "", source.type || "");
  const inputDir = "/v1pro-input";
  const inputName = `source.${extension}`;
  const inputPath = `${inputDir}/${inputName}`;
  const outputPath = "/v1pro-output.rgb565";
  let lastProgress = 0;
  const onProgress: ProgressEventCallback = ({ progress }) => {
    const normalized = Math.max(lastProgress, Math.min(0.98, Math.max(0, progress || 0)));
    lastProgress = normalized;
    options.onProgress?.(normalized);
  };

  try {
    await loadBrowserFfmpeg(ffmpeg, options.onStatus);
    ffmpeg.on("progress", onProgress);
    await ffmpeg.createDir(inputDir);
    await ffmpeg.mount(
      FFFSType.WORKERFS,
      { blobs: [{ name: inputName, data: source }] },
      inputDir,
    );

    options.onStatus?.("正在使用 FFmpeg 解码、裁剪和调色…");
    options.onProgress?.(0);
    const exitCode = await ffmpeg.exec([
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-an",
      "-vf",
      buildFilterChain(options),
      "-frames:v",
      String(options.plan.frameCount),
      "-pix_fmt",
      "rgb565be",
      "-sws_flags",
      "lanczos+accurate_rnd+full_chroma_int",
      "-f",
      "rawvideo",
      outputPath,
    ]);
    if (exitCode !== 0) {
      throw new Error(`FFmpeg 转换失败（代码 ${exitCode}）`);
    }

    const output = await ffmpeg.readFile(outputPath);
    if (!(output instanceof Uint8Array)) {
      throw new Error("FFmpeg 输出格式异常");
    }
    const pixels = normalizeRawFrames(output, options.plan.frameCount);
    const header = buildGfm1Header(options.plan.frameCount, options.plan.fps);
    const packed = new Uint8Array(header.byteLength + pixels.byteLength);
    packed.set(header);
    packed.set(pixels, header.byteLength);
    const blob = new Blob([packed.buffer], { type: "application/x-v1pro-gfm1" });
    if (blob.size !== options.plan.totalBytes) {
      throw new Error(`FFmpeg 输出大小不一致（${blob.size}/${options.plan.totalBytes}）`);
    }
    options.onProgress?.(1);
    return {
      blob,
      frameCount: options.plan.frameCount,
      fps: options.plan.fps,
      totalBytes: blob.size,
      note: options.plan.note,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "未知错误");
    throw new Error(`浏览器 FFmpeg 转换失败：${message}`);
  } finally {
    try { ffmpeg.off("progress", onProgress); } catch { /* worker may already be gone */ }
    try { await ffmpeg.deleteFile(outputPath); } catch { /* output may not exist */ }
    try { await ffmpeg.unmount(inputDir); } catch { /* mount may not exist */ }
    try { await ffmpeg.deleteDir(inputDir); } catch { /* directory may not exist */ }
    ffmpeg.terminate();
  }
}
