import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { fetchProfile } from "./profileService";
import { isStaticMode } from "./runtimeMode";
import { getCustomDisplayName } from "./welcomeService";

export interface CreditLeaderboardEntry {
  rank: number;
  displayName: string;
  creatorName?: string;
  credits: number;
  avatarUrl?: string;
  isCurrent?: boolean;
}

export interface CreditLeaderboardPayload extends Record<string, unknown> {
  success?: boolean;
  entries?: CreditLeaderboardEntry[];
  current?: CreditLeaderboardEntry | null;
  totalUsers?: number;
  updatedAt?: string;
  message?: string;
}

export async function fetchCreditLeaderboard(): Promise<CreditLeaderboardPayload> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  const auth = getAuthState();
  if (isStaticMode()) {
    const profile = await fetchProfile();
    const current: CreditLeaderboardEntry = {
      rank: 1,
      displayName: getCustomDisplayName(auth?.serial || "") || "佳点用户",
      creatorName: getCustomDisplayName(auth?.serial || "") || profile.displayName || "佳点用户",
      credits: typeof profile.credits === "number" ? profile.credits : 0,
      avatarUrl: profile.avatarUrl,
      isCurrent: true,
    };
    return {
      success: true,
      entries: [current],
      current,
      totalUsers: 1,
      updatedAt: new Date().toISOString(),
    };
  }

  if (!auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  return apiFetch<CreditLeaderboardPayload>("/api/leaderboard/credits", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
  });
}
