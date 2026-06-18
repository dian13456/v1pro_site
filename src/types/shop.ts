export interface ShopEffect {
  type: "add_credits" | "reset_ai_share" | "grant_code" | string;
  amount?: number;
  code?: string;
}

export interface ShopItem {
  id: string;
  title: string;
  description: string;
  cost: number;
  effect: ShopEffect;
}

export interface ShopCatalogPayload {
  success?: boolean;
  credits?: number;
  likeRewardCredits?: number;
  items?: ShopItem[];
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
}
