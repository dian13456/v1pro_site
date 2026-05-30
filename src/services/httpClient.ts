import { isAllowedUsbDevice } from "../config/allowedDevices";

const DEVICE_MISMATCH_MESSAGE = "设备不匹配，请购买正规产品";

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
