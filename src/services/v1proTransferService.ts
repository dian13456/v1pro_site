import type { DownloadStatsSnapshot } from "../types/downloadStats";
import type { ResourceItem } from "../types/resource";
import { createDownloadUrl } from "./downloadService";
import { createImageUrl } from "./imageService";

export interface V1ProOpenOptions {
  auto?: boolean;
  name?: string;
}

export const V1PRO_TRANSFER_LAUNCHED_MESSAGE =
  "已发送传输请求，请在佳点 V1PRO 控制工具中查看进度。";

export function buildV1ProUrl(fileUrl: string, options: V1ProOpenOptions = {}): string {
  if (!/^https:\/\//i.test(fileUrl)) {
    throw new Error("传输链接必须是 HTTPS");
  }

  const params = new URLSearchParams();
  params.set("url", fileUrl);
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
  const result =
    resource.materialType === "image"
      ? await createImageUrl(resource.id, resource.image, { forDownload: true })
      : await createDownloadUrl(resource.id, resource.download, { forDownload: true });

  const url = result.url || resource.download;
  if (!url || !/^https:\/\//i.test(url)) {
    throw new Error("无法获取 HTTPS 传输链接，请稍后重试");
  }

  return { url, stats: result.stats };
}
