import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { fetchProfile } from "./profileService";
import { isStaticMode } from "./runtimeMode";

const DEV_SOFTWARE_PROMPT_KEY = "jiadian_dev_software_prompt_dismissed";

export function softwarePromptDismissKey(serial: string): string {
  return `jiadian_hub_software_prompt_dismissed_${serial}`;
}

function readLocalSoftwarePromptDismissedId(serial: string): number {
  if (!serial) return 0;
  try {
    const raw = localStorage.getItem(softwarePromptDismissKey(serial));
    if (!raw) return 0;
    if (raw === "1") {
      return Number.MAX_SAFE_INTEGER;
    }
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeLocalSoftwarePromptDismissedId(serial: string, resourceId: number): void {
  if (!serial || resourceId <= 0) return;
  try {
    localStorage.setItem(softwarePromptDismissKey(serial), String(resourceId));
  } catch {
    // ignore
  }
}

function readDevSoftwarePromptDismissedId(serial: string): number {
  try {
    const map = JSON.parse(localStorage.getItem(DEV_SOFTWARE_PROMPT_KEY) || "{}") as Record<string, number>;
    const value = map[serial];
    return typeof value === "number" && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function writeDevSoftwarePromptDismissedId(serial: string, resourceId: number): void {
  try {
    const map = JSON.parse(localStorage.getItem(DEV_SOFTWARE_PROMPT_KEY) || "{}") as Record<string, number>;
    map[serial] = resourceId;
    localStorage.setItem(DEV_SOFTWARE_PROMPT_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function shouldShowSoftwarePrompt(serial: string, latestSoftwareId: number, dismissedId: number): boolean {
  if (!serial || latestSoftwareId <= 0) return false;
  if (dismissedId <= 0) return true;
  return latestSoftwareId !== dismissedId;
}

export async function fetchSoftwarePromptDismissedId(serial: string): Promise<number> {
  if (!serial) return 0;

  const localDismissedId = readLocalSoftwarePromptDismissedId(serial);
  if (isStaticMode()) {
    return Math.max(localDismissedId, readDevSoftwarePromptDismissedId(serial));
  }
  if (!hasValidLocalAuth()) {
    return localDismissedId;
  }

  try {
    const profile = await fetchProfile();
    const serverDismissedId = profile.softwarePromptDismissedId ?? 0;
    if (serverDismissedId > 0) {
      writeLocalSoftwarePromptDismissedId(serial, serverDismissedId);
    }
    return Math.max(localDismissedId, serverDismissedId);
  } catch {
    return localDismissedId;
  }
}

export async function dismissSoftwarePrompt(serial: string, resourceId: number): Promise<void> {
  if (!serial || resourceId <= 0) return;

  writeLocalSoftwarePromptDismissedId(serial, resourceId);
  if (isStaticMode()) {
    writeDevSoftwarePromptDismissedId(serial, resourceId);
    return;
  }

  const auth = getAuthState();
  if (!auth?.token) return;

  await apiFetch<{ success?: boolean; softwarePromptDismissedId?: number }>(
    "/api/profile/software-prompt/dismiss",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({ resourceId }),
    },
  );
}

// 兼容旧调用
export function hasDismissedSoftwarePrompt(serial: string): boolean {
  return readLocalSoftwarePromptDismissedId(serial) > 0;
}

export function welcomeDismissKey(serial: string): string {
  return `jiadian_hub_welcome_dismissed_${serial}`;
}

export function hasDismissedWelcome(serial: string): boolean {
  if (!serial) return true;
  try {
    return localStorage.getItem(welcomeDismissKey(serial)) === "1";
  } catch {
    return false;
  }
}

export function dismissWelcome(serial: string): void {
  localStorage.setItem(welcomeDismissKey(serial), "1");
}
