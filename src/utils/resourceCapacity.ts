import type { ResourceItem } from "../types/resource";

export const DEVICE_FRAME_CAPACITIES = [77, 154, 308] as const;
export const VIDEO_FPS_OPTIONS = [10, 15, 20, 25] as const;
export const MAX_AUTOMATIC_SPEED = 5;

export type DeviceFrameCapacity = (typeof DEVICE_FRAME_CAPACITIES)[number];
export type VideoFpsOption = (typeof VIDEO_FPS_OPTIONS)[number];

export interface ResourceMediaMetrics {
  durationSec: number | null;
  sourceFrameCount: number | null;
  width?: number;
  height?: number;
}

export interface CapacityAssessment {
  capacity: DeviceFrameCapacity;
  requiredFrames: number;
  speed: number;
  playbackSec: number | null;
  fits: boolean;
  originalSpeed: boolean;
}

export function resourceMetricsFromCatalog(resource: ResourceItem): ResourceMediaMetrics {
  return {
    durationSec:
      typeof resource.durationSec === "number" && resource.durationSec > 0
        ? resource.durationSec
        : null,
    sourceFrameCount:
      typeof resource.sourceFrameCount === "number" && resource.sourceFrameCount > 0
        ? Math.floor(resource.sourceFrameCount)
        : resource.materialType === "image"
          ? 1
          : null,
    width: resource.width,
    height: resource.height,
  };
}

export function mergeResourceMetrics(
  resource: ResourceItem,
  measured?: Partial<ResourceMediaMetrics> | null,
): ResourceMediaMetrics {
  const catalog = resourceMetricsFromCatalog(resource);
  return {
    durationSec: measured?.durationSec ?? catalog.durationSec,
    sourceFrameCount: measured?.sourceFrameCount ?? catalog.sourceFrameCount,
    width: measured?.width ?? catalog.width,
    height: measured?.height ?? catalog.height,
  };
}

export function requiredFramesForResource(
  resource: ResourceItem,
  metrics: ResourceMediaMetrics,
  fps: number,
): number | null {
  if (resource.materialType === "image") return 1;
  if (metrics.durationSec && metrics.durationSec > 0) {
    return Math.max(1, Math.ceil(metrics.durationSec * fps));
  }
  if (metrics.sourceFrameCount && metrics.sourceFrameCount > 0) {
    return metrics.sourceFrameCount;
  }
  return null;
}

export function assessDeviceCapacities(
  resource: ResourceItem,
  metrics: ResourceMediaMetrics,
  fps: number,
): CapacityAssessment[] {
  const required = requiredFramesForResource(resource, metrics, fps) ?? 1;
  return DEVICE_FRAME_CAPACITIES.map((capacity) => {
    const speed = Math.max(1, required / capacity);
    return {
      capacity,
      requiredFrames: required,
      speed,
      playbackSec: metrics.durationSec ? metrics.durationSec / speed : null,
      fits: speed <= MAX_AUTOMATIC_SPEED,
      originalSpeed: required <= capacity,
    };
  });
}

export function smallestCompatibleCapacity(
  resource: ResourceItem,
  metrics: ResourceMediaMetrics,
  fps: number,
): DeviceFrameCapacity | null {
  const required = requiredFramesForResource(resource, metrics, fps);
  if (required == null) return null;
  return DEVICE_FRAME_CAPACITIES.find((capacity) => required <= capacity) ?? null;
}

export function formatMediaDuration(durationSec: number | null): string {
  if (!durationSec || durationSec <= 0) return "";
  return `${durationSec.toFixed(durationSec >= 10 ? 1 : 1)}s`;
}
