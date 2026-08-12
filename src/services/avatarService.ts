import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";
import { displayUsernameFromSerial } from "../utils/displayUsername";

const DEV_AVATARS_KEY = "jiadian_dev_profile_avatars";
export const PROFILE_AVATAR_CHANGED_EVENT = "jiadian-profile-avatar-changed";
const AVATAR_SIDE = 320;
const MAX_AVATAR_BYTES = 512 * 1024;

interface AvatarPayload extends Record<string, unknown> {
  success?: boolean;
  avatarUrl?: string;
  message?: string;
}

export interface CreatorProfilePayload extends AvatarPayload {
  displayName?: string;
}

function readDevAvatars(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(DEV_AVATARS_KEY) || "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function getDevProfileAvatar(serial: string): string {
  return readDevAvatars()[serial] || "";
}

function notifyAvatarChanged(avatarUrl: string): void {
  window.dispatchEvent(new CustomEvent(PROFILE_AVATAR_CHANGED_EVENT, { detail: { avatarUrl } }));
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取这张图片，请换一张重试"));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("头像处理失败，请换一张图片"));
    }, type, quality);
  });
}

async function prepareAvatar(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
    throw new Error("头像仅支持 JPG、PNG 或 WebP 图片");
  }
  const image = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIDE;
  canvas.height = AVATAR_SIDE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法处理头像图片");
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const sx = (image.naturalWidth - side) / 2;
  const sy = (image.naturalHeight - side) / 2;
  context.drawImage(image, sx, sy, side, side, 0, 0, AVATAR_SIDE, AVATAR_SIDE);

  let blob = await canvasToBlob(canvas, "image/webp", 0.86).catch(() => canvasToBlob(canvas, "image/jpeg", 0.86));
  if (blob.size > MAX_AVATAR_BYTES) {
    blob = await canvasToBlob(canvas, "image/jpeg", 0.72);
  }
  if (blob.size > MAX_AVATAR_BYTES) throw new Error("头像处理后仍超过 512KB，请换一张图片");
  return blob;
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("头像读取失败"));
    reader.readAsDataURL(blob);
  });
}

export async function uploadProfileAvatar(file: File): Promise<string> {
  if (!hasValidLocalAuth()) throw new Error("认证状态无效，请重新认证设备");
  const auth = getAuthState();
  if (!auth?.serial) throw new Error("未找到当前设备 SN");
  const blob = await prepareAvatar(file);

  if (isStaticMode()) {
    const avatars = readDevAvatars();
    const avatarUrl = await blobToDataURL(blob);
    avatars[auth.serial] = avatarUrl;
    localStorage.setItem(DEV_AVATARS_KEY, JSON.stringify(avatars));
    notifyAvatarChanged(avatarUrl);
    return avatarUrl;
  }
  if (!auth.token) throw new Error("认证状态无效，请重新认证设备");

  const completed = await apiFetch<AvatarPayload>("/api/profile/avatar/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({ imageBase64: await blobToDataURL(blob), contentType: blob.type }),
  });
  const avatarUrl = completed.avatarUrl || "";
  notifyAvatarChanged(avatarUrl);
  return avatarUrl;
}

export async function removeProfileAvatar(): Promise<void> {
  const auth = getAuthState();
  if (!auth?.serial) throw new Error("未找到当前设备 SN");
  if (isStaticMode()) {
    const avatars = readDevAvatars();
    delete avatars[auth.serial];
    localStorage.setItem(DEV_AVATARS_KEY, JSON.stringify(avatars));
    notifyAvatarChanged("");
    return;
  }
  if (!auth.token) throw new Error("认证状态无效，请重新认证设备");
  await apiFetch<AvatarPayload>("/api/profile/avatar", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  notifyAvatarChanged("");
}

export async function fetchCreatorProfile(displayName: string): Promise<CreatorProfilePayload> {
  const auth = getAuthState();
  if (isStaticMode()) {
    let profiles: Record<string, string> = {};
    try {
      profiles = JSON.parse(localStorage.getItem("jiadian_dev_profiles") || "{}") as Record<string, string>;
    } catch {
      profiles = {};
    }
    const serial = Object.keys(readDevAvatars()).find((owner) =>
      (profiles[owner] || displayUsernameFromSerial(owner)).localeCompare(displayName, undefined, { sensitivity: "accent" }) === 0,
    );
    return { success: true, displayName, avatarUrl: serial ? getDevProfileAvatar(serial) : "" };
  }
  if (!auth?.token) throw new Error("认证状态无效，请重新认证设备");
  return apiFetch<CreatorProfilePayload>(`/api/creator-profile?displayName=${encodeURIComponent(displayName)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${auth.token}` },
  });
}
