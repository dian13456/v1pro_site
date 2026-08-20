import { Link } from "react-router-dom";
import type { ResourceItem } from "../types/resource";
import { useCreatorAvatar } from "../hooks/useCreatorAvatar";
import { useResourcePreviewImage } from "../hooks/useResourcePreviewImage";
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
  favorited,
  favoriting,
  onOpen,
  onLike,
  onFavorite,
  hidden = false,
  hiding = false,
  onHiddenChange,
  followed = false,
  following = false,
  onFollow,
  selectionMode = false,
  selected = false,
  onToggleSelection,
}: {
  resource: ResourceItem;
  downloadCount: number;
  likeCount: number;
  liked: boolean;
  liking: boolean;
  favorited: boolean;
  favoriting: boolean;
  onOpen: (resource: ResourceItem) => void;
  onLike: (resource: ResourceItem) => void;
  onFavorite: (resource: ResourceItem) => void;
  hidden?: boolean;
  hiding?: boolean;
  onHiddenChange?: (resource: ResourceItem, hidden: boolean) => void;
  followed?: boolean;
  following?: boolean;
  onFollow?: (resource: ResourceItem, followed: boolean) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelection?: (resource: ResourceItem) => void;
}) {
  const { previewUrl, previewFailed, handlePreviewLoad, handlePreviewError } =
    useResourcePreviewImage(resource.id, resource.image || resource.download);
  const metrics = resourceMetricsFromCatalog(resource);
  const capacity = smallestCompatibleCapacity(resource, metrics, 25);
  const displayCapacity = resource.materialType === "image" ? null : capacity;
  const duration = formatMediaDuration(metrics.durationSec);
  const creatorAvatarUrl = useCreatorAvatar(resource.author);

  return (
    <article
      role="button"
      tabIndex={0}
      aria-pressed={selectionMode ? selected : undefined}
      onClick={() => selectionMode ? onToggleSelection?.(resource) : onOpen(resource)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (selectionMode) onToggleSelection?.(resource);
          else onOpen(resource);
        }
      }}
      className={`group cursor-pointer touch-manipulation overflow-hidden rounded-2xl border bg-white text-left shadow-sm transition hover:-translate-y-1 hover:shadow-xl dark:bg-slate-900 ${
        selected
          ? "border-[#ff8a5c] ring-2 ring-[#ff8a5c]/25 dark:border-[#ff8a5c]"
          : "border-slate-200 dark:border-slate-800"
      }`}
    >
      <div className={`relative aspect-[1.618] overflow-hidden bg-gradient-to-br ${PREVIEW_BACKGROUNDS[resource.id % PREVIEW_BACKGROUNDS.length]}`}>
        <div className="grid h-full place-items-center text-5xl opacity-80" aria-hidden={Boolean(previewUrl)}>
          {resource.materialType === "video" ? "🎬" : resource.materialType === "gif" ? "🔁" : "🖼️"}
        </div>
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={resource.title}
            className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
            loading="lazy"
            decoding="async"
            onLoad={handlePreviewLoad}
            onError={handlePreviewError}
          />
        ) : null}
        {previewFailed ? (
          <span className="absolute bottom-3 left-3 rounded-full bg-slate-900/55 px-2 py-1 text-[10px] text-white backdrop-blur">
            预览暂时不可用
          </span>
        ) : null}
        <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white ${resource.materialType === "image" ? "bg-violet-500" : resource.materialType === "gif" ? "bg-orange-400" : "bg-emerald-500"}`}>
          {materialLabel(resource)}
        </span>
        {selectionMode ? (
          <span className={`absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-full border-2 text-sm font-bold shadow-sm transition ${
            selected
              ? "border-white bg-[#ff7f57] text-white"
              : "border-white bg-white/85 text-transparent backdrop-blur"
          }`} aria-hidden="true">
            ✓
          </span>
        ) : null}
        {duration || displayCapacity ? (
          <span className="absolute bottom-3 right-3 rounded-full bg-slate-900/55 px-2.5 py-1 text-[11px] text-white backdrop-blur">
            {duration ? `◷ ${duration}` : ""}{duration && displayCapacity ? " · " : ""}{displayCapacity ? `${displayCapacity}帧` : ""}
          </span>
        ) : null}
      </div>
      <div className="p-3.5">
        <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{resource.title || resource.description}</h3>
        <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
          <span className="max-w-[40%] truncate rounded-full bg-indigo-50 px-2 py-1 text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-300">
            {resource.columnTag || "其他"}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {onHiddenChange ? (
              <button
                type="button"
                aria-label={hidden ? "恢复该用户的全部素材" : "屏蔽该用户的全部素材"}
                title={hidden ? "恢复该用户" : "屏蔽该用户"}
                disabled={hiding}
                onClick={(event) => {
                  event.stopPropagation();
                  onHiddenChange(resource, !hidden);
                }}
                className={`inline-flex items-center rounded-full px-1.5 py-1 text-sm transition disabled:cursor-not-allowed ${
                  hidden
                    ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                    : "hover:bg-slate-100 hover:text-slate-600"
                }`}
              >
                <span aria-hidden="true">{hiding ? "…" : hidden ? "↶" : "⊘"}</span>
              </button>
            ) : null}
            <button
              type="button"
              aria-label={favorited ? "取消收藏" : "收藏"}
              aria-pressed={favorited}
              disabled={favoriting}
              onClick={(event) => {
                event.stopPropagation();
                onFavorite(resource);
              }}
              className={`inline-flex items-center rounded-full px-1.5 py-1 text-sm transition disabled:cursor-not-allowed ${favorited ? "bg-amber-50 text-amber-500" : "hover:bg-amber-50 hover:text-amber-500"}`}
            >
              <span aria-hidden="true">{favoriting ? "…" : favorited ? "★" : "☆"}</span>
            </button>
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
        {resource.author ? (
          <div className="mt-2.5 flex min-w-0 items-center gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
            <Link
              to={`/creator/${encodeURIComponent(resource.author)}`}
              onClick={(event) => event.stopPropagation()}
              className="flex min-w-0 flex-1 items-center gap-2 text-xs text-slate-500 transition hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-300"
              title={`查看 ${resource.author} 的全部素材`}
            >
              <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#ff8a5c] to-[#7c6cf0] text-xs font-semibold text-white shadow-sm">
                {creatorAvatarUrl ? (
                  <img src={creatorAvatarUrl} alt={`${resource.author}的头像`} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  resource.author.trim().slice(0, 1).toUpperCase() || "👤"
                )}
              </span>
              <span className="min-w-0 truncate font-medium">{resource.author}</span>
            </Link>
            {onFollow ? (
              <button
                type="button"
                aria-label={followed ? `取消关注 ${resource.author}` : `关注 ${resource.author}`}
                aria-pressed={followed}
                disabled={following}
                onClick={(event) => {
                  event.stopPropagation();
                  onFollow(resource, !followed);
                }}
                className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                  followed
                    ? "border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-100 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-300"
                    : "border-slate-200 bg-white text-slate-500 hover:border-violet-300 hover:text-violet-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                }`}
              >
                {following ? "…" : followed ? "已关注" : "+ 关注"}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
