import { FFFSType, type ProgressEventCallback } from "@ffmpeg/ffmpeg";
import { acquireBrowserFfmpeg } from "./ffmpegRuntime";
import { readGifFrameDelays } from "./gifFrameTiming";

const LCD_WIDTH = 320;
const LCD_HEIGHT = 170;
const FRAME_BYTES = LCD_WIDTH * LCD_HEIGHT * 2;
const GFM1_HEADER_BYTES = 56;
export const MAX_BROWSER_DIRECT_TRANSFER_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_SPEED = 10;

export type BrowserVideoFitMode = "fill" | "contain";
export type BrowserVideoColorProfile = "normal" | "vivid" | "professional";
export type BrowserFfmpegRasterMediaType = "image" | "gif";

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
  scalePercent?: number;
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

interface ConvertBrowserRasterOptions {
  mediaType: BrowserFfmpegRasterMediaType;
  maxFrames: number;
  fileName?: string;
  fitMode?: BrowserVideoFitMode;
  rotationDeg?: 0 | 90 | 180 | 270;
  scalePercent?: number;
  playbackSpeed?: number;
  colorProfile?: BrowserVideoColorProfile;
  includeFrames?: boolean;
  onStatus?: (message: string) => void;
  onProgress?: (ratio: number) => void;
}

