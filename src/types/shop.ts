import type { CreditLedgerEntry } from "./credits";

export interface ShopEffect {
  type: "add_credits" | "reset_ai_share" | "grant_code" | "physical" | string;
  amount?: number;
  code?: string;
  productId?: string;
}

export interface ShopItem {
  id: string;
  title: string;
  description: string;
  cost: number;
  effect: ShopEffect;
  stock?: number;
}

export interface ShopCatalogPayload {
  success?: boolean;
  credits?: number;
  likeRewardCredits?: number;
  actorLikeRewardCredits?: number;
  actorLikeDailyCapCredits?: number;
  actorLikeDailyLimit?: number;
  downloadRewardCredits?: number;
  downloadDailyCapCredits?: number;
  items?: ShopItem[];
  creditLedger?: CreditLedgerEntry[];
  message?: string;
}

export interface ShopRedeemResult {
  success?: boolean;
  message?: string;
  itemId?: string;
  title?: string;
  cost?: number;
  creditsRemaining?: number;
  rewardCredits?: number;
  redeemCode?: string;
  shareCount?: number;
  shareRemaining?: number;
  orderId?: string;
  orderStatus?: string;
}
