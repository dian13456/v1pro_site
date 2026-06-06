import type { DownloadStatsSnapshot } from "../types/downloadStats";
import { parseDownloadStats } from "../types/downloadStats";
import type { ResourceItem } from "../types/resource";
import { getAuthState, hasValidLocalAuth, verifyTokenRemote } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";

export interface V1ProOpenOptions {
  auto?: boolean;
  name?: string;
}

interface TransferUrlResponse {
  url?: string;
  error?: string;
  message?: string;
  downloadStats?: Record<string, unknown>;
}

export const V1PRO_TRANSFER_LAUNCHED_MESSAGE =
  "已发送传输请求，请在佳点 V1PRO 控制工具中查看进度。";

/** 传输到设备只允许 COS 预签名 HTTPS 直链，禁止 API 地址与 base64 预览。 */
export function assertCosTransferUrl(url: string): void {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("无法获取 HTTPS 传输链接，请稍后重试");
  }
  if (/^data:/i.test(trimmed)) {
    throw new Error("传输链接不能使用预览数据，请重新获取下载地址");
  }
  if (!/^https:\/\//i.test(trimmed)) {
    throw new Error("传输链接必须是 HTTPS");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("传输链接格式无效");
  }
  if (/api\.jadot\.cn$/i.test(parsed.host) || /(^|\.)jiadianer\.cloud$/i.test(parsed.host)) {
    throw new Error("传输链接不能使用 API 或网站地址，请使用 COS 下载直链");
  }
  if (!/\.myqcloud\.com$/i.test(parsed.host)) {
    throw new Error("传输链接必须是 COS 签名地址");
  }
}

export function buildV1ProUrl(fileUrl: string, options: V1ProOpenOptions = {}): string {
  assertCosTransferUrl(fileUrl);

  const params = new URLSearchParams();
  params.set("url", fileUrl.trim());
  params.set("auto", options.auto === false ? "0" : "1");
  if (options.name?.trim()) {
    params.set("name", options.name.trim());
  }
  return `v1pro://open?${params.toString()}`;
}

export function guessTransferFileName(resource: ResourceItem): string {
  const candidates = [resource.download, resource.image];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const pathname = new URL(candidate).pathname;
      const basename = decodeURIComponent(pathname.split("/").pop() || "").trim();
      if (basename) {
        return basename;
      }
    } catch {
      // ignore invalid URL
    }
  }

  const ext =
    resource.materialType === "gif"
      ? ".gif"
      : resource.materialType === "video"
        ? ".mp4"
        : resource.materialType === "v1pro-pack"
          ? ".gfm1"
          : ".png";
  const safeTitle = resource.title.trim().replace(/[<>:"/\\|?*]/g, "_") || "material";
  return `${safeTitle}${ext}`;
}

export function canTransferViaV1Pro(resource: ResourceItem): boolean {
  if (resource.category === "software") {
    return false;
  }
  return (
    resource.materialType === "image" ||
    resource.materialType === "gif" ||
    resource.materialType === "video" ||
    resource.materialType === "v1pro-pack"
  );
}

function transferApiPath(resource: ResourceItem): string {
  if (resource.materialType === "image") {
    return `/api/image/?id=${resource.id}&download=1`;
  }
  return `/api/resource/?id=${resource.id}&download=1`;
}

async function fetchTransferDownloadUrl(resource: ResourceItem): Promise<{
  url: string;
  stats?: DownloadStatsSnapshot | null;
}> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  const auth = getAuthState();
  if (!auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  const valid = await verifyTokenRemote();
  if (!valid) {
    throw new Error("认证已失效，请重新验证设备");
  }

  if (isStaticMode()) {
    throw new Error("静态模式下无法传输到设备");
  }

  const payload = await apiFetch<TransferUrlResponse>(transferApiPath(resource), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
  });

  const url = payload.url?.trim();
  if (!url) {
    throw new Error(payload.error || payload.message || "下载链接生成失败");
  }

  assertCosTransferUrl(url);
  return {
    url,
    stats: parseDownloadStats(payload),
  };
}

/** 通过隐藏 iframe 唤起 v1pro://，避免 location.href 导致页面跳转或误判未安装。 */
export function launchV1ProTransfer(fileUrl: string, options: V1ProOpenOptions = {}): void {
  const url = buildV1ProUrl(fileUrl, options);
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.setAttribute("aria-hidden", "true");
  iframe.src = url;
  document.body.appendChild(iframe);
  window.setTimeout(() => iframe.remove(), 2000);
}

export async function resolveTransferSignedUrl(
  resource: ResourceItem
): Promise<{ url: string; stats?: DownloadStatsSnapshot | null }> {
  return fetchTransferDownloadUrl(resource);
}
