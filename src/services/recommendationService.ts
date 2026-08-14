import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { parseResourceList } from "./resourceService";
import { isStaticMode } from "./runtimeMode";
import type { ResourceItem } from "../types/resource";

export type RecommendationMode = "personalized" | "popular";
export type ResourceInteractionAction = "view" | "transfer";

export interface ResourceRecommendation {
  resourceId: number;
  score: number;
  reason: string;
}

interface RecommendationsResponse extends Record<string, unknown> {
  success?: boolean;
  mode?: RecommendationMode;
  items?: Array<{
    resourceId?: number | string;
    score?: number;
    reason?: string;
  }>;
  resources?: unknown[];
  message?: string;
}

export interface RecommendationFetchOptions {
  seed?: string;
  excludeIds?: number[];
}

export async function fetchResourceRecommendations(limit = 8, options: RecommendationFetchOptions = {}): Promise<{
  mode: RecommendationMode;
  items: ResourceRecommendation[];
  resources: ResourceItem[];
}> {
  const auth = getAuthState();
  if (!auth || !hasValidLocalAuth() || isStaticMode()) {
    return { mode: "popular", items: [], resources: [] };
  }
  const safeLimit = Math.max(1, Math.min(64, Math.floor(limit)));
  const params = new URLSearchParams({ limit: String(safeLimit) });
  if (options.seed) params.set("seed", options.seed.slice(0, 96));
  const excludeIds = Array.from(new Set(options.excludeIds || []))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .slice(0, 96);
  if (excludeIds.length > 0) params.set("exclude", excludeIds.join(","));
  const payload = await apiFetch<RecommendationsResponse>(`/api/recommendations?${params.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${auth.token}` },
  }, { priority: true });
  if (payload.success === false) {
    throw new Error(payload.message || "猜你喜欢加载失败");
  }
  const items: ResourceRecommendation[] = [];
  for (const item of payload.items || []) {
    const resourceId = Number(item.resourceId);
    if (!Number.isSafeInteger(resourceId) || resourceId <= 0) continue;
    items.push({
      resourceId,
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : 0,
      reason: String(item.reason || "为你推荐"),
    });
  }
  return {
    mode: payload.mode === "personalized" ? "personalized" : "popular",
    items,
    resources: parseResourceList(payload.resources),
  };
}

export async function recordResourceInteraction(resourceId: number, action: ResourceInteractionAction): Promise<void> {
  const auth = getAuthState();
  if (!auth || !hasValidLocalAuth() || isStaticMode()) return;
  await apiFetch<{ success?: boolean; message?: string }>("/api/resource-interaction", {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({ resourceId: String(resourceId), action }),
  });
}
