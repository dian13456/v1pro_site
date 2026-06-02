import { isAllowedUsbDevice } from "../config/allowedDevices";
import { displayUsernameFromSerial } from "../utils/displayUsername";

const DEVICE_MISMATCH_MESSAGE = "设备不匹配，请购买正规产品";
const DEV_LIKE_COUNTS_KEY = "jiadian_dev_like_counts";
const DEV_LIKED_DEVICES_KEY = "jiadian_dev_like_devices";
const DEV_DOWNLOAD_TOTAL_KEY = "jiadian_dev_download_total_counts";
const DEV_DOWNLOAD_WEEKLY_KEY = "jiadian_dev_download_weekly_counts";
const DEV_DOWNLOAD_WEEK_KEY = "jiadian_dev_download_week_key";
const DEV_DEVICE_WINDOWS_KEY = "jiadian_dev_device_download_windows";
const DEV_MESSAGES_KEY = "jiadian_dev_messages";
const DEV_PROFILES_KEY = "jiadian_dev_profiles";
const DEV_AI_SHARE_COUNTS_KEY = "jiadian_dev_ai_share_counts";
const DEV_AI_SHARE_LIMIT = 50;
const DEV_MAX_DOWNLOADS_PER_HOUR = 50;
const DEV_MAX_DOWNLOADS_PER_DAY = 100;

export const API_BASE = import.meta.env.VITE_API_BASE || "";

type JsonValue = Record<string, unknown>;

interface DevDeviceWindow {
  hourKey: string;
  dayKey: string;
  hourCount: number;
  dayCount: number;
}

function parseQuery(path: string): URLSearchParams {
  const queryIndex = path.indexOf("?");
  if (queryIndex === -1) return new URLSearchParams();
  return new URLSearchParams(path.slice(queryIndex + 1));
}

