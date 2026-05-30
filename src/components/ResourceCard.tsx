import { memo, useEffect, useState } from "react";
import type { ResourceItem } from "../types/resource";
import { createImageUrl } from "../services/imageService";

interface ResourceCardProps {
  resource: ResourceItem;
  onDownload: (resource: ResourceItem) => void;
  onLike: (resource: ResourceItem) => void;
  downloading: boolean;
  liking: boolean;
  liked: boolean;
  likeCount: number;
}

function ResourceCardComponent({
  resource,
  onDownload,
  onLike,
  downloading,
  liking,
  liked,
  likeCount,
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

  const materialLabel = resource.materialType === "image" ? "图片素材" : "V1PRO素材包";
  const [signedImageUrl, setSignedImageUrl] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const fallbackUrl = /^https?:\/\//i.test(resource.download) ? resource.download : resource.image;
    createImageUrl(resource.id, fallbackUrl)
      .then((url) => {
        if (!cancelled) {
          setSignedImageUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSignedImageUrl("");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [resource.id, resource.image, resource.download]);

  return (
    <article className="group rounded-3xl border border-white/25 bg-white/55 p-4 shadow-[0_30px_45px_-28px_rgba(0,0,0,0.55)] backdrop-blur-xl transition duration-300 hover:-translate-y-1.5 hover:shadow-[0_32px_60px_-26px_rgba(34,211,238,0.45)] dark:border-white/10 dark:bg-slate-900/45">
      <div className="mb-3 inline-flex rounded-full bg-slate-900 px-3 py-1 text-xs text-white dark:bg-white dark:text-slate-900">
        {materialLabel}
      </div>
      <div className="rounded-[1.4rem] bg-black p-2.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] transition duration-300 group-hover:shadow-[inset_0_0_0_1px_rgba(56,189,248,0.45),0_0_26px_-10px_rgba(56,189,248,0.8)]">
        <div className="overflow-hidden rounded-[1rem] bg-slate-900" style={{ aspectRatio: "320 / 170" }}>
          {signedImageUrl ? (
            <img
              src={signedImageUrl}
              alt={resource.title}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
              图片加载中...
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          disabled={downloading}
          onClick={() => onDownload(resource)}
          className="flex-1 rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
        >
          {downloading ? "生成下载链接..." : resource.materialType === "image" ? "下载" : "下载素材"}
        </button>
        <button
          type="button"
          aria-label="点赞"
          disabled={liked || liking}
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
    </article>
  );
}

export const ResourceCard = memo(ResourceCardComponent);
