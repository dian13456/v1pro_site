import type { ResourceItem } from "../types/resource";
import type { AiGuideResponse, AiGuideResult } from "../types/aiGuide";
import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";
import { fetchResources } from "./resourceService";
import { getLocale, translate } from "../i18n";

const MAX_QUESTION_LENGTH = 300;
type RawAiGuideResponse = Omit<AiGuideResponse, "resourceIds"> & {
  resourceIds?: Array<number | string>;
};

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

function localAiGuideFallback(question: string, resources: ResourceItem[]): AiGuideResult {
  const tokens = tokenizeQuestion(question);
  const ranked = resources
    .map((resource) => ({ resource, score: scoreResource(resource, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const resourceIds = ranked.map((entry) => entry.resource.id);
  const names = ranked.map((entry) => entry.resource.title);

  let answer = translate("你可以描述想要的主题、角色、风格或素材类型，我会帮你找合适的素材。", "Describe the theme, character, style or content type you want, and I'll help you find matching resources.");
  if (names.length > 0) {
    answer = translate("根据关键词为你找到 {count} 个可能相关的素材：{names}。", "Found {count} potentially matching resources: {names}.", { count: names.length, names: names.join(getLocale() === "en" ? ", " : "、") });
  } else if (question.trim()) {
    answer = translate("暂未精确匹配「{question}」，建议试试「视频」「GIF」「月薪喵」等关键词。", "No exact matches for “{question}”. Try keywords such as “video”, “GIF” or a creator's name.", { question: question.trim() });
  }

  return {
    success: true,
    answer,
    resourceIds,
    mode: "fallback",
  };
}

export async function askAiGuide(question: string): Promise<AiGuideResult> {
  const trimmed = question.trim();
  if (!trimmed) {
    throw new Error(translate("请输入你想找的内容", "Describe what you want to find."));
  }
  if (trimmed.length > MAX_QUESTION_LENGTH) {
    throw new Error(translate("问题最多 {count} 字", "Questions can contain up to {count} characters.", { count: MAX_QUESTION_LENGTH }));
  }
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  if (isStaticMode()) {
    const resources = await fetchResources();
    return localAiGuideFallback(trimmed, resources);
  }

  const auth = getAuthState();
  try {
    const payload = await apiFetch<RawAiGuideResponse>(
      "/api/ai-guide",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth?.token || ""}`,
        },
        body: JSON.stringify({ question: trimmed }),
      },
      { timeoutMs: 70_000 },
    );
    if (!payload.success) {
      throw new Error(payload.message || "AI 助手请求失败");
    }
    return {
      success: true,
      answer: payload.mode !== "deepseek" && getLocale() === "en"
        ? translate("已为你整理相关素材。", "Here are the matching resources.")
        : payload.answer || translate("已为你整理相关素材。", "Here are the matching resources."),
      resourceIds: normalizeIds(payload.resourceIds),
      mode: payload.mode === "deepseek" ? "deepseek" : "fallback",
    };
  } catch {
    const resources = await fetchResources();
    return localAiGuideFallback(trimmed, resources);
  }
}

export { MAX_QUESTION_LENGTH };
