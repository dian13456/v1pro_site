import type { ResourceItem } from "../types/resource";
import { getAuthState, hasValidLocalAuth } from "./authService";

export interface HiddenResourceState {
  hiddenResourceIds: number[];
  blockedUploaderCount: number;
}

const LOCAL_BLOCKED_KEY_PREFIX = "jiadian_hub_blocked_uploaders_";

function localKey(serial: string): string {
  return `${LOCAL_BLOCKED_KEY_PREFIX}${serial}`;
}

function readLocal(serial: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(localKey(serial)) || "[]");
    return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function uploaderKey(resource: ResourceItem): string {
  const serial = (resource.uploaderSerial || "").trim().toUpperCase();
  if (serial) return serial;
  return `AUTHOR:${(resource.author || "").trim()}`;
}

function localState(serial: string, resources: ResourceItem[]): HiddenResourceState {
  const blocked = new Set(readLocal(serial));
  return {
    hiddenResourceIds: resources.filter((item) => blocked.has(uploaderKey(item))).map((item) => item.id),
    blockedUploaderCount: blocked.size,
  };
}

function writeLocal(serial: string, blocked: Set<string>): void {
  localStorage.setItem(localKey(serial), JSON.stringify(Array.from(blocked)));
}

function requireAuth() {
  const auth = getAuthState();
  if (!hasValidLocalAuth() || !auth?.token || !auth.serial) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  return auth;
}

export async function fetchHiddenResourceState(resources: ResourceItem[]): Promise<HiddenResourceState> {
  const auth = requireAuth();
  return localState(auth.serial, resources);
}

export async function setUploaderHidden(
  resource: ResourceItem,
  hidden: boolean,
  resources: ResourceItem[]
): Promise<HiddenResourceState> {
  const auth = requireAuth();
  const blocked = new Set(readLocal(auth.serial));
  const key = uploaderKey(resource);
  if (!key || key === "AUTHOR:") throw new Error("未找到该素材的上传设备");
  if (hidden) blocked.add(key);
  else blocked.delete(key);
  writeLocal(auth.serial, blocked);
  return localState(auth.serial, resources);
}
