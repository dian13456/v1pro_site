import type { ResourceItem } from "../types/resource";
import { apiFetch } from "./httpClient";

type ResourceRecord = Partial<ResourceItem> & {
  id?: number;
  title?: string;
  description?: string;
  author?: string;
  size?: string;
  image?: string;
  download?: string;
  category?: ResourceItem["category"];
  materialType?: ResourceItem["materialType"];
  columnTag?: string;
  updatedAt?: string;
};

const COS_MANIFEST_URL = import.meta.env.VITE_COS_RESOURCE_MANIFEST_URL || "";

/** 将 COS 公网 URL 转为对象键；已是相对路径则原样返回。 */
export function stripPublicObjectUrl(raw: string): string {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/^\/+/, "");
  }
  try {
    const pathname = new URL(trimmed).pathname.replace(/^\/+/, "");
    return decodeURIComponent(pathname);
  } catch {
    return trimmed;
  }
}

/** 去掉可被直接访问的 download / 完整 image URL，仅保留对象键。 */
export function sanitizeResourceRecord(item: ResourceRecord): ResourceRecord {
  const image = stripPublicObjectUrl(item.image || "");
  const downloadKey = stripPublicObjectUrl(item.download || "");
  return {
    ...item,
    image,
    download: downloadKey || image || undefined,
  };
}

function sortByUpdatedAtDesc(items: ResourceItem[]): ResourceItem[] {
  return [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function normalizeRecord(item: ResourceRecord): ResourceItem | null {
  const sanitized = sanitizeResourceRecord(item);
  const imageRaw = (sanitized.image || "").trim();
  if (!sanitized.id || !sanitized.title || !sanitized.description || !imageRaw || !sanitized.category) {
    return null;
  }

  const updated = sanitized.updatedAt || new Date().toISOString();
  const columnTag = (sanitized.columnTag || "").trim();
  const downloadKey = (sanitized.download || imageRaw).trim();

  return {
    id: sanitized.id,
    title: sanitized.title,
    description: sanitized.description,
    author: (sanitized.author || "").trim() || undefined,
    columnTag: columnTag || undefined,
    size: sanitized.size || "未知",
    image: imageRaw,
    download: downloadKey,
    category: sanitized.category,
    materialType: sanitized.materialType || "v1pro-pack",
    updatedAt: updated,
  };
}

function parseResourcePayload(payload: unknown): ResourceItem[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item) => normalizeRecord(item as ResourceRecord))
    .filter((item): item is ResourceItem => item !== null);
}

async function fetchFromCosManifest(): Promise<ResourceItem[]> {
  if (!COS_MANIFEST_URL) return [];

  const response = await fetch(COS_MANIFEST_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`COS manifest 拉取失败（HTTP ${response.status}）`);
  }
  const payload = (await response.json()) as unknown;
  return parseResourcePayload(payload);
}

async function fetchFromRuntimeApi(): Promise<ResourceItem[]> {
  const payload = (await apiFetch<unknown>("/api/resources")) as unknown;
  return parseResourcePayload(payload);
}

export async function fetchResources(): Promise<ResourceItem[]> {
  try {
    const dynamic = await fetchFromRuntimeApi();
    if (dynamic.length > 0) {
      return sortByUpdatedAtDesc(dynamic);
    }
  } catch {
    // API 不可用时尝试 COS manifest（仍会做 URL 脱敏）。
  }

  try {
    const remote = await fetchFromCosManifest();
    if (remote.length > 0) {
      return sortByUpdatedAtDesc(remote);
    }
  } catch {
    // 无本地打包 fallback，避免 COS 直链进入 JS 产物。
  }

  return [];
}
