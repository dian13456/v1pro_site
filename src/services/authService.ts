import { ALLOWED_USB_DEVICES, formatUsbDeviceId, isAllowedUsbDevice, usbDeviceFilters } from "../config/allowedDevices";
import { apiFetch } from "./httpClient";
import type { AuthState } from "../types/resource";
import { isStaticMode } from "./runtimeMode";

const AUTH_STORAGE_KEY = "jiadian_hub_auth";
export const DEVICE_MISMATCH_MESSAGE = "设备不匹配，请购买正规产品";

interface AuthApiResponse {
  success: boolean;
  token?: string;
  message?: string;
}

interface VerifyApiResponse {
  success: boolean;
}

function mapAuthMessage(message?: string): string {
  if (!message) return DEVICE_MISMATCH_MESSAGE;
  if (/VID\/PID|不匹配|授权设备|认证失败/i.test(message)) {
    return DEVICE_MISMATCH_MESSAGE;
  }
  return message;
}

async function ensureDeviceSerial(device: USBDevice): Promise<string> {
  if (device.serialNumber) {
    return device.serialNumber;
  }

  try {
    if (!device.opened) {
      await device.open();
    }
    if (!device.configuration) {
      await device.selectConfiguration(1);
    }
  } catch {
    throw new Error(DEVICE_MISMATCH_MESSAGE);
  }

  if (device.serialNumber) {
    return device.serialNumber;
  }
  throw new Error(DEVICE_MISMATCH_MESSAGE);
}

async function findBestGrantedUsbDevice(): Promise<USBDevice | null> {
  const grantedDevices = await navigator.usb.getDevices();
  const matched = grantedDevices.filter((device) =>
    isAllowedUsbDevice(device.vendorId, device.productId)
  );
  if (matched.length === 0) {
    return null;
  }
  if (matched.length === 1) {
    return matched[0];
  }

  const preferredSerial = getAuthState()?.serial?.trim();
  if (preferredSerial) {
    for (const device of matched) {
      try {
        const serial = device.serialNumber || (await ensureDeviceSerial(device));
        if (serial === preferredSerial) {
          return device;
        }
      } catch {
        continue;
      }
    }
  }

  return matched[0];
}

export async function hasGrantedAuthorizedDevice(): Promise<boolean> {
  if (!("usb" in navigator)) {
    return false;
  }
  const grantedDevices = await navigator.usb.getDevices();
  return grantedDevices.some((device) => isAllowedUsbDevice(device.vendorId, device.productId));
}

async function requestFilteredUsbDevice(): Promise<USBDevice> {
  if (window.top !== window.self) {
    throw new Error("当前页面运行在 iframe 中，WebUSB 需要顶层页面打开");
  }

  try {
    return await navigator.usb.requestDevice({ filters: usbDeviceFilters() });
  } catch (error) {
    throw mapUsbError(error);
  }
}

function mapUsbError(error: unknown): Error {
  const domError = error as DOMException;
  switch (domError?.name) {
    case "NotFoundError":
      return new Error("未检测到佳点授权设备，请确认设备已插入 USB 并重试");
    case "NotAllowedError":
    case "AbortError":
      return new Error("浏览器取消了设备授权，请重试");
    case "SecurityError":
      return new Error("浏览器阻止USB访问，请使用 Edge/Chrome 并通过 HTTPS 访问");
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

export function updateAuthDisplayName(serial: string, displayName?: string): void {
  const state = getAuthState();
  if (!state || state.serial !== serial) return;

  const nextState = { ...state };
  if (displayName?.trim()) {
    nextState.displayName = displayName.trim().slice(0, 20);
  } else {
    delete nextState.displayName;
  }
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextState));
}

export function hasValidLocalAuth(): boolean {
  const state = getAuthState();
  return Boolean(
    state?.token &&
      state?.serial &&
      isAllowedUsbDevice(state.vendorId, state.productId)
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

export async function authorizeUsbDevice(device: USBDevice): Promise<AuthState> {
  const { vendorId, productId } = device;
  if (!isAllowedUsbDevice(vendorId, productId)) {
    throw new Error(DEVICE_MISMATCH_MESSAGE);
  }
  const serialNumber = await ensureDeviceSerial(device);

  const { vid, pid } = formatUsbDeviceId(vendorId, productId);
  const previous = getAuthState();
  const preservedDisplayName =
    previous?.serial === serialNumber
      ? previous.displayName?.trim() ||
        localStorage.getItem(`jiadian_hub_display_name_${serialNumber}`)?.trim() ||
        undefined
      : undefined;

  let token = "";
  if (isStaticMode()) {
    token = `local-token-${serialNumber}-${Date.now()}`;
  } else {
    const authResult = await apiFetch<AuthApiResponse>("/api/auth", {
      method: "POST",
      body: JSON.stringify({
        serial: serialNumber,
        vid,
        pid,
      }),
    });

    if (!authResult.success || !authResult.token) {
      throw new Error(mapAuthMessage(authResult.message));
    }
    token = authResult.token;
  }

  const state: AuthState = {
    token,
    serial: serialNumber,
    vendorId,
    productId,
    verifiedAt: Date.now(),
    ...(preservedDisplayName ? { displayName: preservedDisplayName.slice(0, 20) } : {}),
  };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state));
  return state;
}

/** 静默连接：仅使用浏览器已授权过的设备，不弹出选择器。 */
export async function tryAuthorizeGrantedDevice(): Promise<AuthState | null> {
  if (!("usb" in navigator) || !window.isSecureContext) {
    return null;
  }

  const device = await findBestGrantedUsbDevice();
  if (!device) {
    return null;
  }

  try {
    return await authorizeUsbDevice(device);
  } catch {
    return null;
  }
}

export async function requestUsbAndAuthorize(): Promise<AuthState> {
  if (!("usb" in navigator)) {
    throw new Error("当前浏览器不支持 WebUSB，请使用最新版 Edge/Chrome");
  }
  if (!window.isSecureContext) {
    throw new Error("当前页面不是安全上下文，请通过 localhost 或 HTTPS 访问");
  }

  const granted = await findBestGrantedUsbDevice();
  if (granted) {
    return authorizeUsbDevice(granted);
  }

  const picked = await requestFilteredUsbDevice();
  return authorizeUsbDevice(picked);
}

export { ALLOWED_USB_DEVICES };
