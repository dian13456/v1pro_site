import { useEffect, useMemo, useState } from "react";
import type { ResourceItem } from "../types/resource";
import { createImageUrl } from "../services/imageService";
import { probeResourceMedia } from "../services/resourceMediaProbe";
import {
  assessDeviceCapacities,
  formatMediaDuration,
  mergeResourceMetrics,
  requiredFramesForResource,
  resourceMetricsFromCatalog,
  VIDEO_FPS_OPTIONS,
  type ResourceMediaMetrics,
  type VideoFpsOption,
} from "../utils/resourceCapacity";

interface ResourceDetailModalProps {
  resource: ResourceItem;
  downloadCount: number;
  transferring: boolean;
  webUsbTransferring: boolean;
  onClose: () => void;
  onTransfer: (resource: ResourceItem) => void;
  onWebUsbTransfer: (resource: ResourceItem, fps: VideoFpsOption) => void;
}

function materialLabel(resource: ResourceItem): string {
  if (resource.materialType === "video") return "视频素材";
  if (resource.materialType === "gif") return "GIF素材";
  return "图片素材";
}

export function ResourceDetailModal({
  resource,
  downloadCount,
  transferring,
  webUsbTransferring,
  onClose,
  onTransfer,
  onWebUsbTransfer,
}: ResourceDetailModalProps) {
  const [fps, setFps] = useState<VideoFpsOption>(20);
  const [previewUrl, setPreviewUrl] = useState("");
  const [metrics, setMetrics] = useState<ResourceMediaMetrics>(() => resourceMetricsFromCatalog(resource));
  const [probing, setProbing] = useState(false);
  const isAnimated = resource.materialType === "video" || resource.materialType === "gif";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    setMetrics(resourceMetricsFromCatalog(resource));
    setPreviewUrl("");
    setProbing(true);
    const task = isAnimated
      ? probeResourceMedia(resource)
      : createImageUrl(resource.id, resource.image || resource.download).then((result) => ({
          url: result.url,
          metrics: { durationSec: null, sourceFrameCount: 1 } as ResourceMediaMetrics,
        }));
    void task
      .then((result) => {
        if (!active) return;
        setPreviewUrl(result.url || "");
        setMetrics((current) => mergeResourceMetrics(resource, { ...current, ...result.metrics }));
      })
      .catch(() => {
        if (!active) return;
        void createImageUrl(resource.id, resource.image || resource.download)
          .then((result) => active && setPreviewUrl(result.url || ""))
          .catch(() => undefined);
      })
      .finally(() => active && setProbing(false));
    return () => {
      active = false;
    };
  }, [isAnimated, resource]);

  const assessments = useMemo(
    () => assessDeviceCapacities(resource, metrics, fps),
    [fps, metrics, resource],
  );
  const measuredFrames = requiredFramesForResource(resource, metrics, fps);
  const requiredFrames = measuredFrames ?? 0;
  const metricsKnown = measuredFrames != null;
  const durationText = formatMediaDuration(metrics.durationSec);
  const canDirectTransfer = resource.materialType === "image" || resource.materialType === "gif" || resource.materialType === "video";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(30,35,55,.45)] p-3 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      aria-label={`${resource.title} 详情`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="grid max-h-[90vh] w-full max-w-[780px] overflow-auto rounded-[18px] bg-white shadow-[0_24px_60px_rgba(0,0,0,.25)] md:grid-cols-[1.15fr_1fr]">
        <div className="relative flex min-h-[220px] items-center justify-center overflow-hidden bg-gradient-to-br from-lime-200 via-emerald-200 to-cyan-200 p-4 md:min-h-[400px]">
          {previewUrl ? (
            resource.materialType === "video" ? (
              <video src={previewUrl} autoPlay loop muted playsInline controls className="max-h-[380px] w-full rounded-xl object-contain" />
            ) : (
              <img src={previewUrl} alt={resource.title} className="max-h-[380px] w-full rounded-xl object-contain" />
            )
          ) : (
            <div className="text-center text-slate-500">{probing ? "正在读取素材信息…" : "暂无预览"}</div>
          )}
          <div className="absolute inset-x-4 bottom-4 rounded-xl bg-black/25 px-3 py-1.5 text-center text-[11.5px] text-white backdrop-blur-sm">
            动态循环预览 · {resource.description || resource.title}
          </div>
        </div>

        <div className="flex flex-col gap-[13px] border-t border-[#e6e9f2] p-6 md:border-l md:border-t-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-bold text-[#2b3245]">{resource.title || resource.description}</h2>
              <div className="mt-2 flex flex-wrap gap-2 text-[11.5px]">
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-300">{materialLabel(resource)}</span>
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-300">{resource.columnTag || "其他"}</span>
                {durationText ? <span className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-300">◷ {durationText}</span> : null}
                {metricsKnown && requiredFrames > 308 ? <span className="rounded-full bg-orange-50 px-3 py-1 text-orange-500 dark:bg-orange-500/10">大占用 {requiredFrames}帧</span> : null}
              </div>
            </div>
            <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800">×</button>
          </div>

          <dl className="space-y-2 text-[12.5px]">
            <div className="flex justify-between gap-4"><dt className="text-slate-400">上传时间</dt><dd className="font-semibold">{new Date(resource.updatedAt).toLocaleDateString("zh-CN")}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-400">下载量</dt><dd className="font-semibold">{downloadCount} 次</dd></div>
          </dl>

          {isAnimated ? (
            <>
              <p className="text-xs font-bold tracking-[1px] text-[#8a93a8]">下传设备帧率（实际编码）</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {VIDEO_FPS_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFps(value)}
                    className={`rounded-[10px] border-[1.5px] px-2 py-[9px] text-[12.5px] font-semibold transition ${fps === value ? "border-[#ff8a5c] bg-[#fff7f2] text-[#ff8a5c] ring-2 ring-orange-100" : "border-[#e6e9f2] text-[#4a5270]"}`}
                  >
                    {value} fps
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <div className="rounded-xl border border-[#e6e9f2] bg-[#fafbfe] px-3.5 py-3 text-[12.5px] leading-[1.9]">
            <p className="text-slate-600 dark:text-slate-300">
              素材时长: <strong>{durationText || (isAnimated ? "待解析" : "静态")}</strong>{isAnimated ? <> ｜ {fps} fps → 原速需要 <strong>{metricsKnown ? `${requiredFrames} 帧` : "待解析"}</strong></> : <> ｜ 实际写入 <strong>1 帧</strong></>}
            </p>
            {metricsKnown ? <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs font-semibold">
              {assessments.map((item) => (
                <span key={item.capacity} className={item.originalSpeed ? "text-emerald-500" : item.fits ? "text-orange-500" : "text-rose-500"}>
                  {item.capacity} 帧设备：{item.originalSpeed
                    ? `原速写入 ${item.encodedFrames} 帧`
                    : item.fits
                      ? `实际写入 ${item.encodedFrames} 帧 · 自动加速 ${item.speed.toFixed(2)}×${item.playbackSec ? `(${item.playbackSec.toFixed(1)}s)` : ""}`
                      : `无法装入 · 至少需要 ${item.minimumFrames} 帧容量`}
                </span>
              ))}
            </div> : <p className="mt-2 text-xs font-semibold text-amber-600">素材源暂不可访问，连接资源服务后会自动解析时长与设备容量。</p>}
            <p className="mt-2 text-xs text-slate-500">✓ 所选帧率用于“网页直传”；“传输”将交给佳点 V1PRO 控制工具处理</p>
          </div>

          <div className="mt-auto grid grid-cols-2 gap-2.5 pt-2">
            <button type="button" disabled={transferring} onClick={() => onTransfer(resource)} className="rounded-[10px] bg-[#32b879] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(50,184,121,.28)] transition hover:bg-[#299f69] disabled:opacity-50">
              {transferring ? "传输中…" : "传输"}
            </button>
            <button type="button" disabled={webUsbTransferring || !canDirectTransfer} onClick={() => onWebUsbTransfer(resource, fps)} className="rounded-[10px] bg-gradient-to-br from-[#7c6cf0] to-[#5a9cff] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(124,108,240,.3)] disabled:opacity-50">
              {!canDirectTransfer ? "该格式不支持网页直传" : webUsbTransferring ? "网页直传中…" : "网页直传"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
