import { apiFetch } from "./httpClient";
import type { AuthState } from "../types/resource";
import { isStaticMode } from "./runtimeMode";

const AUTH_STORAGE_KEY = "jiadian_hub_auth";
const TARGET_VID = 0x0483;
const TARGET_PID = 0x66aa;

interface AuthApiResponse {
  success: boolean;
  token?: string;
  message?: string;
}

interface VerifyApiResponse {
  success: boolean;
}

function mapUsbError(error: unknown): Error {
  const domError = error as DOMException;
  switch (domError?.name) {
    case "NotFoundError":
      return new Error("未选择设备，请在弹窗中选择授权USB设备");
    case "NotAllowedError":
    case "AbortError":
      return new Error("浏览器取消了设备授权，请重试");
    case "SecurityError":
      return new Error("浏览器阻止USB访问，请使用 Edge/Chrome 打开 localhost");
    case "NotSupportedError":
      return new Error("当前浏览器不支持 WebUSB，请使用最新版 Edge/Chrome");
    default:
      return new Error(domError?.message || "USB 设备验证失败");
  }
}

export function getAuthState(): AuthState | null {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuthState;
  } catch {
    return null;
  }
}

export function clearAuthState(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function hasValidLocalAuth(): boolean {
  const state = getAuthState();
  return Boolean(
    state?.token &&
      state?.serial &&
      state?.vendorId === TARGET_VID &&
      state?.productId === TARGET_PID
  );
}

export async function verifyTokenRemote(): Promise<boolean> {
  const state = getAuthState();
  if (!state?.token) return false;
  if (isStaticMode()) return true;

  try {
    const result = await apiFetch<VerifyApiResponse>("/api/verify-token", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${state.token}`,
      },
    });
    return Boolean(result.success);
  } catch {
    clearAuthState();
    return false;
  }
}

export async function requestUsbAndAuthorize(): Promise<AuthState> {
  if (!("usb" in navigator)) {
    throw new Error("当前浏览器不支持 WebUSB，请使用最新版 Edge/Chrome");
  }
  if (!window.isSecureContext) {
    throw new Error("当前页面不是安全上下文，请通过 localhost 或 HTTPS 访问");
  }

  let device: USBDevice;
  try {
    device = await navigator.usb.requestDevice({ filters: [] });
  } catch (error) {
    throw mapUsbError(error);
  }

  const { vendorId, productId, serialNumber } = device;
  if (vendorId !== TARGET_VID || productId !== TARGET_PID || !serialNumber) {
    throw new Error("未检测到授权设备");
  }

  let token = "";
  if (isStaticMode()) {
    token = `local-token-${serialNumber}-${Date.now()}`;
  } else {
    const authResult = await apiFetch<AuthApiResponse>("/api/auth", {
      method: "POST",
      body: JSON.stringify({
        serial: serialNumber,
        vid: vendorId.toString(16).padStart(4, "0"),
        pid: productId.toString(16).padStart(4, "0"),
      }),
    });

    if (!authResult.success || !authResult.token) {
      throw new Error(authResult.message || "设备认证失败");
    }
    token = authResult.token;
  }

  const state: AuthState = {
    token,
    serial: serialNumber,
    vendorId,
    productId,
    verifiedAt: Date.now(),
  };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state));
  return state;
}
