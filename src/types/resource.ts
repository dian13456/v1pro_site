export type ResourceCategory = "all" | "gif" | "driver" | "firmware" | "software" | "manual";
export type MaterialType = "image" | "video" | "gif" | "v1pro-pack";
export type MaterialTypeFilter = "all" | MaterialType;
export type ColumnTagFilter = "all" | string;

export interface ResourceItem {
  id: number;
  title: string;
  description: string;
  author?: string;
  columnTag?: string;
  size: string;
  image: string;
  download: string;
  category: Exclude<ResourceCategory, "all">;
  materialType: MaterialType;
  updatedAt: string;
  /** Media duration generated during upload/catalog indexing. */
  durationSec?: number;
  /** Original animation/video frame count when known. */
  sourceFrameCount?: number;
  width?: number;
  height?: number;
  likeCount?: number;
  liked?: boolean;
}

export interface AuthState {
  token: string;
  serial: string;
  vendorId: number;
  productId: number;
  verifiedAt: number;
  displayName?: string;
}
