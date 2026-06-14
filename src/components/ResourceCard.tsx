import { memo, useEffect, useRef, useState } from "react";
import type { ResourceItem } from "../types/resource";
import { DevicePreviewFrame } from "./DevicePreviewFrame";
import { createImageUrl } from "../services/imageService";
import { canTransferViaV1Pro } from "../services/v1proTransferService";

interface ResourceCardProps {
  resource: ResourceItem;
  onDownload: (resource: ResourceItem) => void;
  onTransfer?: (resource: ResourceItem) => void;
  onTransferPrepare?: (resource: ResourceItem) => void;
  onPlay: (resource: ResourceItem) => Promise<string | void>;
  onPlayPrepare?: (resource: ResourceItem) => void;
  onStopPlay: () => void;
  onLike: (resource: ResourceItem) => void;
  onFavorite?: (resource: ResourceItem) => void;
  downloading: boolean;
  transferring?: boolean;
  transferReady?: boolean;
  playing: boolean;
  isPlaying: boolean;
  playUrl: string;
  liking: boolean;
  liked: boolean;
  likeCount: number;
  favorited?: boolean;
  favoriting?: boolean;
  downloadCount: number;
  weeklyDownloadCount: number;
  showWeeklyDownloadCount?: boolean;
}

function ResourceCardComponent({
  resource,
  onDownload,
  onTransfer,
  onTransferPrepare,
  onPlay,
  onPlayPrepare,
  onStopPlay,
  onLike,
  onFavorite,
  downloading,
  transferring = false,
  transferReady = false,
  playing,
  isPlaying,
  playUrl,
  liking,
  liked,
  likeCount,
  favorited = false,
  favoriting = false,
  downloadCount,
  weeklyDownloadCount,
  showWeeklyDownloadCount = false,
}: ResourceCardProps) {
  if (resource.category === "software") {
    return (
      <article className="rounded-2xl border border-white/25 bg-white/55 p-4 backdrop-blur dark:border-white/10 dark:bg-slate-900/45">
        <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{resource.title}</div>
        <button
          type="button"
          disabled={downloading}
          onClick={() => onDownload(resource)}
          className="mt-3 w-full rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
        >
          {downloading ? "生成下载链接..." : "下载"}
        </button>
      </article>
    );
  }

  const materialLabel =
    resource.materialType === "image"
      ? "图片素材"
      : resource.materialType === "video"
        ? "视频素材"
        : resource.materialType === "gif"
          ? "GIF素材"
        : "V1PRO素材包";
  const previewFitClass =
    resource.materialType === "video" || resource.materialType === "image"
      ? "object-cover"
      : "object-contain";
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let cancelled = false;
    const loadPreview = async () => {
      try {
        if (resource.materialType === "video") {
          const videoUrl = await createImageUrl(resource.id, resource.image);
          if (!cancelled) {
            setPreviewUrl(videoUrl.url || "");
          }
          return;
        }
        const imageUrl = await createImageUrl(resource.id, resource.image || resource.download);
        if (!cancelled) {
          setPreviewUrl(imageUrl.url || "");
        }
      } catch {
        if (!cancelled) {
          setPreviewUrl("");
        }
      }
    };
    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [resource.id, resource.image, resource.download, resource.materialType]);

  const showTransfer = canTransferViaV1Pro(resource) && Boolean(onTransfer);
  const hasPlay = resource.materialType === "video" || resource.materialType === "gif";

  useEffect(() => {
    if (resource.materialType !== "video" || !isPlaying || !playUrl) return;
    const video = videoRef.current;
    if (!video) return;
    video.load();
    void video.play().catch(() => {
      // 自动播放被策略拦截时保留控件，用户可手动点播放
    });
  }, [resource.materialType, isPlaying, playUrl]);

  const handlePlayClick = async () => {
    if (isPlaying) {
      videoRef.current?.pause();
      onStopPlay();
      return;
    }
    if (playing) return;

    try {
      await onPlay(resource);
    } catch {
      // 错误信息由页面层 handlePlay 写入
    }
  };

  return (
    <article className="group rounded-3xl border border-white/25 bg-white/55 p-4 shadow-[0_30px_45px_-28px_rgba(0,0,0,0.55)] backdrop-blur-xl transition duration-300 hover:-translate-y-1.5 hover:shadow-[0_32px_60px_-26px_rgba(34,211,238,0.45)] dark:border-white/10 dark:bg-slate-900/45">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="inline-flex rounded-full bg-slate-900 px-3 py-1 text-xs text-white dark:bg-white dark:text-slate-900">
          {materialLabel}
        </div>
        <div className="flex items-center gap-2">
          {onFavorite ? (
            <button
              type="button"
              aria-label={favorited ? "取消收藏" : "收藏"}
              disabled={favoriting || transferring}
              onClick={() => onFavorite(resource)}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60 ${
                favorited
                  ? "border-amber-300 bg-amber-50 text-amber-600 dark:border-amber-500/50 dark:bg-amber-500/15 dark:text-amber-300"
                  : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill={favorited ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M12 2l2.9 6.3 6.9.6-5.2 4.5 1.6 6.8L12 16.9 5.8 20.2l1.6-6.8-5.2-4.5 6.9-.6L12 2z" />
              </svg>
            </button>
          ) : null}
          <div className="flex flex-col items-end gap-1 text-[11px] text-slate-500 dark:text-slate-400">
          {showWeeklyDownloadCount && weeklyDownloadCount > 0 ? (
            <div className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200">
              本周 {weeklyDownloadCount}
            </div>
          ) : null}
          {downloadCount > 0 ? <div>总下载 {downloadCount}</div> : null}
          {resource.author ? <div>上传人：{resource.author}</div> : null}
          </div>
        </div>
      </div>
      <DevicePreviewFrame hoverGlow>
          {resource.materialType === "video" ? (
            <>
              <video
                ref={videoRef}
                src={isPlaying && playUrl ? playUrl : undefined}
                controls
                playsInline
                preload="metadata"
                className={`h-full w-full ${previewFitClass} ${isPlaying && playUrl ? "" : "hidden"}`}
                onEnded={onStopPlay}
              />
              {!(isPlaying && playUrl) && previewUrl ? (
                <img
                  src={previewUrl}
                  alt={resource.title}
                  loading="lazy"
                  decoding="async"
                  className={`h-full w-full ${previewFitClass}`}
                />
              ) : !(isPlaying && playUrl) ? (
                <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
                  视频预览加载中...
                </div>
              ) : null}
            </>
          ) : resource.materialType === "gif" && isPlaying && playUrl ? (
            <img
              src={playUrl}
              alt={`${resource.title} GIF 播放`}
              loading="eager"
              decoding="async"
              className="h-full w-full object-contain"
            />
          ) : previewUrl ? (
            <img
              src={previewUrl}
              alt={resource.title}
              loading="lazy"
              decoding="async"
              className={`h-full w-full ${previewFitClass}`}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
              {resource.materialType === "video" ? "视频预览加载中..." : "图片加载中..."}
            </div>
          )}
      </DevicePreviewFrame>

      <div className="mt-4 space-y-2">
        <div className={`grid gap-2 ${showTransfer ? "grid-cols-2" : "grid-cols-1"}`}>
          <button
            type="button"
            disabled={downloading || transferring}
            onClick={() => onDownload(resource)}
            className="w-full rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            {downloading
              ? "生成下载链接..."
              : resource.materialType === "image" || resource.materialType === "video" || resource.materialType === "gif"
                ? "下载"
                : "下载素材"}
          </button>
          {showTransfer ? (
            <button
              type="button"
              disabled={downloading || (transferring && !transferReady)}
              onPointerDown={() => onTransferPrepare?.(resource)}
              onClick={() => onTransfer?.(resource)}
              className={`w-full rounded-xl px-3 py-2.5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                transferReady
                  ? "bg-amber-500 shadow-[0_0_0_2px_rgba(251,191,36,0.55)] hover:bg-amber-400"
                  : "bg-cyan-600 hover:bg-cyan-500"
              }`}
            >
              {transferring ? "准备传输..." : transferReady ? "再次点击传输" : "传输到设备"}
            </button>
          ) : null}
        </div>
        <div className={`grid gap-2 ${hasPlay ? "grid-cols-2" : "grid-cols-1"}`}>
          {hasPlay ? (
            <button
              type="button"
              disabled={playing || transferring}
              onPointerDown={() => onPlayPrepare?.(resource)}
              onClick={() => void handlePlayClick()}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            >
              {playing ? "打开中..." : isPlaying ? "收起" : "播放"}
            </button>
          ) : null}
          <button
            type="button"
            aria-label="点赞"
            disabled={liked || liking || transferring}
            onClick={() => onLike(resource)}
            className={`inline-flex min-w-[76px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-75 ${
              liked
                ? "border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-500/50 dark:bg-rose-500/15 dark:text-rose-400"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
              <path d="M12 21s-6.7-4.35-9.3-8.12C.84 10.3 1.4 6.72 4.2 5.2a5.2 5.2 0 0 1 6.2 1.08L12 7.9l1.6-1.62a5.2 5.2 0 0 1 6.2-1.08c2.8 1.52 3.36 5.1 1.5 7.68C18.7 16.65 12 21 12 21z" />
            </svg>
            <span>{liking ? "..." : likeCount}</span>
          </button>
        </div>
      </div>
    </article>
  );
}

export const ResourceCard = memo(ResourceCardComponent);
