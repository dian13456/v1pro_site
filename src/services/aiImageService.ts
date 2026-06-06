import type {
  AiImageResponse,
  AiImageShareResponse,
  AiImageTransferResponse,
  GeneratedAiImage,
  GenerateAiImagesResult,
} from "../types/aiImage";
import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";
import { spendDevCredits } from "./profileService";
import { launchV1ProTransfer, assertCosTransferUrl, fileNameFromTransferUrl } from "./v1proTransferService";

export class ImageReviewPendingError extends Error {
  readonly reviewId: string;
  readonly label?: string;
  readonly subLabel?: string;
  readonly score?: number;

  constructor(
    message: string,
    reviewId: string,
    label?: string,
    subLabel?: string,
    score?: number
  ) {
    super(message);
    this.name = "ImageReviewPendingError";
    this.reviewId = reviewId;
    this.label = label;
    this.subLabel = subLabel;
    this.score = score;
  }
}

function throwIfPendingReview(payload: {
  pendingReview?: boolean;
  reviewId?: string;
  message?: string;
  label?: string;
  subLabel?: string;
  score?: number;
}): void {
  if (!payload.pendingReview) return;
  throw new ImageReviewPendingError(
    payload.message || "图片已提交人工复核，请等待管理员审核",
    payload.reviewId || "",
    payload.label,
    payload.subLabel,
    payload.score
  );
}

export const MAX_PROMPT_LENGTH = 1500;
export const MAX_UPLOAD_IMAGE_BYTES = 8 * 1024 * 1024;
/** 分享/传输前压缩，长边上限（减轻 Base64 POST 超时） */
export const MAX_UPLOAD_SHARE_EDGE = 2048;
export const AI_IMAGE_ASPECT_RATIO = "16:9" as const;
export const AI_IMAGE_COUNT = 1;

const STARTER_PROMPTS = [
  "赛博朋克风格的霓虹城市夜景，雨夜反光",
  "可爱卡通猫咪，扁平插画，明亮配色",
  "极简几何抽象壁纸，渐变蓝紫色",
  "像素风游戏角色，8-bit 风格",
];

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("无法解析图片"));
    img.src = dataUrl;
  });
}

/** 选图分享/传输前压缩为 JPEG，避免大图 Base64 导致跨域 POST 超时。 */
export async function compressUploadDataUrl(
  dataUrl: string,
  maxEdge = MAX_UPLOAD_SHARE_EDGE,
  quality = 0.88
): Promise<string> {
  const img = await loadImageElement(dataUrl);
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 不可用");
  }
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

function normalizeBase64Image(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("data:")) return trimmed;
  return `data:image/jpeg;base64,${trimmed}`;
}

function createMockImage(prompt: string): GeneratedAiImage {
  const canvas = document.createElement("canvas");
  canvas.width = 360;
  canvas.height = 640;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 不可用");
  }

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#312e81");
  gradient.addColorStop(0.5, "#7c3aed");
  gradient.addColorStop(1, "#06b6d4");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "bold 24px sans-serif";
  ctx.fillText("AI 图片预览", 24, 48);
  ctx.font = "16px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  const text = prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt;
  wrapText(ctx, text, 24, 96, canvas.width - 48, 24);

  return {
    id: `mock-${Date.now()}`,
    dataUrl: canvas.toDataURL("image/jpeg", 0.92),
    source: "ai",
  };
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): void {
  const chars = Array.from(text);
  let line = "";
  let offsetY = y;
  for (const ch of chars) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line) {
      ctx.fillText(line, x, offsetY);
      line = ch;
      offsetY += lineHeight;
    } else {
      line = next;
    }
  }
  if (line) {
    ctx.fillText(line, x, offsetY);
  }
}

export function getStarterPrompts(): string[] {
  return STARTER_PROMPTS;
}

