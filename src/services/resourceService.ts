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
// Public browsing must remain responsive even when the signed API edge is
// unreachable.  A catalog response is display-only; after this short bound
// the caller can use the sanitized COS/bundled fallback instead of showing a
// full-page loader for the generic API timeout.
const PUBLIC_CATALOG_API_TIMEOUT_MS = 8_000;
let resourceCatalogPromise: Promise<ResourceItem[]> | null = null;

interface ResourcePagePayload {
  success?: boolean;
  items?: unknown[];
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  hasMore?: boolean;
}

export interface ResourcePageQuery {
  page?: number;
  pageSize?: number;
  sort?: "latest" | "earliest" | "hot" | "weeklyTop";
  keyword?: string;
  category?: string;
  materialType?: string;
  columnTag?: string;
}

export interface ResourcePageResult {
  items: ResourceItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

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

/**
 * The catalog is public and the page must remain browsable when the API is
 * temporarily unavailable (for example while a CDN/API deployment is being
 * switched).  The checked-in catalog is an emergency display-only fallback;
 * remove the private uploader identifier before it can reach a browser.
 */
function parseBundledPublicCatalog(): ResourceItem[] {
  if (!Array.isArray(bundledResources)) return [];
  const publicRecords = bundledResources.map((item) => {
    if (!item || typeof item !== "object") return item;
    const copy = { ...(item as Record<string, unknown>) };
    delete copy.uploaderSerial;
    delete copy._uploaderSerial;
    return copy;
  });
  return parseResourcePayload(publicRecords);
}

let bundledPublicCatalog: ResourceItem[] | null = null;

function getBundledPublicCatalog(): ResourceItem[] {
  if (!bundledPublicCatalog) {
    bundledPublicCatalog = sortByUpdatedAtDesc(parseBundledPublicCatalog());
  }
  return bundledPublicCatalog;
}

function fallbackPageFromCatalog(items: ResourceItem[], query: ResourcePageQuery): ResourcePageResult {
  const keyword = query.keyword?.trim().toLowerCase() || "";
  const requestedMaterialTypes = (query.materialType || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const filtered = items.filter((item) => {
    if (query.category && query.category !== "all" && item.category !== query.category) return false;
    if (requestedMaterialTypes.length > 0 && !requestedMaterialTypes.includes(item.materialType)) return false;
    if (query.columnTag && query.columnTag !== "all" && item.columnTag !== query.columnTag) return false;
    if (!keyword) return true;
    return [item.title, item.description, item.author || ""].some((value) =>
      value.toLowerCase().includes(keyword),
    );
  });
  const sorted = [...filtered].sort((left, right) => {
    const leftTime = new Date(left.updatedAt).getTime();
    const rightTime = new Date(right.updatedAt).getTime();
    if (query.sort === "earliest") return leftTime - rightTime;
    return rightTime - leftTime;
  });
  const page = Math.max(1, Math.floor(query.page || 1));
  const pageSize = Math.max(1, Math.min(100, Math.floor(query.pageSize || 16)));
  const total = sorted.length;
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
  const start = Math.min((page - 1) * pageSize, total);
  const pageItems = sorted.slice(start, start + pageSize);
  return {
    items: pageItems,
    page,
    pageSize,
    total,
    totalPages,
    hasMore: start + pageItems.length < total,
  };
}

async function fetchPublicFallbackPage(
  query: ResourcePageQuery,
  signal?: AbortSignal,
): Promise<ResourcePageResult> {
  try {
    const manifest = await fetchFromCosManifest(signal);
    if (manifest.length > 0) return fallbackPageFromCatalog(manifest, query);
  } catch {
    // Use the bundled display-only catalog below when the manifest is down.
  }
  return fallbackPageFromCatalog(getBundledPublicCatalog(), query);
}

export function parseResourceList(payload: unknown): ResourceItem[] {
  return parseResourcePayload(payload);
}

export async function fetchResourcePage(
  query: ResourcePageQuery = {},
  signal?: AbortSignal,
): Promise<ResourcePageResult> {
  const page = Math.max(1, Math.floor(query.page || 1));
  const pageSize = Math.max(1, Math.min(100, Math.floor(query.pageSize || 16)));
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    sort: query.sort || "latest",
  });
  if (query.keyword?.trim()) params.set("q", query.keyword.trim().slice(0, 80));
  if (query.category?.trim()) params.set("category", query.category.trim());
  if (query.materialType?.trim()) params.set("materialType", query.materialType.trim());
  if (query.columnTag?.trim()) params.set("columnTag", query.columnTag.trim());

  let payload: ResourcePagePayload;
  try {
    payload = await apiFetch<ResourcePagePayload>(
      `/api/resources/page?${params.toString()}`,
      // The public catalog endpoint emits ETags and may answer a browser
      // revalidation with 304 (which has no JSON body).  This request is the
      // source of truth for the visible page, so bypass the browser's
      // conditional cache and always receive a JSON payload.
      { signal, cache: "no-store" },
      { timeoutMs: PUBLIC_CATALOG_API_TIMEOUT_MS },
    );
  } catch (error) {
    // A public page should not become an empty white grid just because the
    // API signature, origin, or edge is briefly unavailable.  Keep aborts
    // cancellable, but serve a sanitized local/manifest page for visitors.
    if (signal?.aborted) throw error;
    const fallback = await fetchPublicFallbackPage(query, signal);
    if (fallback.items.length > 0) return fallback;
    throw error;
  }
  if (payload.success === false || !Array.isArray(payload.items)) {
    const fallback = await fetchPublicFallbackPage(query, signal);
    if (fallback.items.length > 0) return fallback;
    throw new Error("素材目录分页加载失败");
  }
  const items = parseResourcePayload(payload.items);
  const total = Math.max(0, Number(payload.total) || 0);
  const normalizedPageSize = Math.max(1, Number(payload.pageSize) || pageSize);
  return {
    items,
    page: Math.max(1, Number(payload.page) || page),
    pageSize: normalizedPageSize,
    total,
    totalPages: Math.max(0, Number(payload.totalPages) || Math.ceil(total / normalizedPageSize)),
    hasMore: Boolean(payload.hasMore),
  };
}

async function fetchFromCosManifest(signal?: AbortSignal): Promise<ResourceItem[]> {
  if (!COS_MANIFEST_URL) return [];

  // A stale or blocked manifest must never hold the public home page in its
  // loading state. Keep this fallback bounded so the bundled display-only
  // catalog can take over quickly on networks that cannot reach COS.
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timer = window.setTimeout(() => controller.abort(), 5000);
  let response: Response;
  try {
    response = await fetch(COS_MANIFEST_URL, { cache: "no-store", signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
  if (!response.ok) {
    throw new Error(`COS manifest 拉取失败（HTTP ${response.status}）`);
  }
  const payload = (await response.json()) as unknown;
  return parseResourcePayload(payload);
}

async function fetchFromRuntimeApi(): Promise<ResourceItem[]> {
  // See fetchResourcePage above: avoid an empty 304 response being treated as
  // a failed catalog load when an unauthenticated visitor refreshes the page.
  const payload = (await apiFetch<unknown>("/api/resources", { cache: "no-store" }, {
    timeoutMs: PUBLIC_CATALOG_API_TIMEOUT_MS,
  })) as unknown;
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

  // The bundled records are sanitized above and only used as a last-resort
  // public display catalog.  Keeping this fallback in production means an
  // API/CORS/signature outage cannot hide every public cover at once.
  return getBundledPublicCatalog();
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
