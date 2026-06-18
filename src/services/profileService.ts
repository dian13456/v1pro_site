import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";

export const DEFAULT_AI_CREDITS = 100;
export const AI_CREDIT_COST = 1;

const DEV_AI_CREDITS_KEY = "jiadian_dev_ai_credits";

export interface ProfilePayload {
  success?: boolean;
  serial?: string;
  displayName?: string;
  credits?: number;
  creditsDefault?: number;
  creditCost?: number;
  likeRewardCredits?: number;
  message?: string;
}

function readDevCredits(serial: string): number {
  try {
    const map = JSON.parse(localStorage.getItem(DEV_AI_CREDITS_KEY) || "{}") as Record<string, number>;
    const balance = map[serial];
    if (typeof balance === "number" && Number.isFinite(balance)) {
      return Math.max(0, Math.floor(balance));
    }
  } catch {
    // ignore
  }
  return DEFAULT_AI_CREDITS;
}

function writeDevCredits(serial: string, balance: number): void {
  try {
    const map = JSON.parse(localStorage.getItem(DEV_AI_CREDITS_KEY) || "{}") as Record<string, number>;
    map[serial] = Math.max(0, Math.floor(balance));
    localStorage.setItem(DEV_AI_CREDITS_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function spendDevCredits(serial: string, cost = AI_CREDIT_COST): number {
  const balance = readDevCredits(serial);
  if (balance < cost) {
    throw new Error(`积分不足，剩余 ${balance}，每次生图消耗 ${cost} 积分`);
  }
  const next = balance - cost;
  writeDevCredits(serial, next);
  return next;
}

export function refundDevCredits(serial: string, amount = AI_CREDIT_COST): number {
  const next = readDevCredits(serial) + amount;
  writeDevCredits(serial, next);
  return next;
}

export async function fetchProfile(): Promise<ProfilePayload> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  const auth = getAuthState();
  const serial = auth?.serial || "";

  if (isStaticMode()) {
    return {
      success: true,
      serial,
      credits: readDevCredits(serial),
      creditsDefault: DEFAULT_AI_CREDITS,
      creditCost: AI_CREDIT_COST,
    };
  }

  if (!auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  return apiFetch<ProfilePayload>("/api/profile", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
  });
}
