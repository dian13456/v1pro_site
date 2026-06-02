export type AiImageAspectRatio = "1:1" | "16:9" | "4:3" | "3:2" | "2:3" | "3:4" | "9:16" | "21:9";

export interface AiImageResponse {
  success: boolean;
  images?: string[];
  mode?: "minimax" | "mock";
  message?: string;
  credits?: number;
  creditsRemaining?: number;
  creditCost?: number;
}

export interface GenerateAiImagesResult {
  images: GeneratedAiImage[];
  creditsRemaining?: number;
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
  shareCount?: number;
  shareLimit?: number;
  shareRemaining?: number;
  message?: string;
  pendingReview?: boolean;
  reviewId?: string;
  label?: string;
  subLabel?: string;
  score?: number;
}

export interface AiImagePendingReviewResponse {
  success?: boolean;
  pendingReview?: boolean;
  reviewId?: string;
  message?: string;
  label?: string;
  subLabel?: string;
  score?: number;
}

export interface GeneratedAiImage {
  id: string;
  dataUrl: string;
  source?: "ai" | "upload";
  fileName?: string;
}
