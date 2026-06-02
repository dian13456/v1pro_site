import type { AiImageAspectRatio, AiImageResponse, GeneratedAiImage } from "../types/aiImage";
import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";

export const MAX_PROMPT_LENGTH = 1500;

export const ASPECT_RATIO_OPTIONS: Array<{ value: AiImageAspectRatio; label: string }> = [
  { value: "9:16", label: "9:16 竖屏（推荐设备）" },
  { value: "1:1", label: "1:1 方形" },
  { value: "16:9", label: "16:9 横屏" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "2:3", label: "2:3" },
  { value: "3:2", label: "3:2" },
  { value: "21:9", label: "21:9 超宽" },
];

const STARTER_PROMPTS = [
  "赛博朋克风格的霓虹城市夜景，雨夜反光",
  "可爱卡通猫咪，扁平插画，明亮配色",
  "极简几何抽象壁纸，渐变蓝紫色",
  "像素风游戏角色，8-bit 风格",
];

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

export async function generateAiImages(
  prompt: string,
  aspectRatio: AiImageAspectRatio,
  count = 1
): Promise<GeneratedAiImage[]> {
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

  if (isStaticMode()) {
    return [createMockImage(trimmed)];
  }

  const auth = getAuthState();
  const payload = await apiFetch<AiImageResponse>("/api/ai-image", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth?.token || ""}`,
    },
    body: JSON.stringify({
      prompt: trimmed,
      aspectRatio,
      count,
    }),
  });

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
      };
    })
    .filter((item): item is GeneratedAiImage => item !== null);

  if (images.length === 0) {
    throw new Error("未收到有效图片");
  }
  return images;
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
