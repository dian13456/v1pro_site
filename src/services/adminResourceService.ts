import { apiFetch } from "./httpClient";

export interface AdminDeleteResourceResult {
  message: string;
  cleanupComplete: boolean;
  cleanupWarnings: string[];
}

export interface AdminResetUploaderQuotaResult {
  message: string;
  resourceId: number;
  shareCount: number;
  shareLimit: number;
  shareRemaining: number;
}

export async function adminDeleteResource(
  adminToken: string,
  resourceId: number,
): Promise<AdminDeleteResourceResult> {
  if (!adminToken.trim()) {
    throw new Error("管理员登录已失效，请重新登录");
  }
  if (!Number.isSafeInteger(resourceId) || resourceId <= 0) {
    throw new Error("素材编号无效");
  }
  const payload = await apiFetch<{
    success?: boolean;
    message?: string;
    cleanupComplete?: boolean;
    cleanupWarnings?: unknown;
  }>(`/api/admin/resources/${encodeURIComponent(String(resourceId))}`, {
    method: "DELETE",
    headers: { "X-Review-Admin-Token": adminToken.trim() },
  });
  if (payload.success === false) {
    throw new Error(payload.message || "删除素材失败");
  }
  return {
    message: payload.message || "管理员已永久删除素材",
    cleanupComplete: payload.cleanupComplete !== false,
    cleanupWarnings: Array.isArray(payload.cleanupWarnings)
      ? payload.cleanupWarnings.filter((item): item is string => typeof item === "string" && item.trim() !== "")
      : [],
  };
}

export async function adminResetUploaderQuota(
  adminToken: string,
  resourceId: number,
): Promise<AdminResetUploaderQuotaResult> {
  if (!adminToken.trim()) {
    throw new Error("管理员登录已失效，请重新登录");
  }
  if (!Number.isSafeInteger(resourceId) || resourceId <= 0) {
    throw new Error("素材编号无效");
  }
  const payload = await apiFetch<{
    success?: boolean;
    message?: string;
    resourceId?: unknown;
    shareCount?: unknown;
    shareLimit?: unknown;
    shareRemaining?: unknown;
  }>(`/api/admin/resources/${encodeURIComponent(String(resourceId))}/reset-upload-quota`, {
    method: "POST",
    headers: { "X-Review-Admin-Token": adminToken.trim() },
  });
  if (payload.success !== true) {
    throw new Error(payload.message || "重置上传额度失败");
  }

  const numericValue = (value: unknown) => {
    if (value == null || value === "") return null;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
  };
  const responseResourceId = numericValue(payload.resourceId);
  const shareCount = numericValue(payload.shareCount);
  const shareLimit = numericValue(payload.shareLimit);
  const shareRemaining = numericValue(payload.shareRemaining);
  if (
    responseResourceId == null
    || responseResourceId !== resourceId
    || shareCount == null
    || shareLimit == null
    || shareRemaining == null
  ) {
    throw new Error("服务器返回的上传额度数据无效，请刷新后重试");
  }
  return {
    message: payload.message || "已将该上传人的剩余上传额度重置为 50 次",
    resourceId: responseResourceId,
    shareCount,
    shareLimit,
    shareRemaining,
  };
}
