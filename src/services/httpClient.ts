import { isAllowedUsbDevice } from "../config/allowedDevices";

const DEVICE_MISMATCH_MESSAGE = "设备不匹配，请购买正规产品";
const DEV_LIKE_COUNTS_KEY = "jiadian_dev_like_counts";
const DEV_LIKED_DEVICES_KEY = "jiadian_dev_like_devices";
const DEV_DOWNLOAD_TOTAL_KEY = "jiadian_dev_download_total_counts";
const DEV_DOWNLOAD_WEEKLY_KEY = "jiadian_dev_download_weekly_counts";
const DEV_DOWNLOAD_WEEK_KEY = "jiadian_dev_download_week_key";

export const API_BASE = import.meta.env.VITE_API_BASE || "";

type JsonValue = Record<string, unknown>;

function parseBody(init: RequestInit): JsonValue {
  if (!init.body || typeof init.body !== "string") return {};
  try {
    return JSON.parse(init.body) as JsonValue;
  } catch {
    return {};
  }
}

function createDevMockResponse(path: string, init: RequestInit): JsonValue | null {
  const body = parseBody(init);
  const headers = (init.headers || {}) as Record<string, string>;
  const auth = headers.Authorization || headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const serial = token.startsWith("dev-token-")
    ? token.replace(/^dev-token-/, "").replace(/-\d+$/, "")
    : token.split(".")[0] || "";

  if (path === "/api/auth") {
    const serial = String(body.serial || "");
    const vid = String(body.vid || "").toUpperCase();
    const pid = String(body.pid || "").toUpperCase();
    const vendorId = Number.parseInt(vid, 16);
    const productId = Number.parseInt(pid, 16);
    if (!serial || !isAllowedUsbDevice(vendorId, productId)) {
      return { success: false, message: DEVICE_MISMATCH_MESSAGE };
    }
    return { success: true, token: `dev-token-${serial}-${Date.now()}` };
  }

  if (path === "/api/verify-token") {
    return { success: auth.startsWith("Bearer dev-token-") };
  }

  if (path === "/api/download-sign") {
    if (!auth.startsWith("Bearer dev-token-")) {
      return { success: false, message: "token 无效" };
    }
    const resourceId = String(body.resourceId || "0");
    const expires = Math.floor(Date.now() / 1000) + 60;
    return {
      success: true,
      expires,
      url: `https://example.com/dev-download/${resourceId}.zip?exp=${expires}&sig=dev`,
    };
  }

  if (path === "/api/resource-likes") {
    if (!auth.startsWith("Bearer dev-token-")) {
      return { success: false, message: "token 无效" };
    }
    const rawCounts = localStorage.getItem(DEV_LIKE_COUNTS_KEY);
    const rawDevices = localStorage.getItem(DEV_LIKED_DEVICES_KEY);
    const counts = rawCounts ? (JSON.parse(rawCounts) as Record<string, number>) : {};
    const devices = rawDevices
      ? (JSON.parse(rawDevices) as Record<string, Record<string, boolean>>)
      : {};
    const likedResourceIds = Object.entries(devices[serial] || {})
      .filter(([, liked]) => Boolean(liked))
      .map(([id]) => Number.parseInt(id, 10))
      .filter((id) => Number.isFinite(id));
    return { success: true, counts, likedResourceIds };
  }

  if (path === "/api/resource-like") {
    if (!auth.startsWith("Bearer dev-token-")) {
      return { success: false, message: "token 无效" };
    }
    const resourceId = String(body.resourceId || "");
    if (!resourceId) {
      return { success: false, message: "resourceId 不能为空" };
    }
    const rawCounts = localStorage.getItem(DEV_LIKE_COUNTS_KEY);
    const rawDevices = localStorage.getItem(DEV_LIKED_DEVICES_KEY);
    const counts = rawCounts ? (JSON.parse(rawCounts) as Record<string, number>) : {};
    const devices = rawDevices
      ? (JSON.parse(rawDevices) as Record<string, Record<string, boolean>>)
      : {};
    const deviceLikes = devices[serial] || {};
    const alreadyLiked = Boolean(deviceLikes[resourceId]);
    if (!alreadyLiked) {
      deviceLikes[resourceId] = true;
      counts[resourceId] = Math.max(0, Number(counts[resourceId] || 0)) + 1;
      devices[serial] = deviceLikes;
      localStorage.setItem(DEV_LIKE_COUNTS_KEY, JSON.stringify(counts));
      localStorage.setItem(DEV_LIKED_DEVICES_KEY, JSON.stringify(devices));
    }
    return {
      success: true,
      alreadyLiked,
      liked: true,
      likeCount: Math.max(0, Number(counts[resourceId] || 0)),
    };
  }

  if (path === "/api/resource-downloads") {
    if (!auth.startsWith("Bearer dev-token-")) {
      return { success: false, message: "token 无效" };
    }
    const weekKey = localStorage.getItem(DEV_DOWNLOAD_WEEK_KEY) || "dev-week";
    const totalRaw = localStorage.getItem(DEV_DOWNLOAD_TOTAL_KEY);
    const weeklyRaw = localStorage.getItem(DEV_DOWNLOAD_WEEKLY_KEY);
    return {
      success: true,
      weekKey,
      totalCounts: totalRaw ? (JSON.parse(totalRaw) as Record<string, number>) : {},
      weeklyCounts: weeklyRaw ? (JSON.parse(weeklyRaw) as Record<string, number>) : {},
    };
  }

  if (path === "/api/resource-download") {
    if (!auth.startsWith("Bearer dev-token-")) {
      return { success: false, message: "token 无效" };
    }
    const resourceId = String(body.resourceId || "");
    if (!resourceId) {
      return { success: false, message: "resourceId 不能为空" };
    }
    const weekKey = localStorage.getItem(DEV_DOWNLOAD_WEEK_KEY) || "dev-week";
    const totalCounts = localStorage.getItem(DEV_DOWNLOAD_TOTAL_KEY);
    const weeklyCounts = localStorage.getItem(DEV_DOWNLOAD_WEEKLY_KEY);
    const totals = totalCounts ? (JSON.parse(totalCounts) as Record<string, number>) : {};
    const weekly = weeklyCounts ? (JSON.parse(weeklyCounts) as Record<string, number>) : {};
    totals[resourceId] = Math.max(0, Number(totals[resourceId] || 0)) + 1;
    weekly[resourceId] = Math.max(0, Number(weekly[resourceId] || 0)) + 1;
    localStorage.setItem(DEV_DOWNLOAD_WEEK_KEY, weekKey);
    localStorage.setItem(DEV_DOWNLOAD_TOTAL_KEY, JSON.stringify(totals));
    localStorage.setItem(DEV_DOWNLOAD_WEEKLY_KEY, JSON.stringify(weekly));
    return {
      success: true,
      weekKey,
      totalCount: totals[resourceId],
      weeklyCount: weekly[resourceId],
    };
  }

  return null;
}

export async function apiFetch<T extends JsonValue>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      ...init,
    });
  } catch {
    if (import.meta.env.DEV && path.startsWith("/api")) {
      const mocked = createDevMockResponse(path, init);
      if (mocked) return mocked as T;
    }
    throw new Error("接口不可达，请确认鉴权服务已启动");
  }

  let payload: JsonValue | null = null;
  try {
    payload = (await response.json()) as JsonValue;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (import.meta.env.DEV && path.startsWith("/api")) {
      const mocked = createDevMockResponse(path, init);
      if (mocked) return mocked as T;
    }
    const message = (payload?.message as string) || `请求失败（HTTP ${response.status})`;
    throw new Error(message);
  }

  return (payload || {}) as T;
}
