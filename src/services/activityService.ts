import type {
  ActivityAdminItem,
  ActivityJoinRecord,
  ActivityWinnerRecord,
  LotteryActivity,
  LotteryJoinResult,
  PrizeInfoStatus,
  PrizeInfoSubmitResult,
  WinnerContactInfo,
} from "../types/activity";
import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";

function authHeaders(): Record<string, string> {
  const auth = getAuthState();
  if (!auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  return { Authorization: `Bearer ${auth.token}` };
}

export async function fetchCurrentLotteryActivity(): Promise<LotteryActivity> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  if (isStaticMode()) {
    const now = Date.now();
    return {
      id: "lottery-default",
      title: "设备用户专属抽奖活动",
      description: "购买设备即可使用 SN 码参与",
      rule: "每24小时自动开奖一次；每个有效设备 SN 每24小时只能参与一次。",
      startTime: now - 86400000,
      endTime: now + 86400000 * 365,
      status: "active",
      prizeTitle: "V1PRO 限定周边礼包",
      prizeDescription: "含定制壳子、贴纸与品牌周边。",
      drawHour: 20,
      drawMinute: 0,
      winnersPerDraw: 1,
      shippingDays: 7,
      participantCount: 0,
      nextDrawAt: now + 3600000,
      hasJoined: false,
    };
  }
  const payload = await apiFetch<{ success: boolean; activity: LotteryActivity; message?: string }>(
    "/api/activity/lottery/current",
    { method: "GET", headers: authHeaders() },
  );
  if (!payload.success || !payload.activity) {
    throw new Error(payload.message || "加载活动失败");
  }
  return payload.activity;
}

export async function joinLotteryActivity(sn: string, activityId?: string): Promise<LotteryJoinResult> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  if (isStaticMode()) {
    return { success: true, message: "报名成功，开奖后系统会自动通知（静态模式）" };
  }
  return apiFetch<LotteryJoinResult>("/api/activity/lottery/join", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ sn, activityId }),
  });
}

export async function fetchPrizeInfoStatus(): Promise<PrizeInfoStatus> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  if (isStaticMode()) {
    return { isWinner: false };
  }
  const payload = await apiFetch<{ success: boolean; data: PrizeInfoStatus }>("/api/activity/lottery/prize-info", {
    method: "GET",
    headers: authHeaders(),
  });
  return payload.data;
}

export async function submitPrizeInfo(input: {
  winnerId: string;
  name: string;
  phone: string;
  wechat: string;
  province: string;
  city: string;
  address: string;
}): Promise<PrizeInfoSubmitResult> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  if (isStaticMode()) {
    throw new Error("静态模式下无法提交中奖信息");
  }
  return apiFetch<PrizeInfoSubmitResult>("/api/activity/lottery/prize-info", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

function adminHeaders(adminToken: string): Record<string, string> {
  return { "X-Review-Admin-Token": adminToken };
}

export async function adminFetchActivities(adminToken: string): Promise<ActivityAdminItem[]> {
  const payload = await apiFetch<{ success: boolean; activities: ActivityAdminItem[] }>("/api/admin/activities", {
    method: "GET",
    headers: adminHeaders(adminToken),
  });
  return payload.activities || [];
}

export async function adminSaveActivity(adminToken: string, activity: Partial<ActivityAdminItem>): Promise<ActivityAdminItem> {
  const payload = await apiFetch<{ success: boolean; activity: ActivityAdminItem; message?: string }>("/api/admin/activities", {
    method: "POST",
    headers: { ...adminHeaders(adminToken), "Content-Type": "application/json" },
    body: JSON.stringify(activity),
  });
  return payload.activity;
}

export async function adminFetchJoins(adminToken: string, activityId: string): Promise<ActivityJoinRecord[]> {
  const payload = await apiFetch<{ success: boolean; joins: ActivityJoinRecord[] }>(
    `/api/admin/activities/${encodeURIComponent(activityId)}/joins`,
    { method: "GET", headers: adminHeaders(adminToken) },
  );
  return payload.joins || [];
}

export async function adminFetchWinners(adminToken: string, activityId: string): Promise<ActivityWinnerRecord[]> {
  const payload = await apiFetch<{ success: boolean; winners: ActivityWinnerRecord[] }>(
    `/api/admin/activities/${encodeURIComponent(activityId)}/winners`,
    { method: "GET", headers: adminHeaders(adminToken) },
  );
  return payload.winners || [];
}

export async function adminFetchWinnerContact(adminToken: string, winnerId: string): Promise<WinnerContactInfo> {
  const payload = await apiFetch<{ success: boolean; contact: WinnerContactInfo }>(
    `/api/admin/winners/${encodeURIComponent(winnerId)}/contact`,
    { method: "GET", headers: adminHeaders(adminToken) },
  );
  return payload.contact;
}

export async function adminUpdateShipping(adminToken: string, winnerId: string, shippingStatus: string): Promise<void> {
  await apiFetch("/api/admin/winners/" + encodeURIComponent(winnerId) + "/shipping", {
    method: "POST",
    headers: { ...adminHeaders(adminToken), "Content-Type": "application/json" },
    body: JSON.stringify({ shippingStatus }),
  });
}

export async function adminTriggerDraw(adminToken: string, activityId: string, period?: string, force = false) {
  return apiFetch("/api/admin/activities/" + encodeURIComponent(activityId) + "/draw", {
    method: "POST",
    headers: { ...adminHeaders(adminToken), "Content-Type": "application/json" },
    body: JSON.stringify({ period, force }),
  });
}

export async function adminRegisterDevice(adminToken: string, serial: string, source = "admin") {
  return apiFetch("/api/admin/devices", {
    method: "POST",
    headers: { ...adminHeaders(adminToken), "Content-Type": "application/json" },
    body: JSON.stringify({ serial, source }),
  });
}
