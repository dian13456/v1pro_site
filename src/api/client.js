export const API_BASE = import.meta.env.VITE_API_BASE || "";

function getBodyObject(options) {
  if (!options?.body) return {};
  if (typeof options.body === "string") {
    try {
      return JSON.parse(options.body);
    } catch {
      return {};
    }
  }
  return {};
}

function createDevMockResponse(path, options) {
  const body = getBodyObject(options);
  const authHeader = options?.headers?.Authorization || options?.headers?.authorization || "";

  if (path === "/api/auth") {
    if (!body?.serial || !body?.vid || !body?.pid) {
      return { success: false, message: "参数不完整" };
    }
    if (String(body.vid).toUpperCase() !== "0483" || String(body.pid).toUpperCase() !== "66AA") {
      return { success: false, message: "设备 VID/PID 不匹配" };
    }
    return {
      success: true,
      token: `dev-token-${body.serial}-${Date.now()}`,
    };
  }

  if (path === "/api/verify-token") {
    return { success: authHeader.startsWith("Bearer dev-token-") };
  }

  if (path === "/api/download-sign") {
    if (!authHeader.startsWith("Bearer dev-token-")) {
      return { success: false, message: "token 无效" };
    }
    const expires = Math.floor(Date.now() / 1000) + 60;
    const productId = body?.productId || "product";
    const resourceType = body?.resourceType || "resource";
    return {
      success: true,
      expires,
      url: `https://example.com/dev-download/${productId}/${resourceType}.zip?exp=${expires}&sig=dev-signature`,
    };
  }

  return null;
}

export async function apiFetch(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      ...options,
    });
  } catch {
    if (import.meta.env.DEV && path.startsWith("/api")) {
      const mock = createDevMockResponse(path, options);
      if (mock) return mock;
    }
    throw new Error("接口不可达，请确认 Worker 服务已启动");
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    let message = data?.message || "";
    if (!message && response.status === 404 && path.startsWith("/api")) {
      message = "鉴权接口未启动，请先运行 Cloudflare Worker";
    }
    if (!message && response.status >= 500 && path.startsWith("/api")) {
      if (import.meta.env.DEV) {
        const mock = createDevMockResponse(path, options);
        if (mock) return mock;
      }
      message = "本地鉴权服务异常，请确认 Worker 已启动（127.0.0.1:8787）";
    }
    if (!message) {
      message = `请求失败（HTTP ${response.status}）`;
    }
    throw new Error(message);
  }

  return data;
}
