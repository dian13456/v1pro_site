import { importWithRetry } from "../utils/dynamicImportRecovery";
import {
  convertBrowserRasterWithFfmpeg,
  convertBrowserVideoWithFfmpeg,
  planBrowserFfmpegVideo,
  probeBrowserVideoDuration,
  type BrowserVideoColorProfile,
  type BrowserVideoFitMode,
} from "./browserFfmpegVideoService";
import { readGifFrameDelays } from "./gifFrameTiming";

const GFM1_HEADER_BYTES = 56;
const VIDEO_COMPAT_FPS = 20;
const VIDEO_COMPAT_MAX_SECONDS = 15;
const MAX_AUTOMATIC_SPEED = 10;

export interface LocalAlbumTransferItem {
  file: File;
  holdMs: number;
}

export interface PrepareLocalAlbumOptions {
  maxFrames: number;
  fitMode?: BrowserVideoFitMode;
  scalePercent?: number;
  colorProfile?: BrowserVideoColorProfile;
  resolveRotation?: (file: File) => Promise<0 | 90 | 180 | 270>;
  onStatus?: (message: string) => void;
  onProgress?: (ratio: number) => void;
}

export interface PreparedLocalAlbum {
  blob: Blob;
  frameCount: number;
  itemCount: number;
  note: string;
}

type LocalAlbumKind = "image" | "gif" | "video";

interface AlbumMetadata {
  item: LocalAlbumTransferItem;
  kind: LocalAlbumKind;
  rawFrames: number;
  sourceDuration?: number;
  outputFrames: number;
}

type BrowserGfm1Module = {
  buildGfm1Blob: (frames: Uint8Array[], delaysMs: number[]) => Uint8Array;
};

let browserGfm1Promise: Promise<BrowserGfm1Module> | null = null;

function loadBrowserGfm1Module(): Promise<BrowserGfm1Module> {
  if (!browserGfm1Promise) {
    browserGfm1Promise = importWithRetry(
      () =>
        // @ts-expect-error Browser SDK is maintained as a checked-in JavaScript module.
        import("@v1pro-webusb/v1pro-gfm1.js") as Promise<BrowserGfm1Module>,
    ).catch((error: unknown) => {
      browserGfm1Promise = null;
      throw error;
    });
  }
  return browserGfm1Promise;
}

function albumKind(file: File): LocalAlbumKind {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (type.startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(name)) return "video";
  if (type === "image/gif" || name.endsWith(".gif")) return "gif";
  if (type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(name)) return "image";
  throw new Error(`不支持的相册素材：${file.name}`);
}

function normalizeHoldMs(value: number): number {
  if (!Number.isFinite(value)) return 500;
  return Math.max(100, Math.min(65_000, Math.round(value)));
}

function allocateDynamicFrames(rawCounts: number[], frameBudget: number): number[] {
  if (rawCounts.length === 0) return [];
  const minimum = rawCounts.map((count) => Math.max(1, Math.ceil(count / MAX_AUTOMATIC_SPEED)));
  const minimumTotal = minimum.reduce((sum, count) => sum + count, 0);
  if (minimumTotal > frameBudget) {
    throw new Error(
      `设备容量不足：动态素材至少需要 ${minimumTotal} 张画面，当前只剩 ${frameBudget} 张。请减少 GIF/视频或缩短素材。`,
    );
  }

  const counts = minimum.slice();
  let remaining = frameBudget - minimumTotal;
  while (remaining > 0) {
    let candidate = -1;
    let candidateScore = -1;
    for (let index = 0; index < rawCounts.length; index += 1) {
      if (counts[index] >= rawCounts[index]) continue;
      const score = rawCounts[index] / counts[index];
      if (score > candidateScore) {
        candidate = index;
        candidateScore = score;
      }
    }
    if (candidate < 0) break;
    counts[candidate] += 1;
    remaining -= 1;
  }
  return counts;
}

async function readGfm1Frames(blob: Blob): Promise<{ frames: Uint8Array[]; delaysMs: number[] }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength < GFM1_HEADER_BYTES || String.fromCharCode(...bytes.slice(0, 4)) !== "GFM1") {
    throw new Error("相册视频转换结果不是有效的 GFM1 文件");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frameWidth = view.getUint16(6, true);
  const frameHeight = view.getUint16(8, true);
  const frameCount = view.getUint16(10, true);
  const frameBytes = frameWidth * frameHeight * 2;
  const pixelOffset = GFM1_HEADER_BYTES + frameCount * 2;
  const expectedBytes = pixelOffset + frameCount * frameBytes;
  if (frameWidth < 1 || frameHeight < 1 || frameCount < 1 || bytes.byteLength < expectedBytes) {
    throw new Error("相册视频转换结果不完整");
  }
  const delaysMs = Array.from(
    { length: frameCount },
    (_, index) => view.getUint16(GFM1_HEADER_BYTES + index * 2, true),
  );
  const frames = Array.from({ length: frameCount }, (_, index) => {
    const start = pixelOffset + index * frameBytes;
    return bytes.slice(start, start + frameBytes);
  });
  return { frames, delaysMs };
}

