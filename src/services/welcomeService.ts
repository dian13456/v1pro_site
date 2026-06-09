import { getAuthState, updateAuthDisplayName } from "./authService";
import { displayUsernameFromSerial } from "../utils/displayUsername";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";
import type { WelcomePayload } from "../types/welcome";

const DISPLAY_NAME_PREFIX = "jiadian_hub_display_name_";
export const MAX_DISPLAY_NAME_LENGTH = 20;
export const DISPLAY_NAME_TAKEN_MESSAGE = "该昵称已被使用，请换一个";

function displayNameKey(serial: string): string {
  return `${DISPLAY_NAME_PREFIX}${serial}`;
}

function readLocalDisplayName(serial: string): string {
  try {
    const saved = localStorage.getItem(displayNameKey(serial))?.trim();
    if (saved) {
      return saved.slice(0, MAX_DISPLAY_NAME_LENGTH);
    }
  } catch {
    // ignore
  }
  return "";
}

function isDisplayNameTakenLocally(serial: string, candidate: string): boolean {
  const target = candidate.trim();
  if (!target) return false;
  try {
    const prefix = DISPLAY_NAME_PREFIX;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const ownerSerial = key.slice(prefix.length);
      if (ownerSerial === serial) continue;
      const value = localStorage.getItem(key)?.trim();
      if (value && value.localeCompare(target, undefined, { sensitivity: "accent" }) === 0) {
        return true;
      }
    }
    if (import.meta.env.DEV) {
      const profiles = JSON.parse(localStorage.getItem("jiadian_dev_profiles") || "{}") as Record<string, string>;
      for (const [ownerSerial, value] of Object.entries(profiles)) {
        if (ownerSerial === serial) continue;
        const saved = value?.trim();
        if (saved && saved.localeCompare(target, undefined, { sensitivity: "accent" }) === 0) {
          return true;
        }
      }
    }
  } catch {
    // ignore
  }
  return false;
}

export async function checkDisplayNameAvailable(serial: string, name: string): Promise<boolean> {
  const trimmed = name.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
  if (!trimmed || trimmed === getDefaultDisplayName(serial)) {
    return true;
  }

  if (isStaticMode()) {
    return !isDisplayNameTakenLocally(serial, trimmed);
  }

  const auth = getAuthState();
  if (!auth?.token || auth.serial !== serial) {
    return !isDisplayNameTakenLocally(serial, trimmed);
  }

  const payload = await apiFetch<{ available?: boolean }>(
    `/api/profile/display-name-check?displayName=${encodeURIComponent(trimmed)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    },
  );
  return payload.available !== false;
}

export function getDefaultDisplayName(serial: string): string {
  return displayUsernameFromSerial(serial);
}

export function getDisplayName(serial: string): string {
  if (!serial) return "用户";

  const auth = getAuthState();
  if (auth?.serial === serial) {
    const fromAuth = auth.displayName?.trim();
    if (fromAuth) {
      return fromAuth.slice(0, MAX_DISPLAY_NAME_LENGTH);
    }
  }

  const fromLocal = readLocalDisplayName(serial);
  if (fromLocal) {
    return fromLocal;
  }

  return getDefaultDisplayName(serial);
}

function persistDisplayNameLocally(serial: string, name: string): string {
  const trimmed = name.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
  const defaultName = getDefaultDisplayName(serial);
  const nextName = trimmed || defaultName;

  if (!trimmed || trimmed === defaultName) {
    localStorage.removeItem(displayNameKey(serial));
    updateAuthDisplayName(serial, undefined);
    return defaultName;
  }

  localStorage.setItem(displayNameKey(serial), trimmed);
  updateAuthDisplayName(serial, trimmed);
  return nextName;
}

export function setDisplayName(serial: string, name: string): string {
  return persistDisplayNameLocally(serial, name);
}

export async function saveDisplayName(serial: string, name: string): Promise<string> {
  const trimmed = name.trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
  const defaultName = getDefaultDisplayName(serial);

  if (isStaticMode()) {
    if (trimmed && trimmed !== defaultName && isDisplayNameTakenLocally(serial, trimmed)) {
      throw new Error(DISPLAY_NAME_TAKEN_MESSAGE);
    }
    return persistDisplayNameLocally(serial, name);
  }

  const auth = getAuthState();
  if (!auth?.token || auth.serial !== serial) {
    if (trimmed && trimmed !== defaultName && isDisplayNameTakenLocally(serial, trimmed)) {
      throw new Error(DISPLAY_NAME_TAKEN_MESSAGE);
    }
    return persistDisplayNameLocally(serial, name);
  }

  const payload = await apiFetch<{ success?: boolean; displayName?: string; message?: string }>("/api/profile", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify({ displayName: trimmed }),
  });
  if (payload.success === false) {
    throw new Error(payload.message || DISPLAY_NAME_TAKEN_MESSAGE);
  }
  if (payload.displayName) {
    return persistDisplayNameLocally(serial, payload.displayName);
  }
  return persistDisplayNameLocally(serial, name);
}

export async function syncDisplayNameFromServer(serial: string): Promise<string> {
  const current = getDisplayName(serial);
  if (isStaticMode() || !serial) {
    return current;
  }

  const auth = getAuthState();
  if (!auth?.token || auth.serial !== serial) {
    return current;
  }

  try {
    const payload = await apiFetch<{ success?: boolean; displayName?: string }>("/api/profile", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    });
    const fromServer = payload.displayName?.trim();
    if (fromServer) {
      return persistDisplayNameLocally(serial, fromServer);
    }
  } catch {
    // ignore
  }

  return current;
}

function buildLocalWelcome(username: string): WelcomePayload {
  const hour = new Date().getHours();
  const greeting =
    hour >= 5 && hour < 9
      ? "早上好"
      : hour >= 9 && hour < 12
        ? "上午好"
        : hour >= 12 && hour < 14
          ? "中午好"
          : hour >= 14 && hour < 18
            ? "下午好"
            : hour >= 18 && hour < 23
              ? "晚上好"
              : "夜深了";
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const now = new Date();
  const localTime = `${weekdays[now.getDay()]} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return {
    success: true,
    message: `${greeting}，${username}！欢迎来到佳点电子资源中心。现在是 ${localTime}。祝你今天挑选到心仪的 1.9 寸横屏素材。`,
    username,
    localTime,
    city: "",
    region: "",
    weatherText: "",
    temperature: 0,
  };
}

export async function fetchWelcomeMessage(): Promise<WelcomePayload> {
  const auth = getAuthState();
  const serial = auth?.serial || "";
  if (serial) {
    await syncDisplayNameFromServer(serial);
  }
  const displayName = serial ? getDisplayName(serial) : "用户";

  if (isStaticMode()) {
    return buildLocalWelcome(displayName);
  }

  if (!auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  const query = encodeURIComponent(displayName);
  try {
    const payload = await apiFetch<WelcomePayload>(`/api/welcome?displayName=${query}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    });
    if (!payload.message) {
      return buildLocalWelcome(displayName);
    }
    return {
      ...payload,
      username: payload.username || displayName,
    };
  } catch {
    return buildLocalWelcome(displayName);
  }
}
