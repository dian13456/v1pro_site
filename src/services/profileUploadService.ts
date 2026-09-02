import type { MaterialType, ResourceItem } from "../types/resource";
import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { parseResourceList } from "./resourceService";
import { isStaticMode } from "./runtimeMode";

export type UploadReviewStatus = "pending" | "rejected";

export interface ProfileUploadReview {
  reviewId: string;
  status: UploadReviewStatus;
  title: string;
  description?: string;
  materialType: MaterialType;
  image: string;
  createdAt: string;
  previewUrl?: string;
  reviewNote?: string;
  author?: string;
  columnTag?: string;
}

export interface ProfileUploadsPayload {
  success?: boolean;
  published?: unknown;
  reviews?: unknown;
  message?: string;
}

export interface ProfileUploadsState {
  published: ResourceItem[];
  reviews: ProfileUploadReview[];
}

function normalizeReviewStatus(raw: unknown): UploadReviewStatus | null {
  const status = String(raw || "").trim().toLowerCase();
  if (status === "pending" || status === "rejected") {
    return status;
  }
  return null;
}

function normalizeMaterialType(raw: unknown): MaterialType {
  const value = String(raw || "").trim().toLowerCase();
  if (value === "video" || value === "gif" || value === "image" || value === "v1pro-pack") {
    return value;
  }
  return "image";
}

function parseReviewRecords(payload: unknown): ProfileUploadReview[] {
  if (!Array.isArray(payload)) return [];
  const result: ProfileUploadReview[] = [];
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const reviewId = String(record.reviewId || "").trim();
    const status = normalizeReviewStatus(record.status);
    const title = String(record.title || "").trim();
    const image = String(record.image || "").trim();
    const createdAt = String(record.createdAt || "").trim();
    if (!reviewId || !status || !title || !image || !createdAt) continue;
    result.push({
      reviewId,
      status,
      title,
      description: String(record.description || "").trim() || undefined,
      materialType: normalizeMaterialType(record.materialType),
      image,
      createdAt,
      previewUrl: String(record.previewUrl || "").trim() || undefined,
      reviewNote: String(record.reviewNote || "").trim() || undefined,
      author: String(record.author || "").trim() || undefined,
      columnTag: String(record.columnTag || "").trim() || undefined,
    });
  }
  return result;
}

export async function fetchMyUploads(): Promise<ProfileUploadsState> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  if (isStaticMode()) {
    return { published: [], reviews: [] };
  }

  const auth = getAuthState();
  if (!auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  const payload = await apiFetch<ProfileUploadsPayload>("/api/profile/uploads", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
  });

  if (payload.success === false) {
    throw new Error(payload.message || "加载上传记录失败");
  }

  return {
    published: parseResourceList(payload.published),
    reviews: parseReviewRecords(payload.reviews),
  };
}

export function formatUploadTimestamp(raw: string): string {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function materialTypeLabel(materialType: MaterialType): string {
  switch (materialType) {
    case "video":
      return "视频";
    case "gif":
      return "GIF";
    case "v1pro-pack":
      return "V1PRO 包";
    default:
      return "图片";
  }
}

export function uploadStatusLabel(status: UploadReviewStatus): string {
  return status === "pending" ? "审核中" : "未通过";
}

export type ProfileUploadDeleteKind = "published" | "review";

export interface DeleteMyUploadInput {
  kind: ProfileUploadDeleteKind;
  resourceId?: number | string;
  reviewId?: string;
}

export interface RenameMyUploadInput {
  kind: ProfileUploadDeleteKind;
  title: string;
  resourceId?: number | string;
  reviewId?: string;
}

export async function renameMyUpload(input: RenameMyUploadInput): Promise<string> {
  const title = input.title.trim();
  if (!title) {
    throw new Error("素材标题不能为空");
  }
  if ([...title].length > 80) {
    throw new Error("素材标题不能超过 80 个字符");
  }
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  if (isStaticMode()) {
    throw new Error("静态模式下无法修改标题");
  }

  const auth = getAuthState();
  if (!auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  const payload = await apiFetch<{ success?: boolean; message?: string; title?: string }>(
    "/api/profile/uploads/title",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        kind: input.kind,
        title,
        resourceId: input.kind === "published" ? String(input.resourceId ?? "") : undefined,
        reviewId: input.kind === "review" ? input.reviewId : undefined,
      }),
    },
  );
  if (payload.success === false) {
    throw new Error(payload.message || "修改标题失败");
  }
  return String(payload.title || title).trim();
}

export interface DeleteMyUploadResult {
  message: string;
  cleanupComplete: boolean;
  cleanupWarnings: string[];
}

export async function deleteMyUpload(input: DeleteMyUploadInput): Promise<DeleteMyUploadResult> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  if (isStaticMode()) {
    throw new Error("静态模式下无法删除素材");
  }

  const auth = getAuthState();
  if (!auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  const payload = await apiFetch<{
    success?: boolean;
    message?: string;
    cleanupComplete?: boolean;
    cleanupWarnings?: string[];
  }>("/api/profile/uploads/delete", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      kind: input.kind,
      resourceId: input.kind === "published" ? String(input.resourceId ?? "") : undefined,
      reviewId: input.kind === "review" ? input.reviewId : undefined,
    }),
  });

  if (payload.success === false) {
    throw new Error(payload.message || "删除失败");
  }
  return {
    message: payload.message || "素材已删除",
    cleanupComplete: payload.cleanupComplete !== false,
    cleanupWarnings: Array.isArray(payload.cleanupWarnings)
      ? payload.cleanupWarnings.filter((item): item is string => typeof item === "string" && item.trim() !== "")
      : [],
  };
}