export interface BrowserFfmpegRasterResult {
  blob: Blob;
  frames?: Uint8Array[];
  delaysMs: number[];
  frameCount: number;
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
  requestedSpeed = 1,
): BrowserFfmpegVideoPlan {
  const safeDuration = finitePositive(duration, 0);
  const frameBudget = Math.max(1, Math.floor(maxFrames));
  const safeFps = Math.max(1, Math.floor(fps));
  if (!safeDuration) {
    throw new Error("无法读取视频时长");
  }

  const normalSpeedFrames = Math.max(1, Math.ceil(safeDuration * safeFps));
  const minimumSpeed = Math.max(0.5, Math.min(MAX_VIDEO_SPEED, finitePositive(requestedSpeed, 1)));
  const speed = Math.max(minimumSpeed, (safeDuration * safeFps) / frameBudget);
  if (speed > MAX_VIDEO_SPEED) {
    throw new Error(
      `设备空间不足：${safeFps}fps 下需要约 ${normalSpeedFrames} 帧，`
      + `即使加速到 ${MAX_VIDEO_SPEED} 倍也无法放入 ${frameBudget} 帧设备。`,
    );
  }

  const frameCount = Math.min(
    frameBudget,
    Math.max(1, Math.ceil((safeDuration * safeFps) / speed)),
  );
  const speedNote = Math.abs(speed - 1) < 0.0001
    ? " · 原速"
    : speed > minimumSpeed + 0.0001
      ? ` · 容量适配 ${speed.toFixed(2)}×`
      : ` · ${speed.toFixed(2)}×`;
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

function inputExtension(fileName: string, mimeType: string, fallback = "mp4"): string {
  const match = fileName.trim().toLowerCase().match(/\.(mp4|webm|mov|m4v|png|jpe?g|webp|gif)$/);
  if (match) return match[1];
  if (mimeType.includes("gif")) return "gif";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("jpeg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("quicktime")) return "mov";
  return fallback;
}

function rotationFilters(rotationDeg: number): string[] {
  if (rotationDeg === 90) return ["transpose=clock"];
  if (rotationDeg === 180) return ["hflip", "vflip"];
  if (rotationDeg === 270) return ["transpose=cclock"];
  return [];
}

function resizeFilters(fitMode: BrowserVideoFitMode, scalePercent = 100): string[] {
  const scale = Math.max(50, Math.min(150, Math.round(scalePercent))) / 100;
  const filters: string[] = [];
  if (fitMode === "contain") {
    filters.push(
      `scale=${LCD_WIDTH}:${LCD_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos+accurate_rnd+full_chroma_int`,
      `pad=${LCD_WIDTH}:${LCD_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`,
    );
  } else {
    filters.push(
      `crop='if(gte(iw/ih,${LCD_WIDTH}/${LCD_HEIGHT}),ih*${LCD_WIDTH}/${LCD_HEIGHT},iw)':'if(gte(iw/ih,${LCD_WIDTH}/${LCD_HEIGHT}),ih,iw*${LCD_HEIGHT}/${LCD_WIDTH})'`,
      `scale=${LCD_WIDTH}:${LCD_HEIGHT}:flags=lanczos+accurate_rnd+full_chroma_int`,
    );
  }
  if (Math.abs(scale - 1) < 0.001) return filters;
  const scaledWidth = Math.max(1, Math.round(LCD_WIDTH * scale));
  const scaledHeight = Math.max(1, Math.round(LCD_HEIGHT * scale));
  filters.push(`scale=${scaledWidth}:${scaledHeight}:flags=lanczos+accurate_rnd+full_chroma_int`);
  if (scale < 1) {
    filters.push(`pad=${LCD_WIDTH}:${LCD_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`);
  } else {
    filters.push(`crop=${LCD_WIDTH}:${LCD_HEIGHT}:(iw-ow)/2:(ih-oh)/2`);
  }
  return filters;
}

function colorFilters(profile: BrowserVideoColorProfile): string[] {
  const values = {
    // RGB565 loses tonal precision quickly. Keep contrast moderate, lift the
    // midtones before quantisation, then sharpen only after the 320x170 resize.
    normal: {
      saturation: 1.08, contrast: 1.05, brightness: 0.002, gamma: 1.01,
      red: 1.0, green: 1.0, blue: 1.0, sharpness: 0.15,
    },
    vivid: {
      saturation: 1.18, contrast: 1.07, brightness: 0.003, gamma: 1.012,
      red: 1.005, green: 1.0, blue: 0.995, sharpness: 0.20,
    },
    professional: {
      saturation: 1.04, contrast: 1.05, brightness: 0.002, gamma: 1.01,
      red: 1.01, green: 1.0, blue: 0.99, sharpness: 0.17,
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

function flattenRasterAlphaToBlack(): string[] {
  // RGB565 has no alpha channel. GIF/PNG palette entries may keep white RGB
  // values under fully transparent pixels; dropping alpha directly therefore
  // produces a white rectangle on the panel. Premultiplying onto black before
  // resizing matches the desktop converter's transparent-black canvas.
  return ["format=rgba", "premultiply=inplace=1", "format=rgb24"];
}

function buildFilterChain(options: ConvertBrowserVideoOptions): string {
  const { plan } = options;
  const filters = [
    `trim=start=0:duration=${plan.sourceSpan.toFixed(6)}`,
    `setpts=(PTS-STARTPTS)/${plan.speed.toFixed(8)}`,
    `fps=${plan.fps}`,
    ...rotationFilters(options.rotationDeg ?? 0),
    ...resizeFilters(options.fitMode ?? "fill", options.scalePercent),
    ...colorFilters(options.colorProfile ?? "normal"),
    "setsar=1",
  ];
  return filters.join(",");
}

function normalizeDelayMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 100;
  return Math.max(1, Math.min(0xffff, Math.round(value)));
}

function buildGfm1HeaderWithDelays(delaysMs: number[]): Uint8Array {
  const frameCount = delaysMs.length;
  if (frameCount < 1) throw new Error("没有可打包的画面帧");
  const header = new Uint8Array(GFM1_HEADER_BYTES + frameCount * 2);
  const view = new DataView(header.buffer);
  header.set([0x47, 0x46, 0x4d, 0x31], 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, LCD_WIDTH, true);
  view.setUint16(8, LCD_HEIGHT, true);
  view.setUint16(10, frameCount, true);
  view.setUint32(12, frameCount * FRAME_BYTES, true);
  for (let index = 0; index < frameCount; index += 1) {
    view.setUint16(GFM1_HEADER_BYTES + index * 2, normalizeDelayMs(delaysMs[index]), true);
  }
  return header;
}

function buildGfm1Header(frameCount: number, fps: number): Uint8Array {
  const delayMs = normalizeDelayMs(1000 / fps);
  return buildGfm1HeaderWithDelays(Array.from({ length: frameCount }, () => delayMs));
}

function packGfm1Pixels(pixels: Uint8Array, delaysMs: number[]): Uint8Array {
  const expectedBytes = delaysMs.length * FRAME_BYTES;
  if (pixels.byteLength !== expectedBytes) {
    throw new Error(`FFmpeg 画面数据大小不一致（${pixels.byteLength}/${expectedBytes}）`);
  }
  const header = buildGfm1HeaderWithDelays(delaysMs);
  const packed = new Uint8Array(header.byteLength + pixels.byteLength);
  packed.set(header);
  packed.set(pixels, header.byteLength);
  return packed;
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

type GifProbeFrame = {
  best_effort_timestamp_time?: string | number;
  pkt_duration_time?: string | number;
  duration_time?: string | number;
};

function finiteSeconds(value: string | number | undefined): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value || "");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function gifDelaysFromProbe(frames: GifProbeFrame[], frameCount: number): number[] {
  const delays: number[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const frame = frames[index];
    const explicitDuration = finiteSeconds(frame?.pkt_duration_time)
      ?? finiteSeconds(frame?.duration_time);
    const currentPts = finiteSeconds(frame?.best_effort_timestamp_time);
    const nextPts = finiteSeconds(frames[index + 1]?.best_effort_timestamp_time);
    const timestampDuration = currentPts != null && nextPts != null && nextPts > currentPts
      ? nextPts - currentPts
      : null;
    const seconds = explicitDuration && explicitDuration > 0
      ? explicitDuration
      : timestampDuration && timestampDuration > 0
        ? timestampDuration
        : index > 0
          ? delays[index - 1] / 1000
          : 0.1;
    delays.push(normalizeDelayMs(seconds * 1000));
  }
  return delays;
}

function applyRasterPlaybackSpeed(
  pixels: Uint8Array,
  delaysMs: number[],
  requestedSpeed: number | undefined,
): { pixels: Uint8Array; delaysMs: number[] } {
  const speed = Math.max(0.5, Math.min(MAX_VIDEO_SPEED, finitePositive(requestedSpeed ?? 1, 1)));
  if (Math.abs(speed - 1) < 0.0001 || delaysMs.length <= 1) {
    return {
      pixels,
      delaysMs: delaysMs.map((delay) => normalizeDelayMs(delay / speed)),
    };
  }
  if (speed < 1) {
    return { pixels, delaysMs: delaysMs.map((delay) => normalizeDelayMs(delay / speed)) };
  }

  const sourceCount = delaysMs.length;
  const keepCount = Math.max(1, Math.round(sourceCount / speed));
  if (keepCount >= sourceCount) {
    return { pixels, delaysMs: delaysMs.map((delay) => normalizeDelayMs(delay / speed)) };
  }
  const output = new Uint8Array(keepCount * FRAME_BYTES);
  const outputDelays: number[] = [];
  for (let index = 0; index < keepCount; index += 1) {
    const sourceIndex = keepCount === 1
      ? 0
      : Math.round((index * (sourceCount - 1)) / (keepCount - 1));
    output.set(
      pixels.subarray(sourceIndex * FRAME_BYTES, (sourceIndex + 1) * FRAME_BYTES),
      index * FRAME_BYTES,
    );
    outputDelays.push(normalizeDelayMs(delaysMs[sourceIndex] / speed));
  }
  return { pixels: output, delaysMs: outputDelays };
}

export async function convertBrowserRasterWithFfmpeg(
  source: Blob,
  options: ConvertBrowserRasterOptions,
): Promise<BrowserFfmpegRasterResult> {
  if (source.size <= 0) throw new Error("图片/GIF 文件为空");
  const maxFrames = Math.max(1, Math.floor(options.maxFrames));
  const extension = inputExtension(
    options.fileName || "",
    source.type || "",
    options.mediaType === "gif" ? "gif" : "png",
  );
  const inputDir = "/v1pro-raster-input";
  const inputName = `source.${extension}`;
  const inputPath = `${inputDir}/${inputName}`;
  const outputPath = "/v1pro-raster-output.rgb565";
  const probePath = "/v1pro-raster-frames.json";
  let lastProgress = 0;
  const onProgress: ProgressEventCallback = ({ progress }) => {
    const normalized = Math.max(
      lastProgress,
      Math.min(0.98, 0.08 + Math.max(0, progress || 0) * 0.9),
    );
    lastProgress = normalized;
    options.onProgress?.(normalized);
  };

  const lease = await acquireBrowserFfmpeg(options.onStatus);
  const ffmpeg = lease.ffmpeg;
  let probeFrames: GifProbeFrame[] = [];
  let sourceGifDelays: number[] = [];
  try {
    ffmpeg.on("progress", onProgress);
    await ffmpeg.createDir(inputDir);
    await ffmpeg.mount(
      FFFSType.WORKERFS,
      { blobs: [{ name: inputName, data: source }] },
      inputDir,
    );

    options.onProgress?.(0);
    if (options.mediaType === "gif") {
      options.onStatus?.("正在读取 GIF 原始帧时序…");
      try {
        sourceGifDelays = await readGifFrameDelays(source);
      } catch {
        // Keep FFprobe as a compatibility fallback for unusual GIF containers.
        try {
          const probeExitCode = await ffmpeg.ffprobe([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "frame=best_effort_timestamp_time,pkt_duration_time,duration_time",
            "-of",
            "json",
            inputPath,
            "-o",
            probePath,
          ]);
          if (probeExitCode === 0) {
            const probeOutput = await ffmpeg.readFile(probePath, "utf8");
            const probeText = typeof probeOutput === "string"
              ? probeOutput
              : new TextDecoder().decode(probeOutput);
            const parsed = JSON.parse(probeText) as { frames?: GifProbeFrame[] };
            probeFrames = Array.isArray(parsed.frames) ? parsed.frames : [];
          }
        } catch {
          // Conversion can continue with timestamp-derived or default delays.
          probeFrames = [];
        }
      }
      options.onProgress?.(0.08);
    }

    options.onStatus?.(
      options.mediaType === "gif"
        ? "正在使用 FFmpeg 解码、缩放、调色 GIF…"
        : "正在使用 FFmpeg 解码、缩放、调色图片…",
    );
    const filters = [
      ...flattenRasterAlphaToBlack(),
      ...rotationFilters(options.rotationDeg ?? 0),
      ...resizeFilters(options.fitMode ?? "fill", options.scalePercent),
      ...colorFilters(options.colorProfile ?? "normal"),
      "setsar=1",
    ];
    const execArgs = ["-hide_banner", "-loglevel", "error"];
    if (options.mediaType === "gif") {
      // Decode one GIF cycle only; animated GIF loop metadata must not make
      // FFmpeg emit duplicate cycles until the device frame budget is full.
      execArgs.push("-ignore_loop", "1");
    }
    execArgs.push(
      "-i",
      inputPath,
      "-an",
      "-vf",
      filters.join(","),
      "-frames:v",
      String(options.mediaType === "gif"
        ? Math.max(maxFrames, Math.ceil(maxFrames * Math.max(1, options.playbackSpeed ?? 1)))
        : 1),
      "-vsync",
      "0",
      "-pix_fmt",
      "rgb565be",
      "-sws_flags",
      "lanczos+accurate_rnd+full_chroma_int",
      "-f",
      "rawvideo",
      outputPath,
    );
    const exitCode = await ffmpeg.exec(execArgs);
    if (exitCode !== 0) {
      throw new Error(`FFmpeg 转换失败（代码 ${exitCode}）`);
    }

    const output = await ffmpeg.readFile(outputPath);
    if (!(output instanceof Uint8Array)) {
      throw new Error("FFmpeg 输出格式异常");
    }
    const availableFrames = Math.floor(output.byteLength / FRAME_BYTES);
    const decodedFrameCount = Math.min(
      availableFrames,
      options.mediaType === "gif"
        ? Math.max(maxFrames, Math.ceil(maxFrames * Math.max(1, options.playbackSpeed ?? 1)))
        : 1,
    );
    if (decodedFrameCount < 1) {
      throw new Error("FFmpeg 未输出有效图片帧");
    }
    const decodedPixels = output.slice(0, decodedFrameCount * FRAME_BYTES);
    const decodedDelays = options.mediaType === "gif"
      ? sourceGifDelays.length >= decodedFrameCount
        ? sourceGifDelays.slice(0, decodedFrameCount)
        : gifDelaysFromProbe(probeFrames, decodedFrameCount)
      : [100];
    const adjusted = applyRasterPlaybackSpeed(decodedPixels, decodedDelays, options.playbackSpeed);
    const frameCount = Math.min(maxFrames, adjusted.delaysMs.length);
    const pixels = adjusted.pixels.slice(0, frameCount * FRAME_BYTES);
    const delaysMs = adjusted.delaysMs.slice(0, frameCount);
    const packed = packGfm1Pixels(pixels, delaysMs);
    const packedBuffer = packed.buffer.slice(
      packed.byteOffset,
      packed.byteOffset + packed.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([packedBuffer], { type: "application/x-v1pro-gfm1" });
    const sourceFrameCount = sourceGifDelays.length || probeFrames.length;
    const wasTruncated = options.mediaType === "gif" && sourceFrameCount > decodedFrameCount;
    const speed = Math.max(0.5, Math.min(MAX_VIDEO_SPEED, options.playbackSpeed ?? 1));
    const speedNote = Math.abs(speed - 1) < 0.0001 ? "" : ` · ${speed.toFixed(2)}×`;
    const note = options.mediaType === "gif"
      ? `FFmpeg 本地转换 · ${frameCount} 帧${speedNote}${wasTruncated ? ` · 已按设备容量截取` : ""}`
      : "FFmpeg 本地转换 · 1 帧";
    options.onProgress?.(1);
    return {
      blob,
      frames: options.includeFrames
        ? Array.from({ length: frameCount }, (_, index) => (
          pixels.slice(index * FRAME_BYTES, (index + 1) * FRAME_BYTES)
        ))
        : undefined,
      delaysMs,
      frameCount,
      totalBytes: blob.size,
      note,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "未知错误");
    throw new Error(`浏览器 FFmpeg 图片/GIF 转换失败：${message}`);
  } finally {
    try { ffmpeg.off("progress", onProgress); } catch { /* worker may already be gone */ }
    try { await ffmpeg.deleteFile(outputPath); } catch { /* output may not exist */ }
    try { await ffmpeg.deleteFile(probePath); } catch { /* probe may not exist */ }
    try { await ffmpeg.unmount(inputDir); } catch { /* mount may not exist */ }
    try { await ffmpeg.deleteDir(inputDir); } catch { /* directory may not exist */ }
    lease.release();
  }
}

export async function convertBrowserVideoWithFfmpeg(
  source: Blob,
  options: ConvertBrowserVideoOptions,
): Promise<BrowserFfmpegVideoResult> {
  if (source.size <= 0) throw new Error("视频文件为空");
  if (source.size > MAX_BROWSER_DIRECT_TRANSFER_VIDEO_BYTES) {
    throw new Error("网页 FFmpeg 转换暂支持 50MB 以内的视频");
  }

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

  const lease = await acquireBrowserFfmpeg(options.onStatus);
  const ffmpeg = lease.ffmpeg;
  try {
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
    lease.release();
  }
}
