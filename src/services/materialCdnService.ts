const DEFAULT_MATERIAL_CDN_BASE_URL = "https://media.jadot.cn";

const LEGACY_BUCKET_PREFIXES: Readonly<Record<string, string>> = {
  "v1zip-1311844229": "resource",
  "v1image-1311844229": "image",
  "v1pro-1311844229": "software",
  "video-1311844229": "video",
  "gif-1311844229": "gif",
  "video-cover-1311844229": "video-cover",
  "gif-cover-1311844229": "gif-cover",
};

const UNIFIED_BUCKET = "v1media-1311844229";
const LEGACY_MATERIAL_CDN_HOST = "media.jadot.club";
const MATERIAL_PREFIXES = new Set([
  "resource",
  "image",
  "software",
  "video",
  "gif",
  "video-cover",
  "gif-cover",
]);

interface PublicCoverResource {
  materialType?: string;
  image?: string;
  download?: string;
}

function materialCdnBaseUrl(): URL | null {
  const configured = (
    import.meta.env.VITE_MATERIAL_CDN_BASE_URL || DEFAULT_MATERIAL_CDN_BASE_URL
  ).trim();
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== "https:") return null;
    parsed.search = "";
    parsed.hash = "";
    return parsed;
  } catch {
    return null;
  }
}

function cosBucketFromHost(hostname: string): string {
  const match = hostname.match(/^([a-z0-9-]+-\d+)\.cos\.[a-z0-9-]+\.(?:myqcloud\.com|tencentcos\.cn)$/i);
  return match?.[1]?.toLowerCase() || "";
}

function joinPath(...parts: string[]): string {
  return `/${parts
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/")}`;
}

/**
 * Converts signed URLs from the former per-type COS buckets to the unified
 * material CDN. Unknown hosts are deliberately left untouched.
 */
export function toMaterialCdnUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  const cdnBase = materialCdnBaseUrl();
  if (!trimmed || !cdnBase) return trimmed;

  let source: URL;
  try {
    source = new URL(trimmed);
  } catch {
    return trimmed;
  }
  if (source.protocol !== "https:") return trimmed;

  const sourceHost = source.hostname.toLowerCase();
  if (sourceHost === cdnBase.hostname.toLowerCase()) {
    return source.toString();
  }

  let prefix = "";
  if (sourceHost !== LEGACY_MATERIAL_CDN_HOST) {
    const bucket = cosBucketFromHost(sourceHost);
    if (!bucket) return trimmed;
    if (bucket !== UNIFIED_BUCKET) {
      prefix = LEGACY_BUCKET_PREFIXES[bucket] || "";
      if (!prefix) return trimmed;
    }
  }

  const target = new URL(cdnBase.toString());
  target.pathname = joinPath(cdnBase.pathname, prefix, source.pathname);
  // COS q-sign and the former CDN signature are origin-specific. The new CDN
  // authenticates its private COS origin itself, so forwarding them only hurts
  // cache hit rate and can make an otherwise valid URL expire.
  target.search = "";
  target.hash = "";
  return target.toString();
}

export function isMaterialCdnUrl(rawUrl: string): boolean {
  const cdnBase = materialCdnBaseUrl();
  if (!cdnBase) return false;
  try {
    return new URL(rawUrl).hostname.toLowerCase() === cdnBase.hostname.toLowerCase();
  } catch {
    return false;
  }
}

/** Builds a public, static card-cover URL from the sanitized catalog key. */
export function publicMaterialCoverUrl(resource: PublicCoverResource): string {
  const rawKey = (resource.image || "").trim();
  if (!rawKey) return "";
  if (/^https:\/\//i.test(rawKey)) return toMaterialCdnUrl(rawKey);

  const cdnBase = materialCdnBaseUrl();
  if (!cdnBase) return "";
  const normalizedKey = rawKey.replace(/^\/+/, "");
  const firstSegment = normalizedKey.split("/", 1)[0]?.toLowerCase() || "";
  const prefix = MATERIAL_PREFIXES.has(firstSegment)
    ? ""
    : resource.materialType === "video"
      ? "video-cover"
      : resource.materialType === "gif"
        ? "gif-cover"
        : "image";
  const target = new URL(cdnBase.toString());
  target.pathname = joinPath(cdnBase.pathname, prefix, normalizedKey);
  target.search = "";
  target.hash = "";
  return target.toString();
}
