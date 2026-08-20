import { probeVideoBrowserCompatibility } from "../utils/videoCodecProbe";
import { getAuthState, hasValidLocalAuth } from "./authService";
import { API_BASE, apiFetch, formatClientError } from "./httpClient";
import { isStaticMode } from "./runtimeMode";
import { ImageReviewPendingError } from "./aiImageService";
import {
  compressVideoForCosUpload,
  MAX_SHARE_VIDEO_OUTPUT_BYTES,
  MAX_SHARE_VIDEO_SOURCE_BYTES,
} from "./browserVideoUploadCompressionService";

/** Source file limit shown on the share page. The COS object remains <=20MB. */
export const MAX_VIDEO_UPLOAD_BYTES = MAX_SHARE_VIDEO_SOURCE_BYTES;
export const MAX_VIDEO_COS_UPLOAD_BYTES = MAX_SHARE_VIDEO_OUTPUT_BYTES;

const ALLOWED_VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".m4v"];

export interface VideoUploadSessionResponse {
  success: boolean;
  message?: string;
  sessionId?: string;
  videoUploadUrl?: string;
  coverUploadUrl?: string;
  maxBytes?: number;
}

export interface VideoShareResponse {
  success: boolean;
  message?: string;
  pendingReview?: boolean;
  reviewId?: string;
  label?: string;
  subLabel?: string;
  score?: number;
  resourceId?: number;
  downloadUrl?: string;
  title?: string;
  shareCount?: number;
  shareLimit?: number;
  shareRemaining?: number;
  shareUnlimited?: boolean;
}

function throwIfPendingReview(payload: VideoShareResponse): void {
  if (!payload.pendingReview) return;
  throw new ImageReviewPendingError(
    payload.message || "视频已提交人工复核，请等待管理员审核",
    payload.reviewId || "",
    payload.label,
    payload.subLabel,
    payload.score
  );
}

function isAllowedVideoFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return ALLOWED_VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export async function extractVideoCoverJpeg(file: File, maxEdge = 1280, quality = 0.85): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const video = await loadVideo(objectUrl);
    const coverTime = await selectVideoCoverTime(video);
    await seekVideoFrame(video, coverTime);
    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("无法生成视频封面");
    }
    ctx.drawImage(video, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    if (!blob) {
      throw new Error("无法生成视频封面");
    }
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.onerror = () => reject(new Error("无法读取视频文件"));
    video.onloadeddata = () => resolve(video);
    video.src = src;
  });
}

function buildVideoCoverSampleTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [0.1];

  const lastSafeTime = Math.max(0, duration - 0.05);
  const candidates = [
    Math.min(0.5, duration * 0.1),
    Math.min(1, duration * 0.2),
    duration * 0.35,
    duration * 0.5,
    duration * 0.75,
  ];
  const unique: number[] = [];
  for (const candidate of candidates) {
    const time = Math.max(0, Math.min(candidate, lastSafeTime));
    if (!unique.some((existing) => Math.abs(existing - time) < 0.05)) {
      unique.push(time);
    }
  }
  return unique.length > 0 ? unique : [0];
}

function seekVideoFrame(video: HTMLVideoElement, time: number): Promise<void> {
  const target = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.05)));
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && Math.abs(video.currentTime - target) < 0.01) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("读取视频封面超时"));
    }, 8_000);
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
    };
    const handleSeeked = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("无法读取视频封面帧"));
    };
    video.addEventListener("seeked", handleSeeked, { once: true });
    video.addEventListener("error", handleError, { once: true });
    video.currentTime = target;
  });
}

function scoreCurrentVideoFrame(video: HTMLVideoElement): number {
  const width = 96;
  const height = Math.max(1, Math.round(width * video.videoHeight / video.videoWidth));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0;

  ctx.drawImage(video, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  let visiblePixels = 0;
  let luminanceSum = 0;
  let luminanceSquareSum = 0;
  const pixelCount = pixels.length / 4;
  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    if (Math.max(red, green, blue) > 16) visiblePixels += 1;
    luminanceSum += luminance;
    luminanceSquareSum += luminance * luminance;
  }

  const mean = luminanceSum / pixelCount;
  const variance = Math.max(0, luminanceSquareSum / pixelCount - mean * mean);
  const visibleRatio = visiblePixels / pixelCount;
  // Non-black coverage is the primary signal; brightness and detail break close ties.
  return visibleRatio * 120 + mean * 0.15 + Math.min(80, Math.sqrt(variance)) * 0.5;
}