function devHourKey(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}`;
}

function devDayKey(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function readDevDeviceWindows(): Record<string, DevDeviceWindow> {
  try {
    const raw = localStorage.getItem(DEV_DEVICE_WINDOWS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, DevDeviceWindow>) : {};
  } catch {
    return {};
  }
}

function writeDevDeviceWindows(windows: Record<string, DevDeviceWindow>): void {
  localStorage.setItem(DEV_DEVICE_WINDOWS_KEY, JSON.stringify(windows));
}

function ensureDevDeviceWindow(serial: string, now = new Date()): DevDeviceWindow {
  const hourKey = devHourKey(now);
  const dayKey = devDayKey(now);
  const windows = readDevDeviceWindows();
  const current = windows[serial];
  const next: DevDeviceWindow = {
    hourKey,
    dayKey,
    hourCount: current?.hourKey === hourKey ? Math.max(0, Number(current.hourCount) || 0) : 0,
    dayCount: current?.dayKey === dayKey ? Math.max(0, Number(current.dayCount) || 0) : 0,
  };
  windows[serial] = next;
  writeDevDeviceWindows(windows);
  return next;
}

function devDeviceLimitMessage(window: DevDeviceWindow): string | null {
  if (window.hourCount >= DEV_MAX_DOWNLOADS_PER_HOUR) {
    return `每小时最多下载${DEV_MAX_DOWNLOADS_PER_HOUR}次，请稍后再试`;
  }
  if (window.dayCount >= DEV_MAX_DOWNLOADS_PER_DAY) {
    return `每天最多下载${DEV_MAX_DOWNLOADS_PER_DAY}次，请明天再试`;
  }
  return null;
}

function recordDevDeviceDownload(serial: string, resourceId: string): JsonValue {
  const window = ensureDevDeviceWindow(serial);
  const limitMessage = devDeviceLimitMessage(window);
  if (limitMessage) {
    return {
      success: false,
      error: limitMessage,
      message: limitMessage,
      hourlyCount: window.hourCount,
      dailyCount: window.dayCount,
    };
  }

  window.hourCount += 1;
  window.dayCount += 1;
  const windows = readDevDeviceWindows();
  windows[serial] = window;
  writeDevDeviceWindows(windows);

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
    weekKey,
    totalCount: totals[resourceId],
    weeklyCount: weekly[resourceId],
    hourlyCount: window.hourCount,
    dailyCount: window.dayCount,
  };
}

function parseBody(init: RequestInit): JsonValue {
  if (!init.body || typeof init.body !== "string") return {};
  try {
    return JSON.parse(init.body) as JsonValue;
  } catch {
    return {};
  }
}

interface DevBoardMessage {
  id: string;
  username: string;
  content: string;
  createdAt: number;
  serial?: string;
}

function resolveDevDisplayName(messageSerial: string): string {
  let profiles: Record<string, string> = {};
  try {
    profiles = JSON.parse(localStorage.getItem(DEV_PROFILES_KEY) || "{}") as Record<string, string>;
  } catch {
    profiles = {};
  }
  const custom = profiles[messageSerial]?.trim();
  if (custom) return custom.slice(0, 20);
  return displayUsernameFromSerial(messageSerial);
}

function withResolvedDevUsernames(messages: DevBoardMessage[]): DevBoardMessage[] {
  return messages.map((item) => {
    if (!item.serial) return item;
    return { ...item, username: resolveDevDisplayName(item.serial) };
  });
}

function readDevMessages(): DevBoardMessage[] {
  try {
    const raw = localStorage.getItem(DEV_MESSAGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DevBoardMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeDevMessages(messages: DevBoardMessage[]): void {
  localStorage.setItem(DEV_MESSAGES_KEY, JSON.stringify(messages));
}

function parseDevMessageLimit(path: string): number {
  const queryIndex = path.indexOf("?");
  if (queryIndex === -1) return 100;
  const params = new URLSearchParams(path.slice(queryIndex + 1));
  const parsed = Number.parseInt(params.get("limit") || "100", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 100;
  return Math.min(parsed, 100);
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

  if (path.startsWith("/api/resource")) {
    if (!auth.startsWith("Bearer dev-token-")) {
      return { error: "token 无效" };
    }
    const query = parseQuery(path);
    const resourceId = query.get("id") || "0";
    const forDownload = query.get("preview") !== "1";
    const expires = Math.floor(Date.now() / 1000) + 600;
    if (forDownload) {
      const stats = recordDevDeviceDownload(serial, resourceId);
      if ("error" in stats) {
        return stats;
      }
      return {
        url: `https://example.com/dev-resource/${resourceId}?exp=${expires}&sig=dev`,
        downloadStats: stats,
      };
    }
    return {
      url: `https://example.com/dev-resource/${resourceId}?exp=${expires}&sig=dev`,
    };
  }

  if (path.startsWith("/api/image")) {
    if (!auth.startsWith("Bearer dev-token-")) {
      return { error: "token 无效" };
    }
    const query = parseQuery(path);
    const resourceId = query.get("id") || "0";
    const forDownload = query.get("download") === "1";
    const expires = Math.floor(Date.now() / 1000) + 600;
    if (forDownload) {
      const stats = recordDevDeviceDownload(serial, resourceId);
      if ("error" in stats) {
        return stats;
      }
      return {
        url: `https://example.com/dev-image/${resourceId}?exp=${expires}&sig=dev`,
        downloadStats: stats,
      };
    }
    return {
      url: `https://example.com/dev-image/${resourceId}?exp=${expires}&sig=dev`,
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
    const window = ensureDevDeviceWindow(serial);
    const limitMessage = devDeviceLimitMessage(window);
    if (limitMessage) {
      return {
        success: false,
        message: limitMessage,
        hourlyCount: window.hourCount,
        dailyCount: window.dayCount,
      };
    }
    const weekKey = localStorage.getItem(DEV_DOWNLOAD_WEEK_KEY) || "dev-week";
    const totalCounts = localStorage.getItem(DEV_DOWNLOAD_TOTAL_KEY);
    const weeklyCounts = localStorage.getItem(DEV_DOWNLOAD_WEEKLY_KEY);
    const totals = totalCounts ? (JSON.parse(totalCounts) as Record<string, number>) : {};
    const weekly = weeklyCounts ? (JSON.parse(weeklyCounts) as Record<string, number>) : {};
    return {
      success: true,
      weekKey,
      totalCount: Math.max(0, Number(totals[resourceId] || 0)),
      weeklyCount: Math.max(0, Number(weekly[resourceId] || 0)),
      hourlyCount: window.hourCount,
      dailyCount: window.dayCount,
    };
  }

  if (path.startsWith("/api/profile")) {
    if (!auth.startsWith("Bearer dev-token-")) {
      return { success: false, message: "token 无效" };
    }
    let profiles: Record<string, string> = {};
    try {
      profiles = JSON.parse(localStorage.getItem(DEV_PROFILES_KEY) || "{}") as Record<string, string>;
    } catch {
      profiles = {};
    }
    if ((init.method || "GET").toUpperCase() === "POST") {
      const displayName = String(body.displayName || "").trim().slice(0, 20);
      if (displayName) {
        profiles[serial] = displayName;
      } else {
        delete profiles[serial];
      }
      localStorage.setItem(DEV_PROFILES_KEY, JSON.stringify(profiles));
      return {
        success: true,
        serial,
        displayName: displayName || displayUsernameFromSerial(serial),
      };
    }
    return {
      success: true,
      serial,
      displayName: profiles[serial] || displayUsernameFromSerial(serial),
    };
  }

  if (path.startsWith("/api/welcome")) {
    if (!auth.startsWith("Bearer dev-token-")) {
      return { success: false, message: "token 无效" };
    }
    const displayName = parseQuery(path).get("displayName") || displayUsernameFromSerial(serial);
    const hour = new Date().getHours();
    const greeting =
      hour >= 5 && hour < 9
        ? "早上好"
        : hour >= 9 && hour < 12
          ? "上午好"
          : hour >= 14 && hour < 18
            ? "下午好"
            : hour >= 18 && hour < 23
              ? "晚上好"
              : "你好";
    return {
      success: true,
      message: `${greeting}，${displayName}！欢迎来到佳点电子资源中心。（开发模式欢迎语）`,
      username: displayName,
      city: "深圳",
      region: "广东",
      localTime: "周一 12:00",
      temperature: 26,
      weatherText: "多云",
    };
  }

  if (path.startsWith("/api/messages")) {
    if (!auth.startsWith("Bearer dev-token-")) {
      return { success: false, message: "token 无效" };
    }
    if ((init.method || "GET").toUpperCase() === "POST") {
      const content = String(body.content || "").trim();
      if (!content) {
        return { success: false, message: "留言内容不能为空" };
      }
      if (content.length > 500) {
        return { success: false, message: "留言最多500字" };
      }
      const entry: DevBoardMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        serial,
        username: String(body.displayName || "").trim() || displayUsernameFromSerial(serial),
        content,
        createdAt: Date.now(),
      };
      const messages = readDevMessages();
      messages.push(entry);
      writeDevMessages(messages);
      return { success: true, message: entry };
    }

    const limit = parseDevMessageLimit(path);
    const all = withResolvedDevUsernames(readDevMessages());
    const messages = [...all].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
    return { success: true, messages, total: all.length };
  }

  if (path === "/api/ai-guide") {
    if (!auth.startsWith("Bearer dev-token-")) {
      return { success: false, message: "token 无效" };
    }
    const question = String(body.question || "").trim();
    if (!question) {
      return { success: false, message: "question 不能为空" };
    }
    return {
      success: true,
      answer: `（开发模式）已收到你的问题：「${question}」。上线后将由 DeepSeek 返回更智能的导览结果。`,
      resourceIds: [],
      mode: "fallback",
    };
  }

  if (path === "/api/ai-image/share") {
    if (!auth.startsWith("Bearer dev-token-")) {
      return { success: false, message: "token 无效" };
    }
    let counts: Record<string, number> = {};
    try {
      counts = JSON.parse(localStorage.getItem(DEV_AI_SHARE_COUNTS_KEY) || "{}") as Record<string, number>;
    } catch {
      counts = {};
    }
    const current = Math.max(0, Number(counts[serial] || 0));
    if (current >= DEV_AI_SHARE_LIMIT) {
      return {
        success: false,
        message: `每台设备最多分享 ${DEV_AI_SHARE_LIMIT} 次，您的额度已用完（已用 ${current} 次）`,
        shareCount: current,
        shareLimit: DEV_AI_SHARE_LIMIT,
      };
    }
    const shareCount = current + 1;
    counts[serial] = shareCount;
    localStorage.setItem(DEV_AI_SHARE_COUNTS_KEY, JSON.stringify(counts));
    return {
      success: true,
      resourceId: Date.now(),
      downloadUrl: "https://www.jadot.cn/favicon.ico",
      title: String(body.prompt || "AI 生成图片").slice(0, 40),
      shareCount,
      shareLimit: DEV_AI_SHARE_LIMIT,
      shareRemaining: DEV_AI_SHARE_LIMIT - shareCount,
    };
  }

  if (path === "/api/ai-image/transfer") {
    if (!auth.startsWith("Bearer dev-token-")) {
      return { success: false, message: "token 无效" };
    }
    return {
      success: true,
      url: "https://www.jadot.cn/favicon.ico",
    };
  }

  if (path === "/api/ai-image") {
    if (!auth.startsWith("Bearer dev-token-")) {
      return { success: false, message: "token 无效" };
    }
    const prompt = String(body.prompt || "").trim();
    if (!prompt) {
      return { success: false, message: "prompt 不能为空" };
    }
    return {
      success: true,
      images: [
        "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=",
      ],
      mode: "mock",
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
    const message =
      (payload?.message as string) || (payload?.error as string) || `请求失败（HTTP ${response.status})`;
    throw new Error(message);
  }

  return (payload || {}) as T;
}
