import type { ResourceItem, ResourceTransferDefaults } from "../types/resource";
import { apiFetch } from "./httpClient";
import bundledResources from "../data/resources.json";

type ResourceRecord = Partial<ResourceItem> & {
  id?: number;
  title?: string;
  description?: string;
  author?: string;
  uploaderSerial?: string;
  uploaderBlockable?: boolean;
  size?: string;
  image?: string;
  download?: string;
  category?: ResourceItem["category"];
  materialType?: ResourceItem["materialType"];
  columnTag?: string;
  updatedAt?: string;
};

const COS_MANIFEST_URL = import.meta.env.VITE_COS_RESOURCE_MANIFEST_URL || "";
let resourceCatalogPromise: Promise<ResourceItem[]> | null = null;

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

function normalizeTransferDefaults(value: unknown): ResourceTransferDefaults | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<ResourceTransferDefaults>;
  const allowedCapacities = new Set([77, 154, 308]);
  const targetFrameCapacities = Array.isArray(record.targetFrameCapacities)
    ? [...new Set(record.targetFrameCapacities.filter((item) => allowedCapacities.has(Number(item))))]
        .map(Number)
        .sort((a, b) => a - b)
    : [];
  if (targetFrameCapacities.length === 0) return undefined;
  if (record.videoFps !== 20 && record.videoFps !== 25 && record.videoFps !== 30) return undefined;
  if (record.fitMode !== "fill" && record.fitMode !== "contain") return undefined;
  if (record.rotationDeg !== 0 && record.rotationDeg !== 90 && record.rotationDeg !== 180 && record.rotationDeg !== 270) return undefined;
  if (record.colorProfile !== "normal" && record.colorProfile !== "vivid" && record.colorProfile !== "professional") return undefined;
  return {
    targetFrameCapacities: targetFrameCapacities as ResourceTransferDefaults["targetFrameCapacities"],
    videoFps: record.videoFps,
    fitMode: record.fitMode,
    rotationDeg: record.rotationDeg,
    colorProfile: record.colorProfile,
  };
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
    uploaderSerial: (sanitized.uploaderSerial || "").trim() || undefined,
    // The public catalog intentionally strips the real uploader SN. User-uploaded
    // resources still carry an author, which hiddenResourceService can use as the
    // privacy-safe local blocking key.
    uploaderBlockable: Boolean(sanitized.uploaderBlockable || sanitized.uploaderSerial || sanitized.author?.trim()),
    columnTag: columnTag || undefined,
    size: sanitized.size || "未知",
    image: imageRaw,
    download: downloadKey,
    category: sanitized.category,
    materialType: sanitized.materialType || "v1pro-pack",
    updatedAt: updated,
    durationSec:
      typeof sanitized.durationSec === "number" && Number.isFinite(sanitized.durationSec)
        ? Math.max(0, sanitized.durationSec)
        : undefined,
    sourceFrameCount:
      typeof sanitized.sourceFrameCount === "number" && Number.isFinite(sanitized.sourceFrameCount)
        ? Math.max(1, Math.floor(sanitized.sourceFrameCount))
        : undefined,
    width:
      typeof sanitized.width === "number" && Number.isFinite(sanitized.width)
        ? Math.max(1, Math.floor(sanitized.width))
        : undefined,
    height:
      typeof sanitized.height === "number" && Number.isFinite(sanitized.height)
        ? Math.max(1, Math.floor(sanitized.height))
        : undefined,
    transferDefaults: normalizeTransferDefaults(sanitized.transferDefaults),
  };
}

function parseResourcePayload(payload: unknown): ResourceItem[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item) => normalizeRecord(item as ResourceRecord))
    .filter((item): item is ResourceItem => item !== null);
}

export function parseResourceList(payload: unknown): ResourceItem[] {
  return parseResourcePayload(payload);
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

async function loadResources(): Promise<ResourceItem[]> {
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

  if (import.meta.env.DEV) {
    return sortByUpdatedAtDesc(parseResourcePayload(bundledResources));
  }
  return [];
}

export function fetchResources(): Promise<ResourceItem[]> {
  if (!resourceCatalogPromise) {
    resourceCatalogPromise = loadResources()
      .then((resources) => {
        if (resources.length === 0) resourceCatalogPromise = null;
        return resources;
      })
      .catch((error) => {
        resourceCatalogPromise = null;
        throw error;
      });
  }
  return resourceCatalogPromise;
}

export function removeResourceFromCachedCatalog(resourceId: number): void {
  if (!Number.isSafeInteger(resourceId) || resourceId <= 0 || !resourceCatalogPromise) return;
  resourceCatalogPromise = resourceCatalogPromise.then((resources) =>
    resources.filter((resource) => resource.id !== resourceId),
  );
}