async function selectVideoCoverTime(video: HTMLVideoElement): Promise<number> {
  const candidates = buildVideoCoverSampleTimes(video.duration);
  let bestTime = candidates[0];
  let bestScore = -1;
  let successfulSamples = 0;

  for (const time of candidates) {
    try {
      await seekVideoFrame(video, time);
      const score = scoreCurrentVideoFrame(video);
      successfulSamples += 1;
      if (score > bestScore) {
        bestScore = score;
        bestTime = time;
      }
    } catch {
      // Some codecs reject individual seeks; continue with the remaining samples.
    }
  }

  if (successfulSamples === 0) {
    throw new Error("无法从视频中读取封面帧");
  }
  return bestTime;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

async function uploadSessionFile(
  sessionId: string,
  kind: "video" | "cover",
  blob: Blob,
  fileName: string
): Promise<void> {
  const auth = getAuthState();
  const form = new FormData();
  form.append("sessionId", sessionId);
  form.append("kind", kind);
  form.append("file", blob, fileName);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/user-video/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth?.token || ""}`,
      },
      body: form,
    });
  } catch (err) {
    throw new Error(formatClientError(err, "上传失败，请检查网络连接后重试"));
  }

  let payload: VideoShareResponse | null = null;
  try {
    payload = (await response.json()) as VideoShareResponse;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.success) {
    throw new Error(payload?.message || `上传失败（HTTP ${response.status})`);
  }
}

function uploadBlobDirectToCos(
  uploadUrl: string,
  blob: Blob,
  contentType: string,
  onProgress?: (ratio: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.timeout = 20 * 60 * 1000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.max(0, Math.min(1, event.loaded / event.total)));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
        return;
      }
      reject(new Error(`COS 直传失败（HTTP ${xhr.status}）`));
    };
    xhr.onerror = () => reject(new Error("COS 直传网络请求失败"));
    xhr.ontimeout = () => reject(new Error("COS 直传超时"));
    xhr.onabort = () => reject(new Error("COS 直传已取消"));
    xhr.send(blob);
  });
}

function videoContentType(fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".m4v")) return "video/x-m4v";
  return "video/mp4";
}

async function uploadWithCosFallback(
  session: VideoUploadSessionResponse,
  kind: "video" | "cover",
  blob: Blob,
  fileName: string,
  onStage?: (stage: string) => void,
): Promise<void> {
  const uploadUrl = kind === "video" ? session.videoUploadUrl : session.coverUploadUrl;
  if (uploadUrl) {
    try {
      await uploadBlobDirectToCos(
        uploadUrl,
        blob,
        kind === "video" ? videoContentType(fileName) : "image/jpeg",
        (ratio) => onStage?.(
          kind === "video"
            ? `正在直传 COS… ${Math.round(ratio * 100)}%`
            : `正在上传封面… ${Math.round(ratio * 100)}%`,
        ),
      );
      return;
    } catch {
      onStage?.("COS 直传不可用，正在切换兼容上传…");
    }
  }
  await uploadSessionFile(session.sessionId || "", kind, blob, fileName);
}

export async function createVideoUploadSession(file: File): Promise<VideoUploadSessionResponse> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  if (isStaticMode()) {
    throw new Error("静态模式下无法上传");
  }
  if (!isAllowedVideoFile(file)) {
    throw new Error("仅支持 .mp4、.webm、.mov、.m4v 文件");
  }
  if (file.size <= 0 || file.size > MAX_VIDEO_COS_UPLOAD_BYTES) {
    throw new Error(`压缩后视频不能超过 ${Math.floor(MAX_VIDEO_COS_UPLOAD_BYTES / (1024 * 1024))}MB`);
  }

  const codecProbe = await probeVideoBrowserCompatibility(file);
  if (!codecProbe.compatible) {
    throw new Error(codecProbe.reason || "视频编码不受支持，请上传 H.264 8-bit 的 MP4");
  }

  const auth = getAuthState();
  return apiFetch<VideoUploadSessionResponse>("/api/user-video/upload-session", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth?.token || ""}`,
    },
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
    }),
  });
}

export async function shareVideoToCatalog(
  file: File,
  options: { title?: string; description?: string; columnTag?: string; onProgress?: (stage: string) => void } = {}
): Promise<VideoShareResponse> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  const title = (options.title || "").trim();
  if (!title) {
    throw new Error("请填写素材标题");
  }
  const description = (options.description || "").trim() || title;
  const columnTag = (options.columnTag || "").trim();
  const auth = getAuthState();

  if (isStaticMode()) {
    options.onProgress?.("开发模式提交...");
    const payload = await apiFetch<VideoShareResponse>("/api/user-video/share", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth?.token || ""}`,
      },
      body: JSON.stringify({
        sessionId: "dev-session",
        title,
        description,
        columnTag,
      }),
    });
    throwIfPendingReview(payload);
    if (!payload.success) {
      throw new Error(payload.message || "视频分享失败");
    }
    return payload;
  }

  options.onProgress?.("正在检查视频信息…");
  const sourceCodec = await probeVideoBrowserCompatibility(file);
  const prepared = await compressVideoForCosUpload(file, {
    force: !sourceCodec.compatible,
    onStatus: options.onProgress,
    onProgress: (ratio) => options.onProgress?.(`正在本地压缩… ${Math.round(ratio * 100)}%`),
  });
  const uploadFile = prepared.file;
  if (prepared.compressed) {
    options.onProgress?.(
      `本地压缩完成：${(prepared.sourceBytes / 1024 / 1024).toFixed(1)}MB → ${(prepared.outputBytes / 1024 / 1024).toFixed(1)}MB`,
    );
  }

  options.onProgress?.("正在生成视频封面…");
  const coverBlob = await extractVideoCoverJpeg(uploadFile);

  options.onProgress?.("申请 COS 上传地址…");
  const session = await createVideoUploadSession(uploadFile);
  if (!session.success || !session.sessionId) {
    throw new Error(session.message || "无法创建上传会话");
  }

  options.onProgress?.("正在直传视频到 COS…");
  await uploadWithCosFallback(session, "video", uploadFile, uploadFile.name, options.onProgress);
  await uploadWithCosFallback(session, "cover", coverBlob, "cover.jpg", options.onProgress);

  options.onProgress?.("提交分享...");
  const payload = await apiFetch<VideoShareResponse>("/api/user-video/share", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth?.token || ""}`,
    },
    body: JSON.stringify({
      sessionId: session.sessionId,
      title,
      description,
      columnTag,
    }),
  });

  throwIfPendingReview(payload);

  if (!payload.success) {
    throw new Error(payload.message || "视频分享失败");
  }
  return payload;
}
