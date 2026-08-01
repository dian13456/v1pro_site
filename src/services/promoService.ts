import type {
  PromoCampaignId,
  PromoOverview,
  PromoSubmissionRecord,
  PromoUserSubmission,
} from "../types/promo";
import { getAuthState, hasValidLocalAuth } from "./authService";
import { API_BASE, apiFetch, formatClientError } from "./httpClient";
import { isStaticMode } from "./runtimeMode";

function authHeaders(): Record<string, string> {
  const auth = getAuthState();
  if (!auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  return { Authorization: `Bearer ${auth.token}` };
}

function adminHeaders(adminToken: string): Record<string, string> {
  return { "X-Review-Admin-Token": adminToken };
}

export async function fetchPromoOverview(): Promise<PromoOverview> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  if (isStaticMode()) {
    const now = Date.now();
    return {
      choiceGroup: "promo-choice-2026-spring",
      rule: "以下两个活动只能二选一参与。",
      campaigns: [
        {
          id: "cnc-repurchase-bonus",
          title: "CNC用户复购加送注塑V1PRO",
          summary: "复购 CNC 喵喵壳子，加送一个注塑 V1PRO。",
          description: "提交 CNC 订单号、订单截图、注塑颜色备注与收货地址。",
          choiceGroup: "promo-choice-2026-spring",
          status: "active",
          startTime: now - 86400000,
          endTime: now + 86400000 * 120,
        },
        {
          id: "video-like-free-order",
          title: "视频点赞免单活动",
          summary: "发布视频获赞达标，可申请订单免单。",
          description: "提交订单号、订单截图、视频链接与收款码。",
          choiceGroup: "promo-choice-2026-spring",
          status: "active",
          startTime: now - 86400000,
          endTime: now + 86400000 * 120,
        },
      ],
    };
  }
  const payload = await apiFetch<{ success: boolean; overview: PromoOverview; message?: string }>(
    "/api/activity/promo/overview",
    { method: "GET", headers: authHeaders() },
  );
  if (!payload.success || !payload.overview) {
    throw new Error(payload.message || "加载活动失败");
  }
  return payload.overview;
}

export async function submitPromoApplication(input: {
  campaignId: PromoCampaignId;
  orderNo: string;
  orderScreenshotUrl: string;
  injectionColorNote?: string;
  shippingAddress?: string;
  videoLink?: string;
  paymentQrUrl?: string;
}): Promise<{ message: string; submission: PromoUserSubmission }> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  if (isStaticMode()) {
    return {
      message: "提交成功（静态模式）",
      submission: {
        id: "promo_static",
        campaignId: input.campaignId,
        status: "pending",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    };
  }
  const payload = await apiFetch<{
    success: boolean;
    message?: string;
    submission: PromoUserSubmission;
  }>("/api/activity/promo/submit", {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!payload.success || !payload.submission) {
    throw new Error(payload.message || "提交失败");
  }
  return { message: payload.message || "提交成功", submission: payload.submission };
}

export async function uploadPromoImage(file: File): Promise<string> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  if (isStaticMode()) {
    return URL.createObjectURL(file);
  }
  const form = new FormData();
  form.append("file", file);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/activity/promo/upload-image`, {
      method: "POST",
      headers: authHeaders(),
      body: form,
    });
  } catch (err) {
    throw new Error(formatClientError(err, "上传图片失败"));
  }
  const payload = (await response.json()) as { success?: boolean; imageUrl?: string; message?: string };
  if (!response.ok || !payload.success || !payload.imageUrl) {
    throw new Error(payload.message || `上传失败（HTTP ${response.status})`);
  }
  return payload.imageUrl;
}

export async function adminFetchPromoSubmissions(
  adminToken: string,
  campaignId = "",
  status = "",
): Promise<PromoSubmissionRecord[]> {
  const params = new URLSearchParams();
  if (campaignId) params.set("campaignId", campaignId);
  if (status) params.set("status", status);
  const query = params.toString() ? `?${params.toString()}` : "";
  const payload = await apiFetch<{ success: boolean; submissions: PromoSubmissionRecord[] }>(
    `/api/admin/promo/submissions${query}`,
    { method: "GET", headers: adminHeaders(adminToken) },
  );
  return payload.submissions || [];
}

export async function adminFetchPromoSubmissionDetail(
  adminToken: string,
  id: string,
): Promise<PromoSubmissionRecord> {
  const payload = await apiFetch<{ success: boolean; submission: PromoSubmissionRecord }>(
    `/api/admin/promo/submissions/${encodeURIComponent(id)}`,
    { method: "GET", headers: adminHeaders(adminToken) },
  );
  if (!payload.submission) {
    throw new Error("记录不存在");
  }
  return payload.submission;
}

export async function adminReviewPromoSubmission(
  adminToken: string,
  id: string,
  status: "pending" | "approved" | "rejected",
  adminNote = "",
): Promise<PromoSubmissionRecord> {
  const payload = await apiFetch<{ success: boolean; submission: PromoSubmissionRecord; message?: string }>(
    `/api/admin/promo/submissions/${encodeURIComponent(id)}/review`,
    {
      method: "POST",
      headers: { ...adminHeaders(adminToken), "Content-Type": "application/json" },
      body: JSON.stringify({ status, adminNote }),
    },
  );
  if (!payload.submission) {
    throw new Error(payload.message || "更新失败");
  }
  return payload.submission;
}
