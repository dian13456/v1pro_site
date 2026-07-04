import type { ResourceItem } from "../types/resource";

export function isSoftwareResource(resource: ResourceItem): boolean {
  return resource.category === "software" || resource.materialType === "v1pro-pack";
}

export function findLatestSoftware(resources: ResourceItem[]): ResourceItem | null {
  let latest: ResourceItem | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;

  for (const resource of resources) {
    if (!isSoftwareResource(resource)) continue;
    const updatedAt = new Date(resource.updatedAt).getTime();
    if (!Number.isFinite(updatedAt)) continue;
    if (updatedAt > latestTime) {
      latestTime = updatedAt;
      latest = resource;
    }
  }

  return latest;
}
