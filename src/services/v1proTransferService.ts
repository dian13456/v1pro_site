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
  countsAsDownload: boolean;
}

type TransferUrlMode = "preview" | "download";

export interface TransferExecuteResult {
  launched: boolean;
  url?: string;
  stats?: DownloadStatsSnapshot | null;
  error?: string;
}

export const V1PRO_TRANSFER_LAUNCHED_MESSAGE =
  "已发送传输请求，请在佳点 V1PRO 控制工具中查看进度。";

export const V1PRO_TRANSFER_NOT_READY_MESSAGE =
  "传输链接准备失败，请稍后重试。";

/** @deprecated 旧版二次点击流程提示，新流程在单次点击内完成传输。 */
export const V1PRO_TRANSFER_RETRY_MESSAGE =
  "链接已就绪，请再次点击「传输到设备」，浏览器将提示打开控制工具。";

const TRANSFER_PREPARE_TIMEOUT_MS = 30_000;
const TRANSFER_FETCH_TIMEOUT_MS = 25_000;
const TRANSFER_INFLIGHT_WAIT_MS = 8_000;
const TRANSFER_URL_TTL_MS = 8 * 60 * 1000;
const MAX_TRANSFER_PREFETCH = 4;
const transferCache = new Map<number, TransferCacheEntry>();
const transferInflight = new Map<number, Promise<void>>();
const activeTransferPrepares = new Map<number, Promise<TransferCacheEntry>>();
const transferAbortControllers = new Map<number, AbortController>();
let activeTransferPrefetchCount = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "AbortError" || /aborted|abort/i.test(err.message);
}

function toTransferFetchError(err: unknown, timeoutMessage: string): Error {
  if (isAbortError(err)) {
    return new Error(timeoutMessage);
  }
  return err instanceof Error ? err : new Error(timeoutMessage);
}

function rejectAfterTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
    void promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        window.clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(message));
      });
  });
}

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

function transferApiPath(resource: ResourceItem, mode: TransferUrlMode): string {
  if (resource.materialType === "image") {
    return mode === "download"
      ? `/api/image/?id=${resource.id}&download=1`
      : `/api/image/?id=${resource.id}`;
  }
  return mode === "download"
    ? `/api/resource/?id=${resource.id}&download=1`
    : `/api/resource/?id=${resource.id}&preview=1`;
}

