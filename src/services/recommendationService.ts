import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";

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
  message?: string;
}

export async function fetchResourceRecommendations(limit = 8): Promise<{
  mode: RecommendationMode;
  items: ResourceRecommendation[];
}> {
  const auth = getAuthState();
  if (!auth || !hasValidLocalAuth() || isStaticMode()) {
    return { mode: "popular", items: [] };
  }
  const safeLimit = Math.max(1, Math.min(24, Math.floor(limit)));
  const payload = await apiFetch<RecommendationsResponse>(`/api/recommendations?limit=${safeLimit}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${auth.token}` },
  });
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
  return { mode: payload.mode === "personalized" ? "personalized" : "popular", items };
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
