export type PromoCampaignId = "cnc-repurchase-bonus" | "video-like-free-order";

export type PromoSubmissionStatus = "pending" | "approved" | "rejected";

export interface PromoCampaign {
  id: PromoCampaignId;
  title: string;
  summary: string;
  description: string;
  choiceGroup: string;
  status: string;
  startTime: number;
  endTime: number;
  quotaLimit: number;
  submittedCount: number;
  quotaFull: boolean;
}

export interface PromoUserSubmission {
  id: string;
  campaignId: PromoCampaignId;
  status: PromoSubmissionStatus;
  adminNote?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PromoOverview {
  choiceGroup: string;
  rule: string;
  campaigns: PromoCampaign[];
  current?: PromoUserSubmission;
  lockedCampaignId?: PromoCampaignId;
}

export interface PromoSubmissionRecord {
  id: string;
  campaignId: PromoCampaignId;
  choiceGroup: string;
  userSerial: string;
  orderNo: string;
  orderScreenshotUrl: string;
  injectionColorNote?: string;
  shippingAddress?: string;
  videoLink?: string;
  paymentQrUrl?: string;
  status: PromoSubmissionStatus;
  adminNote?: string;
  createdAt: number;
  updatedAt: number;
}

export const PROMO_STATUS_LABEL: Record<PromoSubmissionStatus, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
};

export const PROMO_CAMPAIGN_QUOTA_LIMIT = 260;

export const PROMO_CAMPAIGN_LABEL: Record<PromoCampaignId, string> = {
  "cnc-repurchase-bonus": "CNC复购加送注塑V1PRO",
  "video-like-free-order": "视频点赞免单",
};
