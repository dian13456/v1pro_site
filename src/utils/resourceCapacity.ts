import type { ResourceItem } from "../types/resource";

export const DEVICE_FRAME_CAPACITIES = [77, 154, 308] as const;
export const VIDEO_FPS_OPTIONS = [20, 25, 30] as const;
export const COMPATIBLE_VIDEO_FPS = "compatible" as const;
export const COMPATIBLE_VIDEO_FPS_FALLBACK = 20 as const;
export const MAX_AUTOMATIC_SPEED = 5;

export type DeviceFrameCapacity = (typeof DEVICE_FRAME_CAPACITIES)[number];
export type VideoFpsOption = (typeof VIDEO_FPS_OPTIONS)[number];
export type VideoFpsSelection = typeof COMPATIBLE_VIDEO_FPS | VideoFpsOption;

export function isVideoFpsOption(value: unknown): value is VideoFpsOption {
  return VIDEO_FPS_OPTIONS.some((fps) => fps === value);
}

export function parseVideoFpsSelection(value: string): VideoFpsSelection {
  if (value === COMPATIBLE_VIDEO_FPS) return COMPATIBLE_VIDEO_FPS;
  const parsed = Number(value);
  return isVideoFpsOption(parsed) ? parsed : COMPATIBLE_VIDEO_FPS;
}

/**
 * Compatibility mode keeps old 20/25/30 fps recommendations working. New or
 * local material without a recommendation follows the GUI beginner-mode 20 fps
 * baseline, while an explicit manual selection always wins.
 */
export function resolveVideoFps(
  selection: VideoFpsSelection,
  recommended?: number | null,
): VideoFpsOption {
  if (selection !== COMPATIBLE_VIDEO_FPS) return selection;
  return isVideoFpsOption(recommended) ? recommended : COMPATIBLE_VIDEO_FPS_FALLBACK;
}

export interface ResourceMediaMetrics {
  durationSec: number | null;
  sourceFrameCount: number | null;
  width?: number;
  height?: number;
}

export interface CapacityAssessment {
  capacity: DeviceFrameCapacity;
  requiredFrames: number;
  encodedFrames: number | null;
  minimumFrames: number;
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
      encodedFrames: speed <= MAX_AUTOMATIC_SPEED ? Math.min(required, capacity) : null,
      minimumFrames: Math.ceil(required / MAX_AUTOMATIC_SPEED),
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
