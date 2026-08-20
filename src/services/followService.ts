import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";
import type { ResourceItem } from "../types/resource";

interface FollowResponse {
  success: boolean;
  message?: string;
  followed?: boolean;
  followedResourceIds?: Array<number | string>;
  followedUploaderCount?: number;
  ownResourceIds?: Array<number | string>;
}

export interface UploaderFollowState {
  followedResourceIds: number[];
  followedResourceIdSet: Set<number>;
  followedUploaderCount: number;
  ownResourceIds: number[];
  ownResourceIdSet: Set<number>;
}

const LOCAL_FOLLOWS_KEY_PREFIX = "jiadian_hub_followed_uploaders_";

function normalizeIds(values?: Array<number | string>): number[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isFinite(value) && value > 0)));
}

function createState(
  followedResourceIds: number[],
  followedUploaderCount: number,
  ownResourceIds: number[],
): UploaderFollowState {
  return {
    followedResourceIds,
    followedResourceIdSet: new Set(followedResourceIds),
    followedUploaderCount: Math.max(0, followedUploaderCount),
    ownResourceIds,
    ownResourceIdSet: new Set(ownResourceIds),
  };
}

function uploaderKey(resource: ResourceItem): string {
  const serial = resource.uploaderSerial?.trim().toUpperCase();
  if (serial) return `sn:${serial}`;
  const nickname = resource.author?.trim().toLocaleLowerCase("zh-CN");
  return nickname ? `nickname:${nickname}` : "";
}

function localStorageKey(serial: string): string {
  return `${LOCAL_FOLLOWS_KEY_PREFIX}${serial.trim().toUpperCase()}`;
}

function readLocalFollowedKeys(serial: string): string[] {
  try {
    const raw = localStorage.getItem(localStorageKey(serial));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function localState(resources: ResourceItem[]): UploaderFollowState {
  const auth = getAuthState();
  const followedKeys = new Set(readLocalFollowedKeys(auth?.serial || ""));
  const ownKey = auth?.serial ? `sn:${auth.serial.trim().toUpperCase()}` : "";
  const followedResourceIds = resources
    .filter((resource) => followedKeys.has(uploaderKey(resource)))
    .map((resource) => resource.id);
  const ownResourceIds = ownKey
    ? resources.filter((resource) => uploaderKey(resource) === ownKey).map((resource) => resource.id)
    : [];
  return createState(followedResourceIds, followedKeys.size, ownResourceIds);
}

export async function fetchUploaderFollows(resources: ResourceItem[]): Promise<UploaderFollowState> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  if (isStaticMode()) return localState(resources);

  const auth = getAuthState();
  const payload = await apiFetch<Record<string, unknown>>("/api/resource-follows", {
    headers: { Authorization: `Bearer ${auth?.token || ""}` },
  }) as unknown as FollowResponse;
  if (!payload.success) throw new Error(payload.message || "关注列表加载失败");
  const followedResourceIds = normalizeIds(payload.followedResourceIds);
  const ownResourceIds = normalizeIds(payload.ownResourceIds);
  return createState(followedResourceIds, payload.followedUploaderCount || 0, ownResourceIds);
}

export async function setUploaderFollowed(
  resource: ResourceItem,
  followed: boolean,
  resources: ResourceItem[],
): Promise<{ followed: boolean; state: UploaderFollowState }> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  const auth = getAuthState();
  if (isStaticMode()) {
    const key = uploaderKey(resource);
    if (!key) throw new Error("该素材缺少上传者信息");
    if (key === `sn:${auth?.serial.trim().toUpperCase()}`) throw new Error("不能关注自己");
    const followedKeys = new Set(readLocalFollowedKeys(auth?.serial || ""));
    if (followed) followedKeys.add(key);
    else followedKeys.delete(key);
    localStorage.setItem(localStorageKey(auth?.serial || ""), JSON.stringify(Array.from(followedKeys)));
    return { followed, state: localState(resources) };
  }

  const payload = await apiFetch<Record<string, unknown>>("/api/resource-follow", {
    method: "POST",
    headers: { Authorization: `Bearer ${auth?.token || ""}` },
    body: JSON.stringify({ resourceId: String(resource.id), followed }),
  }) as unknown as FollowResponse;
  if (!payload.success) throw new Error(payload.message || "关注操作失败");
  const followedResourceIds = normalizeIds(payload.followedResourceIds);
  const ownResourceIds = normalizeIds(payload.ownResourceIds);
  return {
    followed: Boolean(payload.followed),
    state: createState(followedResourceIds, payload.followedUploaderCount || 0, ownResourceIds),
  };
}
