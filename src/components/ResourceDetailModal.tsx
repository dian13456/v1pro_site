import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ResourceItem } from "../types/resource";
import { createImageUrl } from "../services/imageService";
import { probeResourceMedia } from "../services/resourceMediaProbe";
import { fetchMessages, MAX_MESSAGE_LENGTH, postMessage } from "../services/messageBoardService";
import type { BoardMessage } from "../types/messageBoard";
import {
  formatMediaDuration,
  mergeResourceMetrics,
  resourceMetricsFromCatalog,
  type ResourceMediaMetrics,
} from "../utils/resourceCapacity";
import { defaultTransferFitMode } from "../utils/transferFitMode";
import { useDeviceFeatureAccess } from "../services/featureAccessService";

interface ResourceDetailModalProps {
  resource: ResourceItem;
  downloadCount: number;
  transferring: boolean;
  webUsbTransferring: boolean;
  webUsbProgress?: number | null;
  transferMessage?: string;
  onClose: () => void;
  onTransfer: (resource: ResourceItem) => void;
  onWebUsbTransfer: (resource: ResourceItem, options: ResourceWebUsbTransferOptions) => void;
}

export interface ResourceWebUsbTransferOptions {
  fitMode: "fill" | "contain";
  rotationDeg: 0 | 90 | 180 | 270;
  colorProfile: "normal" | "vivid" | "professional";
}

const COLOR_PROFILE_LABELS: Array<[ResourceWebUsbTransferOptions["colorProfile"], string]> = [
  ["normal", "普通"],
  ["vivid", "鲜艳"],
  ["professional", "专业"],
];

function materialLabel(resource: ResourceItem): string {
  if (resource.materialType === "video") return "视频素材";
  if (resource.materialType === "gif") return "GIF素材";
  return "图片素材";
}

function formatCommentTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ResourceDetailModal({
  resource,
  downloadCount,
  transferring,
  webUsbTransferring,
  webUsbProgress = null,
  transferMessage = "",
  onClose,
  onTransfer,
  onWebUsbTransfer,
}: ResourceDetailModalProps) {
  const { access } = useDeviceFeatureAccess();
  const featureEnabled = access?.enabled === true;
  const transferMediaKind = resource.materialType === "v1pro-pack" ? "image" : resource.materialType;
  const [fitMode, setFitMode] = useState<ResourceWebUsbTransferOptions["fitMode"]>(() =>
    resource.transferDefaults?.fitMode ?? defaultTransferFitMode(transferMediaKind),
  );
  const [rotationDeg, setRotationDeg] = useState<ResourceWebUsbTransferOptions["rotationDeg"]>(() => resource.transferDefaults?.rotationDeg ?? 0);
  const [colorProfile, setColorProfile] = useState<ResourceWebUsbTransferOptions["colorProfile"]>(() => resource.transferDefaults?.colorProfile ?? "normal");
  const [previewUrl, setPreviewUrl] = useState("");
  const [metrics, setMetrics] = useState<ResourceMediaMetrics>(() => resourceMetricsFromCatalog(resource));
  const [probing, setProbing] = useState(false);
  const [comments, setComments] = useState<BoardMessage[]>([]);
  const [commentTotal, setCommentTotal] = useState(0);
  const [commentContent, setCommentContent] = useState("");
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentError, setCommentError] = useState("");
  const isAnimated = resource.materialType === "video" || resource.materialType === "gif";

  useEffect(() => {
    setFitMode(resource.transferDefaults?.fitMode ?? defaultTransferFitMode(transferMediaKind));
    setRotationDeg(resource.transferDefaults?.rotationDeg ?? 0);
    setColorProfile(resource.transferDefaults?.colorProfile ?? "normal");
  }, [resource.id, resource.transferDefaults, transferMediaKind]);

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
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      if (previousOverflow) document.body.style.overflow = previousOverflow;
      else document.body.style.removeProperty("overflow");
    };
  }, []);

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

  useEffect(() => {
    let active = true;
    setComments([]);
    setCommentTotal(0);
    setCommentContent("");
    setCommentError("");
    setCommentsLoading(true);
    void fetchMessages(100, String(resource.id))
      .then((result) => {
        if (!active) return;
        setComments(result.messages);
        setCommentTotal(result.total);
      })
      .catch((error) => {
        if (active) setCommentError((error as Error)?.message || "评论加载失败");
      })
      .finally(() => {
        if (active) setCommentsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [resource.id]);

  // The card intentionally does not estimate a fixed frame rate. Direct
  // WebUSB transfers choose the firmware-compatible beginner strategy at
  // transfer time (GFM3 byte fitting or the legacy compatibility path).
  // Static images always occupy one frame; only animated media needs a
  // metadata probe before we can report its duration/frame count.
  const metricsKnown = !isAnimated || metrics.durationSec != null || metrics.sourceFrameCount != null;
  const durationText = formatMediaDuration(metrics.durationSec);
  const canDirectTransfer = resource.materialType === "image" || resource.materialType === "gif" || resource.materialType === "video";

  const handleCommentSubmit = async () => {
    const content = commentContent.trim();
    if (!content || commentSubmitting) return;
    setCommentSubmitting(true);
    setCommentError("");
    try {
      const entry = await postMessage(content, String(resource.id));
      setComments((current) => [entry, ...current]);
      setCommentTotal((current) => current + 1);
      setCommentContent("");
    } catch (error) {
      setCommentError((error as Error)?.message || "评论发布失败");
    } finally {
      setCommentSubmitting(false);
    }
  };

  const modal = (
    <div
      className="resource-detail-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(30,35,55,.45)] p-3 backdrop-blur-[3px]"
      role="dialog"
      aria-modal="true"
      aria-label={`${resource.title} 详情`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="resource-detail-surface grid max-h-[92vh] w-full max-w-[1080px] overflow-auto rounded-[28px] bg-white shadow-[0_24px_60px_rgba(0,0,0,.25)] md:grid-cols-[minmax(300px,1.08fr)_minmax(340px,.92fr)]">
        <div className="relative flex min-h-[240px] items-center justify-center overflow-hidden bg-gradient-to-br from-sky-100 via-slate-100 to-indigo-100 p-5 md:min-h-[520px]">
          {previewUrl ? (
            resource.materialType === "video" ? (
              <video src={previewUrl} autoPlay loop muted playsInline controls className="max-h-[470px] w-full rounded-[18px] object-contain shadow-[0_18px_50px_rgba(15,23,42,.14)]" />
            ) : (
              <img src={previewUrl} alt={resource.title} className="max-h-[470px] w-full rounded-[18px] object-contain shadow-[0_18px_50px_rgba(15,23,42,.14)]" />
            )
          ) : (
            <div className="text-center text-slate-500">{probing ? "正在读取素材信息…" : "暂无预览"}</div>
          )}
          <div className="absolute inset-x-4 bottom-4 rounded-xl bg-black/25 px-3 py-1.5 text-center text-[11.5px] text-white backdrop-blur-sm">
            动态循环预览 · {resource.description || resource.title}
          </div>
        </div>

        <div className="flex flex-col gap-[13px] border-t border-[#e6e9f2] p-6 md:border-l md:border-t-0 lg:p-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.025em] text-[#1d1d1f]">{resource.title || resource.description}</h2>
              <div className="mt-2 flex flex-wrap gap-2 text-[11.5px]">
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-300">{materialLabel(resource)}</span>
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-300">{resource.columnTag || "其他"}</span>
                {durationText ? <span className="rounded-full bg-indigo-50 px-3 py-1 text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-300">◷ {durationText}</span> : null}
              </div>
            </div>
            <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-lg text-slate-500 transition hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:hover:bg-slate-700 dark:hover:text-white" aria-label="关闭素材详情">×</button>
          </div>

          <dl className="space-y-2 text-[12.5px]">
            <div className="flex justify-between gap-4"><dt className="text-slate-400">上传时间</dt><dd className="font-semibold">{new Date(resource.updatedAt).toLocaleDateString("zh-CN")}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-slate-400">下载量</dt><dd className="font-semibold">{downloadCount} 次</dd></div>
            {resource.transferDefaults ? (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-400">分享者适配</dt>
                <dd className="text-right font-semibold">{resource.transferDefaults.targetFrameCapacities.map((value) => `${value}帧`).join(" / ")}</dd>
              </div>
            ) : null}
          </dl>

          {resource.transferDefaults ? <p className="text-xs font-semibold text-emerald-600">✓ 已载入分享者推荐的下传参数，可在下方继续调整</p> : null}

          <div className="grid grid-cols-2 gap-2.5">
            <label className="text-xs font-bold tracking-[1px] text-[#8a93a8]">
              画面方向
              <select
                value={rotationDeg}
                onChange={(event) => setRotationDeg(Number(event.target.value) as ResourceWebUsbTransferOptions["rotationDeg"])}
                className="mt-2 w-full rounded-[10px] border border-[#e6e9f2] bg-white px-2.5 py-2 text-[12.5px] font-semibold text-[#4a5270] outline-none"
              >
                <option value={0}>0° 原方向</option>
                <option value={90}>90° 顺时针</option>
                <option value={180}>180°</option>
                <option value={270}>270° 顺时针</option>
              </select>
            </label>
            <div>
              <p className="text-xs font-bold tracking-[1px] text-[#8a93a8]">画面显示</p>
              <div className="mt-2 flex h-[38px] items-center gap-3 rounded-[10px] border border-[#e6e9f2] px-2.5 text-[12px] text-[#4a5270]">
                <label className="flex cursor-pointer items-center gap-1"><input type="radio" name={`detailFit-${resource.id}`} checked={fitMode === "fill"} onChange={() => setFitMode("fill")} /> 铺满</label>
                <label className="flex cursor-pointer items-center gap-1"><input type="radio" name={`detailFit-${resource.id}`} checked={fitMode === "contain"} onChange={() => setFitMode("contain")} /> 适应</label>
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-bold tracking-[1px] text-[#8a93a8]">素材色彩</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-[#4a5270]">
              {COLOR_PROFILE_LABELS.map(([value, label]) => (
                <label key={value} className="flex cursor-pointer items-center gap-1.5">
                  <input type="radio" name={`detailColor-${resource.id}`} checked={colorProfile === value} onChange={() => setColorProfile(value)} />
                  {label}
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-[#e6e9f2] bg-[#fafbfe] px-3.5 py-3 text-[12.5px] leading-[1.9]">
            <p className="text-slate-600 dark:text-slate-300">
              素材时长: <strong>{durationText || (isAnimated ? "待解析" : "静态")}</strong>{isAnimated ? <> ｜ <strong>自动兼容设备</strong></> : <> ｜ 实际写入 <strong>1 帧</strong></>}
            </p>
            {isAnimated ? (
              <p className="mt-2 text-xs font-semibold text-emerald-600">✓ 网页直传会根据设备自动适配。</p>
            ) : !metricsKnown ? (
              <p className="mt-2 text-xs font-semibold text-amber-600">素材源暂不可访问，连接资源服务后会自动解析素材信息。</p>
            ) : null}
          </div>

          {webUsbProgress != null ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-3.5 py-3">
              <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-600">
                <span>{webUsbProgress >= 100 ? "网页直传完成" : transferMessage || "正在网页直传…"}</span>
                <span className="shrink-0 text-emerald-600">{Math.round(webUsbProgress)}%</span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white shadow-inner">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#32b879] via-[#32c89a] to-[#5a9cff] transition-[width] duration-200 ease-out"
                  style={{ width: `${Math.max(0, Math.min(100, webUsbProgress))}%` }}
                  role="progressbar"
                  aria-label="网页直传进度"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(webUsbProgress)}
                />
              </div>
              {transferMessage && webUsbProgress >= 100 ? (
                <p className="mt-2 text-xs leading-5 text-slate-500">{transferMessage}</p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-auto grid grid-cols-2 gap-2.5 pt-2">
            <button type="button" disabled={transferring || !featureEnabled} title={featureEnabled ? "传输到设备" : "请先到个人中心输入激活码"} onClick={() => onTransfer(resource)} className="rounded-[10px] bg-[#32b879] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(50,184,121,.28)] transition hover:bg-[#299f69] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none disabled:opacity-100">
              {transferring ? "传输中…" : featureEnabled ? "传输" : "未激活"}
            </button>
            <button
              type="button"
              disabled={webUsbTransferring || !canDirectTransfer}
              title="网页直传"
              onClick={() => onWebUsbTransfer(resource, { fitMode, rotationDeg, colorProfile })}
              className="rounded-[12px] bg-gradient-to-b from-[#2997ff] to-[#0071e3] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_6px_18px_rgba(0,113,227,.24)] transition hover:-translate-y-0.5 hover:shadow-[0_9px_24px_rgba(0,113,227,.3)] disabled:opacity-50"
            >
              {!canDirectTransfer ? "该格式不支持网页直传" : webUsbTransferring ? "网页直传中…" : "网页直传"}
            </button>
          </div>
        </div>

        <details className="group/comments border-t border-[#e6e9f2] bg-[#fafbfe] md:col-span-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 transition hover:bg-white/75 [&::-webkit-details-marker]:hidden">
            <div>
              <h3 className="text-[15px] font-semibold text-[#2b3245]">评论区</h3>
              <p className="mt-0.5 text-[11.5px] text-[#8a93a8]">共 {commentTotal} 条评论 · 点击展开参与讨论</p>
            </div>
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white text-sm text-slate-500 shadow-sm transition group-open/comments:rotate-180" aria-hidden="true">⌄</span>
          </summary>
          <div className="border-t border-[#e6e9f2] p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-[14px] font-semibold text-[#2b3245]">参与讨论</h3>
              <p className="mt-1 text-[11.5px] text-[#8a93a8]">支持 Ctrl + Enter 快速发送</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setCommentsLoading(true);
                setCommentError("");
                void fetchMessages(100, String(resource.id))
                  .then((result) => {
                    setComments(result.messages);
                    setCommentTotal(result.total);
                  })
                  .catch((error) => setCommentError((error as Error)?.message || "评论加载失败"))
                  .finally(() => setCommentsLoading(false));
              }}
              className="rounded-full border border-[#e1e5ef] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#6f7890] transition hover:border-[#b9b0ff] hover:text-[#6f60dd]"
            >
              刷新
            </button>
          </div>

          <div className="mt-4 max-h-[280px] min-h-[150px] space-y-3 overflow-y-auto pr-1">
            {commentsLoading ? <p className="py-8 text-center text-xs text-[#8a93a8]">正在加载评论…</p> : null}
            {!commentsLoading && comments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#dfe3ed] bg-white/70 px-4 py-8 text-center">
                <p className="text-2xl">💬</p>
                <p className="mt-2 text-xs font-semibold text-[#6f7890]">还没有评论，来说两句吧</p>
              </div>
            ) : null}
            {!commentsLoading ? comments.map((item) => (
              <article key={item.id} className="rounded-2xl border border-white bg-white p-3 shadow-[0_5px_18px_rgba(43,50,69,.06)]">
                <div className="flex items-center gap-2.5">
                  <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#8d7df4] to-[#58a5ff] text-sm font-bold text-white">
                    {item.avatarUrl ? <img src={item.avatarUrl} alt={`${item.username}的头像`} className="h-full w-full object-cover" loading="lazy" /> : (item.username.trim().slice(0, 1) || "佳")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-bold text-[#3b4359]">{item.username || "佳点用户"}</p>
                    <time className="text-[10.5px] text-[#9aa2b4]">{formatCommentTime(item.createdAt)}</time>
                  </div>
                </div>
                <p className="mt-2.5 whitespace-pre-wrap break-words text-[12.5px] leading-5 text-[#5d657a]">{item.content}</p>
              </article>
            )) : null}
          </div>

          <div className="mt-4 border-t border-[#e5e8f0] pt-4">
            {commentError ? <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-600">{commentError}</p> : null}
            <textarea
              value={commentContent}
              onChange={(event) => setCommentContent(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void handleCommentSubmit();
                }
              }}
              rows={3}
              placeholder="输入评论，Ctrl + Enter 发送…"
              className="w-full resize-none rounded-xl border border-[#dfe3ed] bg-white px-3 py-2.5 text-[12.5px] leading-5 text-[#3b4359] outline-none transition placeholder:text-[#aab1bf] focus:border-[#8b7cf5] focus:ring-2 focus:ring-[#8b7cf5]/10"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-[10.5px] text-[#9aa2b4]">{commentContent.trim().length}/{MAX_MESSAGE_LENGTH}</span>
              <button
                type="button"
                disabled={commentSubmitting || !commentContent.trim()}
                onClick={() => void handleCommentSubmit()}
                className="rounded-[10px] bg-gradient-to-r from-[#7c6cf0] to-[#5a9cff] px-4 py-2 text-[12px] font-semibold text-white shadow-[0_5px_14px_rgba(124,108,240,.24)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {commentSubmitting ? "发送中…" : "发送评论"}
              </button>
            </div>
          </div>
          </div>
        </details>
      </div>
    </div>
  );
  return createPortal(modal, document.body);
}