export async function generateAiImages(prompt: string): Promise<GenerateAiImagesResult> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new Error("请输入图片描述");
  }
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    throw new Error(`描述最多 ${MAX_PROMPT_LENGTH} 字`);
  }
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  const auth = getAuthState();
  const serial = auth?.serial || "";

  if (isStaticMode()) {
    const creditsRemaining = spendDevCredits(serial);
    return {
      images: [createMockImage(trimmed)],
      creditsRemaining,
    };
  }

  const payload = await apiFetch<AiImageResponse>("/api/ai-image", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth?.token || ""}`,
    },
    body: JSON.stringify({
      prompt: trimmed,
      aspectRatio: AI_IMAGE_ASPECT_RATIO,
      count: AI_IMAGE_COUNT,
    }),
  });

  throwIfPendingReview(payload);

  if (!payload.success) {
    throw new Error(payload.message || "AI 图片生成失败");
  }

  const images = (payload.images || [])
    .map((item, index) => {
      const dataUrl = normalizeBase64Image(item);
      if (!dataUrl) return null;
      return {
        id: `ai-${Date.now()}-${index}`,
        dataUrl,
        source: "ai" as const,
      };
    })
    .filter((item): item is GeneratedAiImage => item !== null);

  if (images.length === 0) {
    throw new Error("未收到有效图片");
  }
  return {
    images,
    creditsRemaining: payload.creditsRemaining,
  };
}

export function readLocalImageFile(file: File): Promise<GeneratedAiImage> {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error("请选择 JPG / PNG / WEBP 等图片文件"));
  }
  if (file.size > MAX_UPLOAD_IMAGE_BYTES) {
    return Promise.reject(new Error("图片不能超过 8MB"));
  }
  if (file.size < 16) {
    return Promise.reject(new Error("图片文件过小"));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      void (async () => {
        const rawDataUrl = typeof reader.result === "string" ? reader.result : "";
        if (!rawDataUrl.startsWith("data:image/")) {
          reject(new Error("无法读取图片内容"));
          return;
        }
        try {
          const dataUrl = await compressUploadDataUrl(rawDataUrl);
          resolve({
            id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            dataUrl,
            source: "upload",
            fileName: file.name.replace(/\.[^.]+$/, "") + ".jpg",
          });
        } catch (err) {
          reject(err instanceof Error ? err : new Error("图片压缩失败"));
        }
      })();
    };
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

export function downloadGeneratedImage(image: GeneratedAiImage, fileName = "ai-image.jpg"): void {
  const link = document.createElement("a");
  link.href = image.dataUrl;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function transferAiImageToDevice(
  image: GeneratedAiImage,
  fileName = "ai-image.jpg"
): Promise<void> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  if (isStaticMode()) {
    throw new Error("静态模式下无法传输到设备");
  }

  const auth = getAuthState();
  const payload = await apiFetch<AiImageTransferResponse & { pendingReview?: boolean; reviewId?: string; label?: string; subLabel?: string; score?: number }>(
    "/api/ai-image/transfer",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth?.token || ""}`,
      },
      body: JSON.stringify({
        imageBase64: image.dataUrl,
        fileName,
        source: image.source || "ai",
      }),
    }
  );

  throwIfPendingReview(payload);

  if (!payload.success || !payload.url) {
    throw new Error(payload.message || "无法获取传输链接");
  }
  assertCosTransferUrl(payload.url);

  launchV1ProTransfer(payload.url, {
    name: fileNameFromTransferUrl(payload.url),
    auto: true,
  });
}

export async function shareAiImageToCatalog(
  image: GeneratedAiImage,
  prompt: string
): Promise<AiImageShareResponse> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  if (isStaticMode()) {
    throw new Error("静态模式下无法分享");
  }

  const auth = getAuthState();
  const isUpload = image.source === "upload";
  const path = isUpload ? "/api/user-image/share" : "/api/ai-image/share";
  const body = isUpload
    ? {
        imageBase64: image.dataUrl,
        title: image.fileName || "用户上传图片",
        description: prompt.trim() || image.fileName || "用户上传图片",
      }
    : {
        imageBase64: image.dataUrl,
        prompt: prompt.trim(),
        source: "ai",
      };

  const payload = await apiFetch<AiImageShareResponse>(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth?.token || ""}`,
    },
    body: JSON.stringify(body),
  });

  throwIfPendingReview(payload);

  if (!payload.success) {
    throw new Error(payload.message || "分享失败");
  }
  return payload;
}
