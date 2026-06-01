import type { ColumnTagOption } from "../data/columnTags";
import type { ResourceItem } from "../types/resource";

function resourceHaystack(resource: ResourceItem): string {
  return `${resource.title} ${resource.description} ${resource.author || ""}`.toLowerCase();
}

export function resourceMatchesColumn(
  resource: ResourceItem,
  columnId: string,
  options: ColumnTagOption[]
): boolean {
  if (resource.columnTag === columnId) {
    return true;
  }

  const column = options.find((item) => item.id === columnId);
  if (!column) {
    return false;
  }

  const haystack = resourceHaystack(resource);
  return column.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
}
