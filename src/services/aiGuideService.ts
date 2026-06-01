import resourceData from "../data/resources.json";
import type { ResourceItem } from "../types/resource";
import type { AiGuideResponse } from "../types/aiGuide";
import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";

const MAX_QUESTION_LENGTH = 300;

function normalizeIds(raw: Array<number | string> | undefined): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const value of raw || []) {
    const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || seen.has(parsed)) continue;
    seen.add(parsed);
    ids.push(parsed);
    if (ids.length >= 6) break;
  }
  return ids;
}

function tokenizeQuestion(question: string): string[] {
  const normalized = question.trim().toLowerCase();
  if (!normalized) return [];
  const parts = normalized.split(/[\s,，。！？!?、/|]+/).filter(Boolean);
  return parts.length > 0 ? parts : [normalized];
}

function scoreResource(resource: ResourceItem, tokens: string[]): number {
  const blob = [
    resource.title,
    resource.description,
    resource.columnTag || "",
    resource.author || "",
    resource.materialType,
  ]
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (resource.title.toLowerCase().includes(token)) score += 3;
    if ((resource.columnTag || "").toLowerCase().includes(token)) score += 2;
    if (blob.includes(token)) score += 2;
  }
  return score;
}

function localAiGuideFallback(question: string, resources: ResourceItem[]): AiGuideResponse {
  const tokens = tokenizeQuestion(question);
  const ranked = resources
    .map((resource) => ({ resource, score: scoreResource(resource, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const resourceIds = ranked.map((entry) => entry.resource.id);
  const names = ranked.map((entry) => entry.resource.title);

  let answer = "你可以描述想要的主题、角色、风格或素材类型，我会帮你找合适的素材。";
  if (names.length > 0) {
    answer = `根据关键词为你找到 ${names.length} 个可能相关的素材：${names.join("、")}。`;
  } else if (question.trim()) {
    answer = `暂未精确匹配「${question.trim()}」，建议试试「视频」「GIF」「月薪喵」等关键词。`;
  }

  return {
    success: true,
    answer,
    resourceIds,
    mode: "fallback",
  };
}

function readLocalResources(): ResourceItem[] {
  return (resourceData as ResourceItem[]).filter((item) => item?.id && item?.title);
}

export async function askAiGuide(question: string): Promise<AiGuideResponse> {
  const trimmed = question.trim();
  if (!trimmed) {
    throw new Error("请输入你想找的内容");
  }
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    throw new Error(`问题最多 ${MAX_QUESTION_LENGTH} 字`);
  }
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  if (isStaticMode()) {
    return localAiGuideFallback(trimmed, readLocalResources());
  }

  const auth = getAuthState();
  try {
    const payload = await apiFetch<AiGuideResponse>("/api/ai-guide", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth?.token || ""}`,
      },
      body: JSON.stringify({ question: trimmed }),
    });
    if (!payload.success) {
      throw new Error(payload.message || "AI 导览请求失败");
    }
    return {
      success: true,
      answer: payload.answer || "已为你整理相关素材。",
      resourceIds: normalizeIds(payload.resourceIds),
      mode: payload.mode === "deepseek" ? "deepseek" : "fallback",
    };
  } catch {
    return localAiGuideFallback(trimmed, readLocalResources());
  }
}

export { MAX_QUESTION_LENGTH };
