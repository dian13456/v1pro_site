import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";

interface FavoritesResponse {
  success?: boolean;
  favoriteResourceIds?: Array<number | string>;
}

interface FavoriteActionResponse {
  success?: boolean;
  favorited?: boolean;
  favoriteResourceIds?: Array<number | string>;
  message?: string;
}

export interface ResourceFavoritesState {
  favoriteIds: number[];
  favoriteIdSet: Set<number>;
}

const LOCAL_FAVORITES_KEY_PREFIX = "jiadian_hub_favorite_ids_";

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

function normalizeFavoriteIds(rawIds: Array<number | string> | undefined): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const rawId of rawIds || []) {
    const id = toNumberId(rawId);
    if (id !== null && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function localFavoritesKey(serial: string): string {
  return `${LOCAL_FAVORITES_KEY_PREFIX}${serial}`;
}

function readLocalFavoriteIds(serial: string): number[] {
  try {
    const raw = localStorage.getItem(localFavoritesKey(serial));
    if (!raw) return [];
    const arr = JSON.parse(raw) as Array<number | string>;
    return normalizeFavoriteIds(arr);
  } catch {
    return [];
  }
}

function writeLocalFavoriteIds(serial: string, favoriteIds: number[]): void {
  localStorage.setItem(localFavoritesKey(serial), JSON.stringify(favoriteIds));
}

function toFavoritesState(favoriteIds: number[]): ResourceFavoritesState {
  return {
    favoriteIds,
    favoriteIdSet: new Set(favoriteIds),
  };
}

export async function fetchResourceFavorites(): Promise<ResourceFavoritesState> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  const auth = getAuthState();
  if (!auth) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  if (isStaticMode()) {
    return toFavoritesState(readLocalFavoriteIds(auth.serial));
  }

  const payload = await apiFetch<FavoritesResponse>("/api/resource-favorites", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
  });

  return toFavoritesState(normalizeFavoriteIds(payload.favoriteResourceIds));
}

async function mutateFavorite(
  resourceId: number,
  action: "add" | "remove" | "toggle"
): Promise<ResourceFavoritesState> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  const auth = getAuthState();
  if (!auth) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  if (isStaticMode()) {
    const favoriteIds = readLocalFavoriteIds(auth.serial);
    const set = new Set(favoriteIds);
    if (action === "add") {
      set.add(resourceId);
    } else if (action === "remove") {
      set.delete(resourceId);
    } else if (set.has(resourceId)) {
      set.delete(resourceId);
    } else {
      set.add(resourceId);
    }
    const next = Array.from(set);
    writeLocalFavoriteIds(auth.serial, next);
    return toFavoritesState(next);
  }

  const payload = await apiFetch<FavoriteActionResponse>("/api/resource-favorite", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify({ resourceId: String(resourceId), action }),
  });

  if (!payload.success) {
    throw new Error(payload.message || "收藏操作失败");
  }

  return toFavoritesState(normalizeFavoriteIds(payload.favoriteResourceIds));
}

export async function addResourceFavorite(resourceId: number): Promise<ResourceFavoritesState> {
  return mutateFavorite(resourceId, "add");
}

export async function toggleResourceFavorite(resourceId: number): Promise<{
  favorited: boolean;
  state: ResourceFavoritesState;
}> {
  const state = await mutateFavorite(resourceId, "toggle");
  return {
    favorited: state.favoriteIdSet.has(resourceId),
    state,
  };
}
