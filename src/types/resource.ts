export type ResourceCategory = "all" | "gif" | "driver" | "firmware" | "software" | "manual";
export type MaterialType = "image" | "video" | "gif" | "v1pro-pack";
export type MaterialTypeFilter = "all" | MaterialType;
export type { ColumnTagFilter, ColumnTagId } from "../data/columnTags";

export interface ResourceItem {
  id: number;
  title: string;
  description: string;
  author?: string;
  columnTag?: ColumnTagId;
  size: string;
  image: string;
  download: string;
  category: Exclude<ResourceCategory, "all">;
  materialType: MaterialType;
  updatedAt: string;
  likeCount?: number;
  liked?: boolean;
}

export interface AuthState {
  token: string;
  serial: string;
  vendorId: number;
  productId: number;
  verifiedAt: number;
}