export async function prepareLocalAlbumGfm1(
  items: LocalAlbumTransferItem[],
  options: PrepareLocalAlbumOptions,
): Promise<PreparedLocalAlbum> {
  if (items.length === 0) throw new Error("请先向相册添加素材");
  const maxFrames = Math.max(1, Math.floor(options.maxFrames));
  if (items.length > maxFrames) {
    throw new Error(`当前设备最多约 ${maxFrames} 张画面，相册已有 ${items.length} 个素材`);
  }

  options.onStatus?.("正在分析相册素材…");
  options.onProgress?.(0.01);
  const metadata: AlbumMetadata[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const kind = albumKind(item.file);
    let rawFrames = 1;
    let sourceDuration: number | undefined;
    if (kind === "gif") {
      rawFrames = Math.max(1, (await readGifFrameDelays(item.file)).length);
    } else if (kind === "video") {
      sourceDuration = await probeBrowserVideoDuration(item.file);
      rawFrames = Math.max(1, Math.ceil(Math.min(sourceDuration, VIDEO_COMPAT_MAX_SECONDS) * VIDEO_COMPAT_FPS));
    }
    metadata.push({ item, kind, rawFrames, sourceDuration, outputFrames: kind === "image" ? 1 : 0 });
    options.onProgress?.(0.02 + ((index + 1) / items.length) * 0.08);
  }

  const staticFrameCount = metadata.filter((entry) => entry.kind === "image").length;
  const dynamicEntries = metadata.filter((entry) => entry.kind !== "image");
  const dynamicBudget = maxFrames - staticFrameCount;
  const allocated = allocateDynamicFrames(dynamicEntries.map((entry) => entry.rawFrames), dynamicBudget);
  dynamicEntries.forEach((entry, index) => {
    entry.outputFrames = allocated[index];
  });

  const allFrames: Uint8Array[] = [];
  const allDelaysMs: number[] = [];
  let videoCount = 0;
  let gifCount = 0;
  for (let index = 0; index < metadata.length; index += 1) {
    const entry = metadata[index];
    const file = entry.item.file;
    const rotationDeg = options.resolveRotation ? await options.resolveRotation(file) : 0;
    const itemStart = 0.1 + (index / metadata.length) * 0.78;
    const itemSpan = 0.78 / metadata.length;
    options.onStatus?.(`正在转换相册素材 ${index + 1}/${metadata.length}：${file.name}`);

    let decoded: { frames: Uint8Array[]; delaysMs: number[] };
    if (entry.kind === "video") {
      videoCount += 1;
      const duration = Math.min(entry.sourceDuration || VIDEO_COMPAT_MAX_SECONDS, VIDEO_COMPAT_MAX_SECONDS);
      const plan = planBrowserFfmpegVideo(duration, entry.outputFrames, VIDEO_COMPAT_FPS, 1);
      const converted = await convertBrowserVideoWithFfmpeg(file, {
        plan,
        fileName: file.name,
        fitMode: options.fitMode,
        rotationDeg,
        scalePercent: options.scalePercent,
        colorProfile: options.colorProfile,
        onStatus: options.onStatus,
        onProgress: (ratio) => options.onProgress?.(itemStart + ratio * itemSpan),
      });
      decoded = await readGfm1Frames(converted.blob);
    } else {
      if (entry.kind === "gif") gifCount += 1;
      const converted = await convertBrowserRasterWithFfmpeg(file, {
        fileName: file.name,
        mediaType: entry.kind,
        maxFrames: entry.outputFrames,
        fitMode: options.fitMode,
        rotationDeg,
        scalePercent: options.scalePercent,
        playbackSpeed: entry.kind === "gif" ? entry.rawFrames / entry.outputFrames : 1,
        colorProfile: options.colorProfile,
        includeFrames: true,
        onStatus: options.onStatus,
        onProgress: (ratio) => options.onProgress?.(itemStart + ratio * itemSpan),
      });
      if (!converted.frames?.length) throw new Error(`素材“${file.name}”没有可写入的画面`);
      decoded = { frames: converted.frames, delaysMs: converted.delaysMs.slice() };
    }

    if (entry.kind === "image") {
      decoded.delaysMs[0] = normalizeHoldMs(entry.item.holdMs);
    } else {
      const last = decoded.delaysMs.length - 1;
      decoded.delaysMs[last] = Math.min(0xffff, decoded.delaysMs[last] + normalizeHoldMs(entry.item.holdMs));
    }
    allFrames.push(...decoded.frames);
    allDelaysMs.push(...decoded.delaysMs);
  }

  if (allFrames.length > maxFrames) {
    throw new Error(`相册实际需要 ${allFrames.length} 张画面，超过设备的 ${maxFrames} 张容量`);
  }
  options.onStatus?.(`正在打包相册：${items.length} 个素材 · ${allFrames.length} 张画面…`);
  options.onProgress?.(0.92);
  const { buildGfm1Blob } = await loadBrowserGfm1Module();
  const packed = buildGfm1Blob(allFrames, allDelaysMs);
  const packedBuffer = packed.buffer.slice(
    packed.byteOffset,
    packed.byteOffset + packed.byteLength,
  ) as ArrayBuffer;
  const notes = [
    `${items.length} 个素材`,
    `${allFrames.length} 张画面`,
    videoCount ? `${videoCount} 个视频采用 20fps / 前15秒兼容模式` : "",
    gifCount ? `${gifCount} 个 GIF 保留动画` : "",
  ].filter(Boolean);
  options.onProgress?.(1);
  return {
    blob: new Blob([packedBuffer], { type: "application/x-v1pro-gfm1" }),
    frameCount: allFrames.length,
    itemCount: items.length,
    note: notes.join(" · "),
  };
}
