import type { ResourceItem } from "../types/resource";
import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";

export interface HiddenResourceState {
  hiddenResourceIds: number[];
  blockedUploaderCount: number;
}

interface HiddenResourcesResponse {
  success?: boolean;
  hiddenResourceIds?: Array<number | string>;
  blockedUploaderCount?: number;
  message?: string;
}

const LOCAL_BLOCKED_KEY_PREFIX = "jiadian_hub_blocked_uploaders_";

function normalizeIds(rawIds?: Array<number | string>): number[] {
  const unique = new Set<number>();
  for (const raw of rawIds || []) {
    const id = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
    if (Number.isSafeInteger(id) && id > 0) unique.add(id);
  }
  return Array.from(unique);
}

function localKey(serial: string): string {
  return `${LOCAL_BLOCKED_KEY_PREFIX}${serial}`;
}

function readLocal(serial: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(localKey(serial)) || "[]");
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function uploaderKey(resource: ResourceItem): string {
  const serial = (resource.uploaderSerial || "").trim().toUpperCase();
  if (serial) return serial;
  return `AUTHOR:${(resource.author || "").trim()}`;
}

function localState(serial: string, resources: ResourceItem[]): HiddenResourceState {
  const blocked = new Set(readLocal(serial));
  return {
    hiddenResourceIds: resources.filter((item) => blocked.has(uploaderKey(item))).map((item) => item.id),
    blockedUploaderCount: blocked.size,
  };
}

function writeLocal(serial: string, blocked: Set<string>): void {
  localStorage.setItem(localKey(serial), JSON.stringify(Array.from(blocked)));
}

function requireAuth() {
  const auth = getAuthState();
  if (!hasValidLocalAuth() || !auth?.token || !auth.serial) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  return auth;
}

function normalizeResponse(payload: HiddenResourcesResponse): HiddenResourceState {
  return {
    hiddenResourceIds: normalizeIds(payload.hiddenResourceIds),
    blockedUploaderCount: Math.max(0, Number(payload.blockedUploaderCount) || 0),
  };
}

export async function fetchHiddenResourceState(resources: ResourceItem[]): Promise<HiddenResourceState> {
  const auth = requireAuth();
  if (isStaticMode()) return localState(auth.serial, resources);

  const payload = await apiFetch<HiddenResourcesResponse>("/api/resource-hidden", {
    method: "GET",
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  if (!payload.success) throw new Error(payload.message || "屏蔽列表加载失败");
  return normalizeResponse(payload);
}

export async function setUploaderHidden(
  resource: ResourceItem,
  hidden: boolean,
  resources: ResourceItem[]
): Promise<HiddenResourceState> {
  const auth = requireAuth();
  if (isStaticMode()) {
    const blocked = new Set(readLocal(auth.serial));
    const key = uploaderKey(resource);
    if (!key || key === "AUTHOR:") throw new Error("未找到该素材的上传设备");
    if (hidden) blocked.add(key);
    else blocked.delete(key);
    writeLocal(auth.serial, blocked);
    return localState(auth.serial, resources);
  }

  const payload = await apiFetch<HiddenResourcesResponse>("/api/resource-hidden", {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({ resourceId: String(resource.id), hidden }),
  });
  if (!payload.success) throw new Error(payload.message || "屏蔽设置保存失败");
  return normalizeResponse(payload);
}