async function fetchTransferDownloadUrl(
  resource: ResourceItem,
  options: { verifyRemote?: boolean; priority?: boolean; mode?: TransferUrlMode } = {},
): Promise<{
  url: string;
  stats?: DownloadStatsSnapshot | null;
}> {
  const mode = options.mode ?? "download";
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }
  const auth = getAuthState();
  if (!auth?.token) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  if (options.verifyRemote !== false) {
    const valid = await verifyTokenRemote();
    if (!valid) {
      throw new Error("认证已失效，请重新验证设备");
    }
  }

  if (isStaticMode()) {
    throw new Error("静态模式下无法传输到设备");
  }

  const resourceId = resource.id;
  if (options.priority) {
    transferAbortControllers.get(resourceId)?.abort();
  }
  const controller = new AbortController();
  transferAbortControllers.set(resourceId, controller);
  const timeoutId = window.setTimeout(() => controller.abort(), TRANSFER_FETCH_TIMEOUT_MS);

  try {
    const payload = await apiFetch<TransferUrlResponse>(
      transferApiPath(resource, mode),
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${auth.token}`,
        },
        signal: controller.signal,
      },
      { priority: options.priority },
    );

    const url = payload.url?.trim();
    if (!url) {
      throw new Error(payload.error || payload.message || "下载链接生成失败");
    }

    assertCosTransferUrl(url);
    return {
      url,
      stats: parseDownloadStats(payload),
    };
  } catch (err) {
    throw toTransferFetchError(err, "传输链接准备超时，请检查网络后重试");
  } finally {
    window.clearTimeout(timeoutId);
    if (transferAbortControllers.get(resourceId) === controller) {
      transferAbortControllers.delete(resourceId);
    }
  }
}

function storeTransferCache(
  resourceId: number,
  entry: Omit<TransferCacheEntry, "fetchedAt">,
): void {
  transferCache.set(resourceId, { ...entry, fetchedAt: Date.now() });
}

async function prepareTransferDownloadUrl(
  resource: ResourceItem,
  options: { priority?: boolean } = {},
): Promise<TransferCacheEntry> {
  const resourceId = resource.id;
  const cached = transferCache.get(resourceId);
  if (cached && isCacheEntryFresh(cached)) {
    return cached;
  }

  const inflight = transferInflight.get(resourceId);
  if (inflight) {
    if (options.priority) {
      transferAbortControllers.get(resourceId)?.abort();
    }
    await Promise.race([inflight.catch(() => undefined), sleep(TRANSFER_INFLIGHT_WAIT_MS)]);
    const ready = transferCache.get(resourceId);
    if (ready && isCacheEntryFresh(ready)) {
      return ready;
    }
  }

  const { url, stats } = await fetchTransferDownloadUrl(resource, {
    verifyRemote: false,
    priority: options.priority,
    mode: "download",
  });
  storeTransferCache(resourceId, { url, stats, countsAsDownload: true });
  return transferCache.get(resourceId) as TransferCacheEntry;
}

export function isTransferDownloadUrlReady(resourceId: number): boolean {
  const cached = transferCache.get(resourceId);
  return Boolean(cached && isCacheEntryFresh(cached));
}

export function isTransferDownloadUrlPrefetching(resourceId: number): boolean {
  return transferInflight.has(resourceId);
}

export function isTransferPrepareActive(resourceId: number): boolean {
  return activeTransferPrepares.has(resourceId);
}

/** 预先请求 download=1（可见卡片 / pointerdown 预取，勿在 click 里 await）。 */
export function prefetchTransferDownloadUrl(
  resource: ResourceItem,
  options: { urgent?: boolean } = {},
): void {
  if (!canTransferViaV1Pro(resource) || isStaticMode() || !hasValidLocalAuth()) {
    return;
  }

  const resourceId = resource.id;
  const cached = transferCache.get(resourceId);
  if (cached && isCacheEntryFresh(cached)) {
    return;
  }

  const urgent = options.urgent === true;
  if (!urgent && transferInflight.has(resourceId)) {
    return;
  }
  if (!urgent && activeTransferPrefetchCount >= MAX_TRANSFER_PREFETCH) {
    return;
  }

  if (urgent) {
    transferAbortControllers.get(resourceId)?.abort();
  }

  if (!urgent) {
    activeTransferPrefetchCount += 1;
  }

  const task = fetchTransferDownloadUrl(resource, {
    verifyRemote: false,
    priority: urgent,
    mode: "preview",
  })
    .then(({ url, stats }) => {
      storeTransferCache(resourceId, { url, stats, countsAsDownload: false });
    })
    .catch(() => {
      // prefetch 失败时静默，点击传输再提示
    })
    .finally(() => {
      if (!urgent) {
        activeTransferPrefetchCount = Math.max(0, activeTransferPrefetchCount - 1);
      }
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

export function waitForTransferDownloadUrl(
  resource: ResourceItem,
  timeoutMs = TRANSFER_PREPARE_TIMEOUT_MS,
): Promise<TransferCacheEntry> {
  prefetchTransferDownloadUrl(resource);
  return rejectAfterTimeout(
    prepareTransferDownloadUrl(resource, { priority: true }),
    timeoutMs,
    "传输链接准备超时，请检查网络后重试",
  );
}

/** 同步唤起 v1pro://；链接已缓存时在同一 click 栈内执行。 */
export function executeTransferToDevice(
  resource: ResourceItem,
  options: Pick<V1ProOpenOptions, "auto"> = {},
): TransferExecuteResult {
  const cached = transferCache.get(resource.id);
  if (!cached || !isCacheEntryFresh(cached) || !cached.countsAsDownload) {
    return { launched: false, error: V1PRO_TRANSFER_NOT_READY_MESSAGE };
  }

  launchV1ProTransferSync(cached.url, {
    name: fileNameFromTransferUrl(cached.url),
    auto: options.auto,
  });
  return { url: cached.url, stats: cached.stats, launched: true };
}

export interface TransferClickHandlers {
  onLaunched: (result: TransferExecuteResult) => void;
  onError: (message: string) => void;
  onPreparing: () => void;
  onPrepareEnd: () => void;
}

/** 单次点击：有缓存则立刻打开 v1pro://；否则等待链接就绪后在同一手势链内打开。 */
export async function handleTransferButtonClick(
  resource: ResourceItem,
  handlers: TransferClickHandlers,
  options: Pick<V1ProOpenOptions, "auto"> = {},
): Promise<void> {
  const immediate = executeTransferToDevice(resource, options);
  if (immediate.launched) {
    handlers.onLaunched(immediate);
    return;
  }

  if (activeTransferPrepares.has(resource.id)) {
    return;
  }

  const preparePromise = waitForTransferDownloadUrl(resource);
  activeTransferPrepares.set(resource.id, preparePromise);
  handlers.onPreparing();

  try {
    await preparePromise;
    const result = executeTransferToDevice(resource, options);
    if (result.launched) {
      handlers.onLaunched(result);
      return;
    }
    handlers.onError(V1PRO_TRANSFER_NOT_READY_MESSAGE);
  } catch (err) {
    handlers.onError((err as Error)?.message || V1PRO_TRANSFER_NOT_READY_MESSAGE);
  } finally {
    activeTransferPrepares.delete(resource.id);
    handlers.onPrepareEnd();
  }
}

/** @deprecated 勿在 async 回调中调用 executeTransferToDevice */
export async function runTransferToDevice(
  resource: ResourceItem,
  options: Pick<V1ProOpenOptions, "auto"> = {},
): Promise<TransferExecuteResult> {
  const immediate = executeTransferToDevice(resource, options);
  if (immediate.launched) {
    return immediate;
  }
  try {
    await waitForTransferDownloadUrl(resource);
    const launched = executeTransferToDevice(resource, options);
    if (launched.launched) {
      return launched;
    }
  } catch (err) {
    return {
      launched: false,
      error: (err as Error)?.message || V1PRO_TRANSFER_NOT_READY_MESSAGE,
    };
  }
  return {
    launched: false,
    error: V1PRO_TRANSFER_NOT_READY_MESSAGE,
  };
}

/** @deprecated 使用 executeTransferToDevice + waitForTransferDownloadUrl + 用户二次点击 */
export async function transferResourceToDevice(
  resource: ResourceItem,
  options: Pick<V1ProOpenOptions, "auto"> = {},
): Promise<{ url: string; stats?: DownloadStatsSnapshot | null }> {
  const result = await runTransferToDevice(resource, options);
  if (result.launched && result.url) {
    return { url: result.url, stats: result.stats };
  }
  throw new Error(result.error || V1PRO_TRANSFER_NOT_READY_MESSAGE);
}
