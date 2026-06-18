import { getAuthState, hasValidLocalAuth } from "./authService";
import { API_BASE, apiFetch, formatClientError } from "./httpClient";
import { isStaticMode } from "./runtimeMode";
import { ImageReviewPendingError } from "./aiImageService";

export const MAX_GIF_UPLOAD_BYTES = 15 * 1024 * 1024;

export interface GifUploadSessionResponse {
  success: boolean;
  message?: string;
  sessionId?: string;
  gifUploadUrl?: string;
  coverUploadUrl?: string;
  maxBytes?: number;
}

export interface GifShareResponse {
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

function throwIfPendingReview(payload: GifShareResponse): void {
  if (!payload.pendingReview) return;
  throw new ImageReviewPendingError(
    payload.message || "GIF 已提交人工复核，请等待管理员审核",
    payload.reviewId || "",
    payload.label,
    payload.subLabel,
    payload.score
  );
}

export async function extractGifCoverJpeg(file: File, maxEdge = 1280, quality = 0.85): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("无法生成 GIF 封面");
    }
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, "image/jpeg", quality);
    if (!blob) {
      throw new Error("无法生成 GIF 封面");
    }
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("无法读取 GIF 文件"));
    img.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

async function uploadSessionFile(
  sessionId: string,
  kind: "gif" | "cover",
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
    response = await fetch(`${API_BASE}/api/user-gif/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth?.token || ""}`,
      },
      body: form,
    });
  } catch (err) {
    throw new Error(formatClientError(err, "上传失败，请检查网络连接后重试"));
  }

  let payload: GifShareResponse | null = null;
  try {
    payload = (await response.json()) as GifShareResponse;
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.success) {
    throw new Error(payload?.message || `上传失败（HTTP ${response.status})`);
  }
}

export async function createGifUploadSession(file: File): Promise<GifUploadSessionResponse> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  if (isStaticMode()) {
    throw new Error("静态模式下无法上传");
  }
  if (!file.name.toLowerCase().endsWith(".gif")) {
    throw new Error("仅支持 .gif 文件");
  }
  if (file.size <= 0 || file.size > MAX_GIF_UPLOAD_BYTES) {
    throw new Error(`GIF 文件不能超过 ${Math.floor(MAX_GIF_UPLOAD_BYTES / (1024 * 1024))}MB`);
  }

  const auth = getAuthState();
  return apiFetch<GifUploadSessionResponse>("/api/user-gif/upload-session", {
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

export async function shareGifToCatalog(
  file: File,
  options: { title?: string; description?: string; onProgress?: (stage: string) => void } = {}
): Promise<GifShareResponse> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  const title = (options.title || "").trim() || file.name.replace(/\.gif$/i, "");
  const description = (options.description || "").trim() || title;
  const auth = getAuthState();

  if (isStaticMode()) {
    options.onProgress?.("开发模式提交...");
    const payload = await apiFetch<GifShareResponse>("/api/user-gif/share", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth?.token || ""}`,
      },
      body: JSON.stringify({
        sessionId: "dev-session",
        title,
        description,
      }),
    });
    throwIfPendingReview(payload);
    if (!payload.success) {
      throw new Error(payload.message || "GIF 分享失败");
    }
    return payload;
  }

  options.onProgress?.("申请上传地址...");
  const session = await createGifUploadSession(file);
  if (!session.success || !session.sessionId) {
    throw new Error(session.message || "无法创建上传会话");
  }

  options.onProgress?.("上传 GIF...");
  await uploadSessionFile(session.sessionId, "gif", file, file.name);

  options.onProgress?.("生成并上传封面...");
  const coverBlob = await extractGifCoverJpeg(file);
  await uploadSessionFile(session.sessionId, "cover", coverBlob, "cover.jpg");

  options.onProgress?.("提交分享...");
  const payload = await apiFetch<GifShareResponse>("/api/user-gif/share", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth?.token || ""}`,
    },
    body: JSON.stringify({
      sessionId: session.sessionId,
      title,
      description,
    }),
  });

  throwIfPendingReview(payload);

  if (!payload.success) {
    throw new Error(payload.message || "GIF 分享失败");
  }
  return payload;
}
