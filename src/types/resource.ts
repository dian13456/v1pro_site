export type ResourceCategory = "all" | "gif" | "driver" | "firmware" | "software" | "manual";
export type MaterialType = "image" | "v1pro-pack";
export type MaterialTypeFilter = "all" | MaterialType;

export interface ResourceItem {
  id: number;
  title: string;
  description: string;
  size: string;
  image: string;
  download: string;
  category: Exclude<ResourceCategory, "all">;
  materialType: MaterialType;
  updatedAt: string;
}

export interface AuthState {
  token: string;
  serial: string;
  vendorId: number;
  productId: number;
  verifiedAt: number;
}
