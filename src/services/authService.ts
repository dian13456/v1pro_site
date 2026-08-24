import { ALLOWED_USB_DEVICES, formatUsbDeviceId, isAllowedUsbDevice, usbDeviceFilters } from "../config/allowedDevices";
import { apiFetch } from "./httpClient";
import type { AuthState } from "../types/resource";
import { isStaticMode } from "./runtimeMode";
import {
  disableBootWebsiteAfterEntry,
  markBootWebsiteEntryHandled,
  wasBootWebsiteEntryHandled,
} from "./bootWebsiteService";

const AUTH_STORAGE_KEY = "jiadian_hub_auth";
const BRAVE_STABLE_SERIAL_KEY_PREFIX = "jiadian_hub_brave_stable_usb_serial";
export const DEVICE_MISMATCH_MESSAGE = "设备不匹配，请购买正规产品";
const USB_OPEN_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

interface AuthApiResponse {
  success: boolean;
  token?: string;
  message?: string;
}

interface VerifyApiResponse {
  success: boolean;
}

interface BraveNavigator extends Navigator {
  brave?: {
    isBrave?: () => Promise<boolean>;
  };
}

function braveStableSerialKey(vendorId: number, productId: number): string {
  return `${BRAVE_STABLE_SERIAL_KEY_PREFIX}_${vendorId.toString(16)}_${productId.toString(16)}`;
}

async function isBraveBrowser(): Promise<boolean> {
  const brave = (navigator as BraveNavigator).brave;
  if (typeof brave?.isBrave !== "function") return false;
  try {
    return Boolean(await brave.isBrave());
  } catch {
    return false;
  }
}

async function resolveStableDeviceSerial(
  device: USBDevice,
  reportedSerial: string,
  previous: AuthState | null,
): Promise<string> {
  const normalized = reportedSerial.trim();
  if (!(await isBraveBrowser())) return normalized;

  const storageKey = braveStableSerialKey(device.vendorId, device.productId);
  const stored = localStorage.getItem(storageKey)?.trim();
  if (stored) return stored;

  // Migrate an existing Brave login before trusting a newly randomized value.
  const stableSerial =
    previous?.vendorId === device.vendorId &&
    previous.productId === device.productId &&
    previous.serial?.trim()
      ? previous.serial.trim()
      : normalized;
  localStorage.setItem(storageKey, stableSerial);
  return stableSerial;
}

export function matchesAuthenticatedUsbDevice(device: USBDevice, authenticatedSerial: string): boolean {
  const expected = authenticatedSerial.trim();
  if (!expected || !isAllowedUsbDevice(device.vendorId, device.productId)) return false;
  if (device.serialNumber?.trim() === expected) return true;
  return localStorage.getItem(braveStableSerialKey(device.vendorId, device.productId))?.trim() === expected;
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
    await withTimeout(
      (async () => {
        if (!device.opened) {
          await device.open();
        }
        if (!device.configuration) {
          await device.selectConfiguration(1);
        }
      })(),
      USB_OPEN_TIMEOUT_MS,
      "USB 设备打开超时，请关闭「佳点V1PRO控制工具」或设备控制页后再试",
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("打开超时")) {
      throw error;
    }
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
        if (matchesAuthenticatedUsbDevice(device, preferredSerial)) {
          return device;
        }
        const serial = device.serialNumber || (await ensureDeviceSerial(device));
        if (serial.trim() === preferredSerial) {
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
      return new Error("未选择设备。请在浏览器窗口中先点击设备名称，再点击右下角“连接”；若列表为空，请确认设备已插入 USB");
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
  const reportedSerial = await ensureDeviceSerial(device);

  const { vid, pid } = formatUsbDeviceId(vendorId, productId);
  const previous = getAuthState();
  const serialNumber = await resolveStableDeviceSerial(device, reportedSerial, previous);
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

  // This path is called from an explicit user click. Always show Chrome/Edge's
  // chooser so a site with multiple authorized V1PROs never picks the first
  // device behind the user's back.
  const picked = await requestFilteredUsbDevice();
  try {
    const state = await authorizeUsbDevice(picked);
    if (!wasBootWebsiteEntryHandled(picked)) {
      try {
        await disableBootWebsiteAfterEntry(picked);
        markBootWebsiteEntryHandled(picked);
      } catch (error) {
        // Older firmware may not implement the URL command. Authentication must
        // still succeed; supported devices will disable the one-shot launcher.
        console.warn("Unable to disable the device boot website launcher", error);
      }
    }
    return state;
  } finally {
    // Reading a missing serial descriptor may have opened the USBDevice.
    // Authentication must not retain that handle or block WebUSB/desktop GUI.
    if (picked.opened) {
      try {
        await picked.close();
      } catch {
        // The device may have been unplugged while authentication completed.
      }
    }
  }
}

export { ALLOWED_USB_DEVICES };
