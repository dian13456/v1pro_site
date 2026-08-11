import { useEffect, useState } from "react";
import type { ResourceItem } from "../types/resource";
import { createImageUrl } from "../services/imageService";
import {
  formatMediaDuration,
  resourceMetricsFromCatalog,
  smallestCompatibleCapacity,
} from "../utils/resourceCapacity";

const PREVIEW_BACKGROUNDS = [
  "from-cyan-200 to-sky-300",
  "from-lime-200 to-emerald-200",
  "from-orange-200 to-rose-300",
  "from-fuchsia-200 to-violet-200",
  "from-indigo-200 to-blue-300",
];

function materialLabel(resource: ResourceItem): string {
  if (resource.materialType === "video") return "视频";
  if (resource.materialType === "gif") return "GIF";
  return "图片";
}

export function CompactResourceCard({
  resource,
  downloadCount,
  likeCount,
  liked,
  liking,
  onOpen,
  onLike,
}: {
  resource: ResourceItem;
  downloadCount: number;
  likeCount: number;
  liked: boolean;
  liking: boolean;
  onOpen: (resource: ResourceItem) => void;
  onLike: (resource: ResourceItem) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState("");
  const metrics = resourceMetricsFromCatalog(resource);
  const capacity = smallestCompatibleCapacity(resource, metrics, 25);
  const displayCapacity = resource.materialType === "image" ? null : capacity;
  const duration = formatMediaDuration(metrics.durationSec);

  useEffect(() => {
    let active = true;
    void createImageUrl(resource.id, resource.image || resource.download)
      .then((result) => {
        if (active) setPreviewUrl(result.url || "");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [resource.download, resource.id, resource.image]);

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpen(resource)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(resource);
        }
      }}
      className="group overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-1 hover:shadow-xl dark:border-slate-800 dark:bg-slate-900"
    >
      <div className={`relative aspect-[1.618] overflow-hidden bg-gradient-to-br ${PREVIEW_BACKGROUNDS[resource.id % PREVIEW_BACKGROUNDS.length]}`}>
        {previewUrl ? (
          <img src={previewUrl} alt={resource.title} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" loading="lazy" />
        ) : (
          <div className="grid h-full place-items-center text-5xl opacity-80">
            {resource.materialType === "video" ? "🎬" : resource.materialType === "gif" ? "🔁" : "🖼️"}
          </div>
        )}
        <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white ${resource.materialType === "image" ? "bg-violet-500" : resource.materialType === "gif" ? "bg-orange-400" : "bg-emerald-500"}`}>
          {materialLabel(resource)}
        </span>
        {duration || displayCapacity ? (
          <span className="absolute bottom-3 right-3 rounded-full bg-slate-900/55 px-2.5 py-1 text-[11px] text-white backdrop-blur">
            {duration ? `◷ ${duration}` : ""}{duration && displayCapacity ? " · " : ""}{displayCapacity ? `${displayCapacity}帧` : ""}
          </span>
        ) : null}
      </div>
      <div className="p-3.5">
        <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{resource.title || resource.description}</h3>
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          <span className="max-w-[70%] truncate rounded-full bg-indigo-50 px-2 py-1 text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-300">{resource.columnTag || resource.author || "其他"}</span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label={liked ? "已点赞" : "点赞"}
              aria-pressed={liked}
              disabled={liked || liking}
              onClick={(event) => {
                event.stopPropagation();
                onLike(resource);
              }}
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-1 transition disabled:cursor-not-allowed ${liked ? "bg-rose-50 text-rose-500" : "hover:bg-rose-50 hover:text-rose-500"}`}
            >
              <span aria-hidden="true">♥</span>
              <span>{liking ? "…" : likeCount}</span>
            </button>
            <span>⬇ {downloadCount}</span>
          </div>
        </div>
      </div>
    </article>
  );
}
