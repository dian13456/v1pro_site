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

/** Privacy-safe uploader summary returned by the admin-only preview endpoint. */
export interface AdminUploaderSummary {
  resourceId: number;
  uploaderName: string;
  uploaderSerialMasked: string;
  uploaderSerialSuffix?: string;
  publishedResourceCount: number;
  banned: boolean;
}

export interface AdminPurgeUploaderResult {
  message: string;
  uploaderName: string;
  uploaderSerialMasked: string;
  uploaderSerialSuffix?: string;
  banned: boolean;
  deletedResourceIds: number[];
  deletedResourceCount: number;
  remainingResourceCount: number;
  deletedReviewCount: number;
  invalidatedSessionCount: number;
  deletedSessionObjectCount: number;
  cleanupComplete: boolean;
  cleanupWarnings: string[];
}

function numericValue(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanupWarningsValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

function assertAdminToken(adminToken: string): string {
  const token = adminToken.trim();
  if (!token) {
    throw new Error("管理员登录已失效，请重新登录");
  }
  return token;
}

function assertResourceId(resourceId: number): number {
  if (!Number.isSafeInteger(resourceId) || resourceId <= 0) {
    throw new Error("素材编号无效");
  }
  return resourceId;
}

function parseUploaderSummary(payload: {
  success?: boolean;
  message?: string;
  resourceId?: unknown;
  uploaderName?: unknown;
  uploaderSerialMasked?: unknown;
  uploaderSerialSuffix?: unknown;
  publishedResourceCount?: unknown;
  banned?: unknown;
}, resourceId: number): AdminUploaderSummary {
  if (payload.success !== true) {
    throw new Error(payload.message || "上传人信息读取失败");
  }
  const responseResourceId = numericValue(payload.resourceId);
  const uploaderName = stringValue(payload.uploaderName);
  const uploaderSerialMasked = stringValue(payload.uploaderSerialMasked);
  const publishedResourceCount = numericValue(payload.publishedResourceCount);
  if (
    responseResourceId == null
    || responseResourceId !== resourceId
    || !uploaderName
    || !uploaderSerialMasked
    || publishedResourceCount == null
  ) {
    throw new Error("服务器返回的上传人信息无效，请刷新后重试");
  }
  return {
    resourceId: responseResourceId,
    uploaderName,
    uploaderSerialMasked,
    uploaderSerialSuffix: stringValue(payload.uploaderSerialSuffix) || undefined,
    publishedResourceCount,
    banned: payload.banned === true,
  };
}

export async function adminFetchUploaderSummary(
  adminToken: string,
  resourceId: number,
): Promise<AdminUploaderSummary> {
  const token = assertAdminToken(adminToken);
  const id = assertResourceId(resourceId);
  const payload = await apiFetch<{
    success?: boolean;
    message?: string;
    resourceId?: unknown;
    uploaderName?: unknown;
    uploaderSerialMasked?: unknown;
    uploaderSerialSuffix?: unknown;
    publishedResourceCount?: unknown;
    banned?: unknown;
  }>(`/api/admin/resources/${encodeURIComponent(String(id))}/uploader`, {
    method: "GET",
    headers: { "X-Review-Admin-Token": token },
  }, {
    // Admin actions must not wait behind the material preview queue. The
    // summary is also backed by the full catalog, so give it a little more
    // headroom on a busy server.
    priority: true,
    timeoutMs: 30_000,
  });
  return parseUploaderSummary(payload, id);
}

export async function adminPurgeAndBanUploader(
  adminToken: string,
  resourceId: number,
): Promise<AdminPurgeUploaderResult> {
  const token = assertAdminToken(adminToken);
  const id = assertResourceId(resourceId);
  const payload = await apiFetch<{
    success?: boolean;
    message?: string;
    uploaderName?: unknown;
    uploaderSerialMasked?: unknown;
    uploaderSerialSuffix?: unknown;
    banned?: unknown;
    deletedResourceIds?: unknown;
    deletedResourceCount?: unknown;
    remainingResourceCount?: unknown;
    deletedReviewCount?: unknown;
    invalidatedSessionCount?: unknown;
    deletedSessionObjectCount?: unknown;
    cleanupComplete?: unknown;
    cleanupWarnings?: unknown;
  }>(`/api/admin/resources/${encodeURIComponent(String(id))}/purge-and-ban`, {
    method: "POST",
    headers: {
      "X-Review-Admin-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ confirm: true }),
  }, {
    // Purging an uploader may remove hundreds of COS objects and clean up
    // several persisted interaction stores. Keep this request out of the
    // normal eight-request preview queue and align the client timeout with
    // the backend's five-minute HTTP write timeout.
    priority: true,
    timeoutMs: 240_000,
  });
  if (payload.success !== true) {
    throw new Error(payload.message || "删除上传人素材并禁用上传失败");
  }

  const uploaderName = stringValue(payload.uploaderName);
  const uploaderSerialMasked = stringValue(payload.uploaderSerialMasked);
  const deletedResourceIds = Array.isArray(payload.deletedResourceIds)
    ? Array.from(new Set(payload.deletedResourceIds
      .map((value) => numericValue(value))
      .filter((value): value is number => value != null && Number.isSafeInteger(value) && value > 0)))
    : [];
  const deletedResourceCount = numericValue(payload.deletedResourceCount);
  const remainingResourceCount = numericValue(payload.remainingResourceCount);
  const deletedReviewCount = numericValue(payload.deletedReviewCount);
  const invalidatedSessionCount = numericValue(payload.invalidatedSessionCount);
  const deletedSessionObjectCount = numericValue(payload.deletedSessionObjectCount);
  if (
    !uploaderName
    || !uploaderSerialMasked
    || deletedResourceCount == null
    || remainingResourceCount == null
    || deletedReviewCount == null
    || invalidatedSessionCount == null
    || deletedSessionObjectCount == null
  ) {
    throw new Error("服务器返回的清理结果无效，请刷新后重试");
  }
  return {
    message: payload.message || "已删除该上传人的全部素材并禁止继续上传",
    uploaderName,
    uploaderSerialMasked,
    uploaderSerialSuffix: stringValue(payload.uploaderSerialSuffix) || undefined,
    banned: payload.banned === true,
    deletedResourceIds,
    deletedResourceCount,
    remainingResourceCount,
    deletedReviewCount,
    invalidatedSessionCount,
    deletedSessionObjectCount,
    cleanupComplete: payload.cleanupComplete === true,
    cleanupWarnings: cleanupWarningsValue(payload.cleanupWarnings),
  };
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
