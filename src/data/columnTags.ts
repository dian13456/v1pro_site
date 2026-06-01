export type ColumnTagId = "yuexin-miao" | "doro" | "feibi";
export type ColumnTagFilter = "all" | ColumnTagId;

export interface ColumnTagOption {
  id: ColumnTagId;
  label: string;
  keywords: string[];
}

export const COLUMN_TAG_OPTIONS: ColumnTagOption[] = [
  { id: "yuexin-miao", label: "月薪喵", keywords: ["月薪喵", "月薪"] },
  { id: "doro", label: "doro", keywords: ["doro"] },
  { id: "feibi", label: "菲比", keywords: ["菲比"] },
];

export const COLUMN_TAG_FILTER_OPTIONS: Array<{ value: ColumnTagFilter; label: string }> = [
  { value: "all", label: "全部专栏" },
  ...COLUMN_TAG_OPTIONS.map((item) => ({ value: item.id, label: item.label })),
];
