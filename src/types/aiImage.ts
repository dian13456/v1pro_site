export type AiImageAspectRatio = "1:1" | "16:9" | "4:3" | "3:2" | "2:3" | "3:4" | "9:16" | "21:9";

export interface AiImageResponse {
  success: boolean;
  images?: string[];
  mode?: "minimax" | "mock";
  message?: string;
}

export interface AiImageTransferResponse {
  success: boolean;
  url?: string;
  message?: string;
}

export interface AiImageShareResponse {
  success: boolean;
  resourceId?: number;
  downloadUrl?: string;
  title?: string;
  message?: string;
}

export interface GeneratedAiImage {
  id: string;
  dataUrl: string;
}
