import { FFFSType, type FFmpeg, type ProgressEventCallback } from "@ffmpeg/ffmpeg";
import { probeBrowserVideoDuration } from "./browserFfmpegVideoService";
import { acquireBrowserFfmpeg } from "./ffmpegRuntime";

export const MAX_SHARE_VIDEO_SOURCE_BYTES = 400 * 1024 * 1024;
export const MAX_SHARE_VIDEO_OUTPUT_BYTES = 20 * 1024 * 1024;
const TARGET_SHARE_VIDEO_BYTES = 19 * 1024 * 1024;
const MIN_REASONABLE_VIDEO_BITRATE_KBPS = 48;

export interface BrowserVideoCompressionResult {
  file: File;
  compressed: boolean;
  sourceBytes: number;
  outputBytes: number;
}

function inputExtension(fileName: string, mimeType: string): string {
  const match = fileName.trim().toLowerCase().match(/\.(mp4|webm|mov|m4v)$/);
  if (match) return match[1];
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("quicktime")) return "mov";
  return "mp4";
}

function compressedFileName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "").trim() || "video";
  return `${stem}_web.mp4`;
}

function bitratePlan(duration: number, targetBytes: number) {
  const availableKbps = Math.max(
    80,
    Math.floor((targetBytes * 8 * 0.965) / Math.max(0.1, duration) / 1000),
  );
  const audioKbps = availableKbps >= 500 ? 96 : availableKbps >= 280 ? 64 : 32;
  const videoKbps = Math.min(
    20_000,
    Math.max(MIN_REASONABLE_VIDEO_BITRATE_KBPS, availableKbps - audioKbps),
  );
  return { videoKbps, audioKbps };
}

async function readOutputFile(ffmpeg: FFmpeg, outputPath: string): Promise<Uint8Array> {
  const output = await ffmpeg.readFile(outputPath);
  if (!(output instanceof Uint8Array) || output.byteLength < 16) {
    throw new Error("FFmpeg 未生成有效的压缩视频");
  }
  return output;
}

export async function compressVideoForCosUpload(
  source: File,
  options: {
    force?: boolean;
    onStatus?: (message: string) => void;
    onProgress?: (ratio: number) => void;
  } = {},
): Promise<BrowserVideoCompressionResult> {
  if (source.size <= 0) throw new Error("视频文件为空");
  if (source.size > MAX_SHARE_VIDEO_SOURCE_BYTES) {
    throw new Error("分享视频源文件不能超过 400MB");
  }
  if (!options.force && source.size <= TARGET_SHARE_VIDEO_BYTES) {
    return {
      file: source,
      compressed: false,
      sourceBytes: source.size,
      outputBytes: source.size,
    };
  }

  const duration = await probeBrowserVideoDuration(source);
  const inputDir = "/share-input";
  const inputName = `source.${inputExtension(source.name, source.type)}`;
  const inputPath = `${inputDir}/${inputName}`;
  const outputPath = "/share-output.mp4";
  let lastProgress = 0;
  let attemptBase = 0;
  let attemptWeight = 0.86;
  const onProgress: ProgressEventCallback = ({ progress }) => {
    const attemptRatio = Math.max(0, Math.min(0.99, progress || 0));
    const overall = Math.max(lastProgress, Math.min(0.98, attemptBase + attemptRatio * attemptWeight));
    lastProgress = overall;
    options.onProgress?.(overall);
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

    let targetBytes = Math.min(
      TARGET_SHARE_VIDEO_BYTES,
      Math.max(256 * 1024, source.size),
    );
    let output: Uint8Array<ArrayBufferLike> = new Uint8Array();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { videoKbps, audioKbps } = bitratePlan(duration, targetBytes);
      options.onStatus?.(
        attempt === 0
          ? "正在本地压缩视频至约 20MB…"
          : "正在校正视频大小，请稍候…",
      );
      try { await ffmpeg.deleteFile(outputPath); } catch { /* first attempt */ }
      const exitCode = await ffmpeg.exec([
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-vf",
        "scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p",
        "-fpsmax",
        "30",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-profile:v",
        "main",
        "-level",
        "4.0",
        "-b:v",
        `${videoKbps}k`,
        "-maxrate",
        `${Math.max(videoKbps, Math.round(videoKbps * 1.25))}k`,
        "-bufsize",
        `${Math.max(128, videoKbps * 2)}k`,
        "-c:a",
        "aac",
        "-b:a",
        `${audioKbps}k`,
        "-ac",
        "2",
        "-ar",
        "44100",
        "-movflags",
        "+faststart",
        "-sws_flags",
        "lanczos+accurate_rnd+full_chroma_int",
        outputPath,
      ]);
      if (exitCode !== 0) {
        throw new Error(`FFmpeg 压缩失败（代码 ${exitCode}）`);
      }
      output = await readOutputFile(ffmpeg, outputPath);
      if (output.byteLength <= MAX_SHARE_VIDEO_OUTPUT_BYTES) break;
      if (attempt === 0) {
        targetBytes = Math.max(
          2 * 1024 * 1024,
          Math.floor(TARGET_SHARE_VIDEO_BYTES * (TARGET_SHARE_VIDEO_BYTES / output.byteLength) * 0.94),
        );
        attemptBase = 0.86;
        attemptWeight = 0.12;
      }
    }

    if (output.byteLength > MAX_SHARE_VIDEO_OUTPUT_BYTES) {
      throw new Error(`压缩后视频仍超过 20MB（${(output.byteLength / 1024 / 1024).toFixed(1)}MB）`);
    }
    const packed = new Uint8Array(output.byteLength);
    packed.set(output);
    const file = new File(
      [packed.buffer],
      compressedFileName(source.name),
      { type: "video/mp4", lastModified: Date.now() },
    );
    options.onProgress?.(1);
    return {
      file,
      compressed: true,
      sourceBytes: source.size,
      outputBytes: file.size,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "未知错误");
    throw new Error(`浏览器视频压缩失败：${message}`);
  } finally {
    try { ffmpeg.off("progress", onProgress); } catch { /* worker may be unavailable */ }
    try { await ffmpeg.deleteFile(outputPath); } catch { /* output may not exist */ }
    try { await ffmpeg.unmount(inputDir); } catch { /* mount may not exist */ }
    try { await ffmpeg.deleteDir(inputDir); } catch { /* directory may not exist */ }
    lease.release();
  }
}
