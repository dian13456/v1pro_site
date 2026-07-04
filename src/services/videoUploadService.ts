import { probeVideoBrowserCompatibility } from "../utils/videoCodecProbe";
import { getAuthState, hasValidLocalAuth } from "./authService";
import { API_BASE, apiFetch, formatClientError } from "./httpClient";
import { isStaticMode } from "./runtimeMode";
import { ImageReviewPendingError } from "./aiImageService";

export const MAX_VIDEO_UPLOAD_BYTES = 20 * 1024 * 1024;

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
    const video = await loadVideoFrame(objectUrl);
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

function loadVideoFrame(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.onerror = () => reject(new Error("无法读取视频文件"));
    video.onloadedmetadata = () => {
      const seekTime = Number.isFinite(video.duration) && video.duration > 0
        ? Math.min(0.5, video.duration * 0.1)
        : 0.1;
      video.currentTime = seekTime;
    };
    video.onseeked = () => resolve(video);
    video.src = src;
  });
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
  if (file.size <= 0 || file.size > MAX_VIDEO_UPLOAD_BYTES) {
    throw new Error(`视频文件不能超过 ${Math.floor(MAX_VIDEO_UPLOAD_BYTES / (1024 * 1024))}MB`);
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

  const baseName = file.name.replace(/\.[^.]+$/i, "");
  const title = (options.title || "").trim() || baseName;
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

  options.onProgress?.("申请上传地址...");
  const session = await createVideoUploadSession(file);
  if (!session.success || !session.sessionId) {
    throw new Error(session.message || "无法创建上传会话");
  }

  options.onProgress?.("上传视频...");
  await uploadSessionFile(session.sessionId, "video", file, file.name);

  options.onProgress?.("生成并上传封面...");
  const coverBlob = await extractVideoCoverJpeg(file);
  await uploadSessionFile(session.sessionId, "cover", coverBlob, "cover.jpg");

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
