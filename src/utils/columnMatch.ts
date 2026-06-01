import { COLUMN_TAG_OPTIONS, type ColumnTagId } from "../data/columnTags";
import type { ResourceItem } from "../types/resource";

function resourceHaystack(resource: ResourceItem): string {
  return `${resource.title} ${resource.description} ${resource.author || ""}`.toLowerCase();
}

export function resourceMatchesColumn(resource: ResourceItem, columnId: ColumnTagId): boolean {
  if (resource.columnTag === columnId) {
    return true;
  }

  const column = COLUMN_TAG_OPTIONS.find((item) => item.id === columnId);
  if (!column) {
    return false;
  }

  const haystack = resourceHaystack(resource);
  return column.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}
