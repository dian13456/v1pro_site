import { apiFetch } from "./client";

const AUTH_STORAGE_KEY = "jiadian_hub_auth";
const TARGET_VID = 0x0483;
const TARGET_PID = 0x66aa;

export function getAuthState() {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function hasValidLocalAuth() {
  const auth = getAuthState();
  return Boolean(auth?.token && auth?.serial && auth?.vendorId === TARGET_VID && auth?.productId === TARGET_PID);
}

export function clearAuthState() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

function saveAuthState(payload) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
}

function normalizeUsbError(error) {
  const domError = error;

  if (domError?.name === "NotFoundError") {
    return new Error("未选择设备，请在弹窗中选择授权USB设备");
  }
  if (domError?.name === "NotAllowedError" || domError?.name === "AbortError") {
    return new Error("浏览器拒绝或取消了设备选择，请重试并允许USB访问");
  }
  if (domError?.name === "SecurityError") {
    return new Error("浏览器阻止了 USB 访问，请使用 localhost 或 HTTPS，并检查站点USB权限");
  }
  if (domError?.name === "NetworkError") {
    return new Error("设备连接异常，请重新插拔后再试");
  }
  if (domError?.name === "NotSupportedError") {
    return new Error("当前环境不支持 WebUSB，请使用最新版 Chrome/Edge");
  }
  if (domError?.name === "TypeError") {
    return new Error("USB 调用参数异常，请刷新页面后重试");
  }

  return new Error(domError?.message || "USB 设备验证失败，请重试");
}

export async function verifyTokenRemote() {
  const auth = getAuthState();
  if (!auth?.token) return false;

  try {
    const result = await apiFetch("/api/verify-token", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    });
    return Boolean(result?.success);
  } catch {
    clearAuthState();
    return false;
  }
}

export async function requestUsbAndAuthorize() {
  if (!("usb" in navigator)) {
    throw new Error("当前浏览器不支持 WebUSB，请使用最新版 Chrome/Edge");
  }
  if (!window.isSecureContext) {
    throw new Error("当前页面不是安全上下文，请使用 http://localhost:5173 或 HTTPS 访问");
  }
  if (window.top !== window.self) {
    throw new Error("当前页面运行在 iframe 中，WebUSB 需要顶层页面打开");
  }

  let device;
  try {
    device = await navigator.usb.requestDevice({
      // Show all USB devices first, then enforce VID/PID in code.
      // This avoids picker flashing closed when strict filters find nothing.
      filters: [],
    });
  } catch (error) {
    throw normalizeUsbError(error);
  }

  const { vendorId, productId, serialNumber } = device;
  if (vendorId !== TARGET_VID || productId !== TARGET_PID || !serialNumber) {
    throw new Error("未检测到授权设备");
  }

  const authResult = await apiFetch("/api/auth", {
    method: "POST",
    body: JSON.stringify({
      serial: serialNumber,
      vid: vendorId.toString(16).padStart(4, "0"),
      pid: productId.toString(16).padStart(4, "0"),
    }),
  });

  if (!authResult?.success || !authResult?.token) {
    throw new Error("设备认证失败");
  }

  const state = {
    token: authResult.token,
    serial: serialNumber,
    vendorId,
    productId,
    verifiedAt: Date.now(),
  };

  saveAuthState(state);
  return state;
}
