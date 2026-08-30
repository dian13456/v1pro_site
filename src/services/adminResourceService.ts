import { apiFetch } from "./httpClient";

export interface AdminDeleteResourceResult {
  message: string;
  cleanupComplete: boolean;
  cleanupWarnings: string[];
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
