import type { DownloadStatsSnapshot } from "../types/downloadStats";
import { parseDownloadStats } from "../types/downloadStats";
import type { ResourceItem } from "../types/resource";
import { API_BASE } from "./httpClient";
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

function isBlockedTransferHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "api.jadot.cn") return true;
  if (normalized === "jiadianer.cloud" || normalized.endsWith(".jiadianer.cloud")) return true;
  if (normalized === "jadot.cn" || normalized.endsWith(".jadot.cn")) return true;
  return false;
}

export function fileNameFromTransferUrl(fileUrl: string): string {
  try {
    const pathname = new URL(normalizeTransferFileUrl(fileUrl)).pathname;
    const basename = decodeURIComponent(pathname.split("/").pop() || "").trim();
    if (basename) {
      return basename;
    }
  } catch {
    // ignore invalid URL
  }
  return "material.bin";
}

/** 避免 q-sign-time 等字段里的 %3B 在 v1pro 参数里被错误截断。 */
export function normalizeTransferFileUrl(fileUrl: string): string {
  const trimmed = fileUrl.trim();
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

/** 传输到设备只允许 download=1 返回的 COS 预签名 HTTPS 直链。禁止网站/API/base64 预览地址。 */
export function assertCosTransferUrl(url: string): void {
  const trimmed = normalizeTransferFileUrl(url);
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
  if (isBlockedTransferHost(parsed.hostname)) {
    throw new Error("传输链接不能使用网站或 API 地址，请使用 COS 下载直链");
  }
  if (!/\.myqcloud\.com$/i.test(parsed.hostname)) {
    throw new Error("传输链接必须是 COS 签名地址");
  }
}

export function buildV1ProUrl(fileUrl: string, options: V1ProOpenOptions = {}): string {
  const normalized = normalizeTransferFileUrl(fileUrl);
  assertCosTransferUrl(normalized);

  const params = new URLSearchParams();
  params.set("url", normalized);
  params.set("auto", options.auto === false ? "0" : "1");
  const fileName = options.name?.trim() || fileNameFromTransferUrl(normalized);
  if (fileName) {
    params.set("name", fileName);
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
  if (isStaticMode()) {
    throw new Error("静态模式下无法传输到设备");
  }

  const path = transferApiPath(resource);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error("接口不可达，请确认鉴权服务已启动");
  }

  let payload: TransferUrlResponse | null = null;
  try {
    payload = (await response.json()) as TransferUrlResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.error || payload?.message || `请求失败（HTTP ${response.status})`;
    throw new Error(message);
  }

  const url = payload?.url?.trim();
  if (!url) {
    throw new Error(payload?.error || payload?.message || "下载链接生成失败");
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

/** 传输到设备：先 GET download=1 取 JSON.url，再用 COS 链接唤起 v1pro://。 */
export async function transferResourceToDevice(
  resource: ResourceItem,
  options: Pick<V1ProOpenOptions, "auto"> = {},
): Promise<{ url: string; stats?: DownloadStatsSnapshot | null }> {
  const { url, stats } = await fetchTransferDownloadUrl(resource);
  launchV1ProTransfer(url, {
    name: fileNameFromTransferUrl(url),
    auto: options.auto,
  });
  return { url, stats };
}
