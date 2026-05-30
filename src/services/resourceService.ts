import resourceData from "../data/resources.json";
import type { ResourceItem } from "../types/resource";

type ResourceRecord = Partial<ResourceItem> & {
  id?: number;
  title?: string;
  description?: string;
  size?: string;
  image?: string;
  download?: string;
  category?: ResourceItem["category"];
  materialType?: ResourceItem["materialType"];
  updatedAt?: string;
};

const COS_MANIFEST_URL = import.meta.env.VITE_COS_RESOURCE_MANIFEST_URL || "";
const COS_PUBLIC_BASE_URL = import.meta.env.VITE_COS_PUBLIC_BASE_URL || "";

function sortByUpdatedAtDesc(items: ResourceItem[]): ResourceItem[] {
  return [...items].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function toAbsoluteUrl(url: string): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (!COS_PUBLIC_BASE_URL) return url;
  return `${COS_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
}

function normalizeRecord(item: ResourceRecord): ResourceItem | null {
  if (!item.id || !item.title || !item.description || !item.image || !item.download || !item.category) {
    return null;
  }

  const updated = item.updatedAt || new Date().toISOString();

  return {
    id: item.id,
    title: item.title,
    description: item.description,
    size: item.size || "未知",
    image: toAbsoluteUrl(item.image),
    download: toAbsoluteUrl(item.download),
    category: item.category,
    materialType: item.materialType || "v1pro-pack",
    updatedAt: updated,
  };
}

async function fetchFromCosManifest(): Promise<ResourceItem[]> {
  if (!COS_MANIFEST_URL) return [];

  const response = await fetch(COS_MANIFEST_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`COS manifest 拉取失败（HTTP ${response.status}）`);
  }
  const payload = (await response.json()) as ResourceRecord[];
  return payload.map(normalizeRecord).filter((item): item is ResourceItem => item !== null);
}

export async function fetchResources(): Promise<ResourceItem[]> {
  try {
    const remote = await fetchFromCosManifest();
    if (remote.length > 0) {
      return sortByUpdatedAtDesc(remote);
    }
  } catch {
    // Keep local fallback for dev/proxy failure.
  }

  const localValidated = (resourceData as ResourceRecord[])
    .map(normalizeRecord)
    .filter((item): item is ResourceItem => item !== null);
  return sortByUpdatedAtDesc(localValidated);
}
