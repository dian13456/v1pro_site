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

export function buildShareColumnTagOptions(
  options: ColumnTagOption[]
): Array<{ value: string; label: string }> {
  const merged = [...options];
  if (!merged.some((item) => item.id === "other")) {
    merged.push({ id: "other", label: "其他", keywords: ["其他"] });
  }
  return [
    { value: "", label: "不选择专栏" },
    ...merged.map((item) => ({ value: item.id, label: item.label })),
  ];
}
