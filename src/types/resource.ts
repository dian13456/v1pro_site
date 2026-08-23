export type ResourceCategory = "all" | "gif" | "driver" | "firmware" | "software" | "manual";
export type MaterialType = "image" | "video" | "gif" | "v1pro-pack";
export type MaterialTypeFilter = "all" | MaterialType;
export type ColumnTagFilter = "all" | string;

export interface ResourceTransferDefaults {
  targetFrameCapacities: Array<77 | 154 | 308>;
  videoFps: 20 | 25 | 30;
  fitMode: "fill" | "contain";
  rotationDeg: 0 | 90 | 180 | 270;
  colorProfile: "normal" | "vivid" | "professional";
}

export interface ResourceItem {
  id: number;
  title: string;
  description: string;
  author?: string;
  /** Available only in local development data; production APIs keep device SN private. */
  uploaderSerial?: string;
  uploaderBlockable?: boolean;
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
  /** Uploader-selected defaults used when this resource is transferred. */
  transferDefaults?: ResourceTransferDefaults;
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
