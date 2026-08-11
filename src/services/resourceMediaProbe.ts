import { parseGIF, decompressFrames } from "gifuct-js";
import type { ResourceItem } from "../types/resource";
import type { ResourceMediaMetrics } from "../utils/resourceCapacity";
import { createDownloadUrl } from "./downloadService";

function probeVideo(url: string): Promise<ResourceMediaMetrics> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
    };
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const metrics = {
        durationSec: duration > 0 ? duration : null,
        sourceFrameCount: null,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
      };
      cleanup();
      resolve(metrics);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error("无法读取视频信息"));
    };
    video.src = url;
  });
}

async function probeGif(url: string): Promise<ResourceMediaMetrics> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("无法读取 GIF 信息");
  const parsed = parseGIF(await response.arrayBuffer());
  const frames = decompressFrames(parsed, false);
  const durationMs = frames.reduce((total, frame) => total + Math.max(20, frame.delay || 100), 0);
  return {
    durationSec: durationMs > 0 ? durationMs / 1000 : null,
    sourceFrameCount: frames.length || null,
    width: parsed.lsd?.width,
    height: parsed.lsd?.height,
  };
}

export async function probeResourceMedia(resource: ResourceItem): Promise<{
  url: string;
  metrics: ResourceMediaMetrics;
}> {
  const result = await createDownloadUrl(resource.id, resource.download, { forDownload: false });
  if (!result.url) throw new Error("素材预览地址生成失败");
  if (resource.materialType === "video") {
    return { url: result.url, metrics: await probeVideo(result.url) };
  }
  if (resource.materialType === "gif") {
    return { url: result.url, metrics: await probeGif(result.url) };
  }
  return {
    url: result.url,
    metrics: { durationSec: null, sourceFrameCount: 1 },
  };
}
