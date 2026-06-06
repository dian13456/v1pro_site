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

interface TransferCacheEntry {
  url: string;
  stats?: DownloadStatsSnapshot | null;
  fetchedAt: number;
}

export interface TransferExecuteResult {
  launched: boolean;
  url?: string;
  stats?: DownloadStatsSnapshot | null;
  error?: string;
}

export const V1PRO_TRANSFER_LAUNCHED_MESSAGE =
  "已发送传输请求，请在佳点 V1PRO 控制工具中查看进度。";

export const V1PRO_TRANSFER_NOT_READY_MESSAGE =
  "下载地址尚未就绪，请将鼠标在按钮上稍停片刻后再点「传输到设备」。";

const TRANSFER_URL_TTL_MS = 8 * 60 * 1000;
const transferCache = new Map<number, TransferCacheEntry>();
const transferInflight = new Map<number, Promise<void>>();

function isBlockedTransferHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "api.jadot.cn") return true;
  if (normalized === "jiadianer.cloud" || normalized.endsWith(".jiadianer.cloud")) return true;
  if (normalized === "jadot.cn" || normalized.endsWith(".jadot.cn")) return true;
  return false;
}

function isCacheEntryFresh(entry: TransferCacheEntry): boolean {
  return Date.now() - entry.fetchedAt < TRANSFER_URL_TTL_MS;
}

export function fileNameFromTransferUrl(fileUrl: string): string {
  try {
    const pathname = new URL(fileUrl.trim()).pathname;
    const basename = decodeURIComponent(pathname.split("/").pop() || "").trim();
    if (basename) {
      return basename;
    }
  } catch {
    // ignore invalid URL
  }
  return "material.bin";
}

/** 传输到设备只允许 download=1 返回的 COS 预签名 HTTPS 直链。禁止网站/API/base64 预览地址。 */
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
  if (isBlockedTransferHost(parsed.hostname)) {
    throw new Error("传输链接不能使用网站或 API 地址，请使用 COS 下载直链");
  }
  if (!/\.myqcloud\.com$/i.test(parsed.hostname)) {
    throw new Error("传输链接必须是 COS 签名地址");
  }
}

export function buildV1ProUrl(fileUrl: string, options: V1ProOpenOptions = {}): string {
  const trimmed = fileUrl.trim();
  assertCosTransferUrl(trimmed);

  const params = new URLSearchParams();
  params.set("url", trimmed);
  params.set("auto", options.auto === false ? "0" : "1");
  const fileName = options.name?.trim() || fileNameFromTransferUrl(trimmed);
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

function storeTransferCache(resourceId: number, entry: Omit<TransferCacheEntry, "fetchedAt">): void {
  transferCache.set(resourceId, { ...entry, fetchedAt: Date.now() });
}

export function isTransferDownloadUrlReady(resourceId: number): boolean {
  const cached = transferCache.get(resourceId);
  return Boolean(cached && isCacheEntryFresh(cached));
}

export function isTransferDownloadUrlPrefetching(resourceId: number): boolean {
  return transferInflight.has(resourceId);
}

/** 预先请求 download=1（可在 mouseenter / 页面展示时调用，勿在 click 里 await）。 */
export function prefetchTransferDownloadUrl(resource: ResourceItem): void {
  if (!canTransferViaV1Pro(resource) || isStaticMode() || !hasValidLocalAuth()) {
    return;
  }

  const resourceId = resource.id;
  const cached = transferCache.get(resourceId);
  if (cached && isCacheEntryFresh(cached)) {
    return;
  }
  if (transferInflight.has(resourceId)) {
    return;
  }

  const task = fetchTransferDownloadUrl(resource)
    .then(({ url, stats }) => {
      storeTransferCache(resourceId, { url, stats });
    })
    .catch(() => {
      // prefetch 失败时静默，点击传输再提示
    })
    .finally(() => {
      transferInflight.delete(resourceId);
    });

  transferInflight.set(resourceId, task);
}

/** 必须在用户点击的同步调用栈里执行（window.location.href）。 */
export function launchV1ProTransferSync(fileUrl: string, options: V1ProOpenOptions = {}): void {
  window.location.href = buildV1ProUrl(fileUrl, options);
}

/** @deprecated 使用 launchV1ProTransferSync；iframe 会被浏览器静默拦截。 */
export function launchV1ProTransfer(fileUrl: string, options: V1ProOpenOptions = {}): void {
  launchV1ProTransferSync(fileUrl, options);
}

export async function resolveTransferSignedUrl(
  resource: ResourceItem
): Promise<{ url: string; stats?: DownloadStatsSnapshot | null }> {
  return fetchTransferDownloadUrl(resource);
}

/** 同步唤起 v1pro://；需事先 prefetchTransferDownloadUrl。 */
export function executeTransferToDevice(
  resource: ResourceItem,
  options: Pick<V1ProOpenOptions, "auto"> = {},
): TransferExecuteResult {
  const cached = transferCache.get(resource.id);
  if (!cached || !isCacheEntryFresh(cached)) {
    prefetchTransferDownloadUrl(resource);
    return { launched: false, error: V1PRO_TRANSFER_NOT_READY_MESSAGE };
  }

  launchV1ProTransferSync(cached.url, {
    name: fileNameFromTransferUrl(cached.url),
    auto: options.auto,
  });
  return { url: cached.url, stats: cached.stats, launched: true };
}

/** @deprecated 使用 prefetchTransferDownloadUrl + executeTransferToDevice */
export async function transferResourceToDevice(
  resource: ResourceItem,
  options: Pick<V1ProOpenOptions, "auto"> = {},
): Promise<{ url: string; stats?: DownloadStatsSnapshot | null }> {
  prefetchTransferDownloadUrl(resource);
  await transferInflight.get(resource.id);
  const result = executeTransferToDevice(resource, options);
  if (!result.launched || !result.url) {
    throw new Error(result.error || V1PRO_TRANSFER_NOT_READY_MESSAGE);
  }
  return { url: result.url, stats: result.stats };
}
