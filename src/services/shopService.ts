import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";
import type { ShopCatalogPayload, ShopRedeemResult } from "../types/shop";

export async function fetchShopCatalog(): Promise<ShopCatalogPayload> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  const auth = getAuthState();
  if (!auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  if (isStaticMode()) {
    return {
      success: true,
      credits: 100,
      likeRewardCredits: 1,
      items: [],
    };
  }
  return apiFetch<ShopCatalogPayload>("/api/shop/items", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
  });
}

export async function redeemShopItem(itemId: string): Promise<ShopRedeemResult> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  const auth = getAuthState();
  if (!auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  if (isStaticMode()) {
    throw new Error("静态模式下无法兑换商品");
  }
  return apiFetch<ShopRedeemResult>("/api/shop/redeem", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ itemId }),
  });
}
