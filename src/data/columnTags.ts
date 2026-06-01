import bundledColumnTags from "./columnTags.json";

export interface ColumnTagOption {
  id: string;
  label: string;
  keywords: string[];
}

export type ColumnTagFilter = "all" | string;

export const DEFAULT_COLUMN_TAG_OPTIONS = bundledColumnTags as ColumnTagOption[];

export function buildColumnTagFilterOptions(
  options: ColumnTagOption[]
): Array<{ value: ColumnTagFilter; label: string }> {
  return [
    { value: "all", label: "全部专栏" },
    ...options.map((item) => ({ value: item.id, label: item.label })),
  ];
}
