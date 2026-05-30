import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";

interface LikesResponse {
  success?: boolean;
  counts?: Record<string, number>;
  likedResourceIds?: Array<number | string>;
}

interface LikeActionResponse {
  success?: boolean;
  alreadyLiked?: boolean;
  likeCount?: number;
  liked?: boolean;
}

export interface ResourceLikesState {
  counts: Record<number, number>;
  likedIds: Set<number>;
}

const LOCAL_LIKE_COUNTS_KEY = "jiadian_hub_like_counts";

function toNumberId(value: number | string): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function localDeviceLikeKey(serial: string): string {
  return `jiadian_hub_liked_ids_${serial}`;
}

function readLocalLikeCounts(): Record<number, number> {
  try {
    const raw = localStorage.getItem(LOCAL_LIKE_COUNTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    const result: Record<number, number> = {};
    for (const [id, count] of Object.entries(parsed)) {
      const numericId = toNumberId(id);
      if (numericId !== null && Number.isFinite(count) && count >= 0) {
        result[numericId] = Math.floor(count);
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeLocalLikeCounts(counts: Record<number, number>): void {
  const payload: Record<string, number> = {};
  for (const [id, count] of Object.entries(counts)) {
    payload[id] = count;
  }
  localStorage.setItem(LOCAL_LIKE_COUNTS_KEY, JSON.stringify(payload));
}

function readLocalLikedIds(serial: string): Set<number> {
  try {
    const raw = localStorage.getItem(localDeviceLikeKey(serial));
    if (!raw) return new Set<number>();
    const arr = JSON.parse(raw) as Array<number | string>;
    const set = new Set<number>();
    for (const id of arr) {
      const normalized = toNumberId(id);
      if (normalized !== null) set.add(normalized);
    }
    return set;
  } catch {
    return new Set<number>();
  }
}

function writeLocalLikedIds(serial: string, likedIds: Set<number>): void {
  localStorage.setItem(localDeviceLikeKey(serial), JSON.stringify(Array.from(likedIds)));
}

export async function fetchResourceLikes(): Promise<ResourceLikesState> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  const auth = getAuthState();
  if (!auth) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  if (isStaticMode()) {
    return {
      counts: readLocalLikeCounts(),
      likedIds: readLocalLikedIds(auth.serial),
    };
  }

  const payload = await apiFetch<LikesResponse>("/api/resource-likes", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
  });

  const counts: Record<number, number> = {};
  for (const [key, count] of Object.entries(payload.counts || {})) {
    const id = toNumberId(key);
    if (id !== null && Number.isFinite(count) && count >= 0) {
      counts[id] = Math.floor(count);
    }
  }

  const likedIds = new Set<number>();
  for (const rawId of payload.likedResourceIds || []) {
    const id = toNumberId(rawId);
    if (id !== null) likedIds.add(id);
  }

  return { counts, likedIds };
}

export async function likeResource(
  resourceId: number
): Promise<{ likeCount: number; liked: boolean; alreadyLiked: boolean }> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  const auth = getAuthState();
  if (!auth) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  if (isStaticMode()) {
    const counts = readLocalLikeCounts();
    const likedIds = readLocalLikedIds(auth.serial);
    const alreadyLiked = likedIds.has(resourceId);
    if (!alreadyLiked) {
      likedIds.add(resourceId);
      counts[resourceId] = (counts[resourceId] || 0) + 1;
      writeLocalLikedIds(auth.serial, likedIds);
      writeLocalLikeCounts(counts);
    }
    return {
      alreadyLiked,
      liked: true,
      likeCount: counts[resourceId] || 0,
    };
  }

  const payload = await apiFetch<LikeActionResponse>("/api/resource-like", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify({ resourceId: String(resourceId) }),
  });

  return {
    likeCount: Math.max(0, Number(payload.likeCount || 0)),
    liked: Boolean(payload.liked),
    alreadyLiked: Boolean(payload.alreadyLiked),
  };
}
