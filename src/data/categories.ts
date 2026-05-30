import type { ResourceCategory } from "../types/resource";

export const CATEGORY_OPTIONS: Array<{ value: ResourceCategory; label: string }> = [
  { value: "all", label: "全部" },
  { value: "driver", label: "驱动" },
  { value: "firmware", label: "固件" },
  { value: "software", label: "软件" },
  { value: "manual", label: "说明书" },
];
