import { Link } from "react-router-dom";
import type { ResourceItem } from "../types/resource";
import { useCreatorAvatar } from "../hooks/useCreatorAvatar";
import { useResourcePreviewImage } from "../hooks/useResourcePreviewImage";
import { publicMaterialCoverUrl } from "../services/materialCdnService";
import {
  formatMediaDuration,
  resourceMetricsFromCatalog,
  smallestCompatibleCapacity,
} from "../utils/resourceCapacity";
import { ThemeIcon } from "./ThemeIcon";

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
  adminQuotaResetting = false,
  onAdminQuotaReset,
  adminDeleting = false,
  onAdminDelete,
  adminUploaderPurging = false,
  onAdminPurgeUploader,
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
  adminQuotaResetting?: boolean;
  onAdminQuotaReset?: (resource: ResourceItem) => void;
  adminDeleting?: boolean;
  onAdminDelete?: (resource: ResourceItem) => void;
  adminUploaderPurging?: boolean;
  onAdminPurgeUploader?: (resource: ResourceItem) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelection?: (resource: ResourceItem) => void;
}) {
  const { previewUrl, previewFailed, handlePreviewLoad, handlePreviewError } =
    useResourcePreviewImage(
      resource.id,
      resource.image || resource.download,
      publicMaterialCoverUrl(resource),
    );
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
      className={`resource-card-apple group flex aspect-[1.618] cursor-pointer touch-manipulation flex-col overflow-hidden rounded-[22px] border bg-white text-left shadow-sm transition dark:bg-slate-900 ${
        selected
          ? "border-[#ff8a5c] ring-2 ring-[#ff8a5c]/25 dark:border-[#ff8a5c]"
          : "border-slate-200 dark:border-slate-800"
      }`}
    >
      <div className={`relative min-h-0 flex-1 overflow-hidden bg-gradient-to-br ${PREVIEW_BACKGROUNDS[resource.id % PREVIEW_BACKGROUNDS.length]}`}>
        <div className="grid h-full place-items-center text-5xl opacity-80" aria-hidden={Boolean(previewUrl)}>
          {resource.materialType === "video" ? "🎬" : resource.materialType === "gif" ? "🔁" : "🖼️"}
        </div>
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={resource.title}
            // Do not hide a public cover while waiting for `load`.  Slow
            // mobile/CDN responses previously left every card transparent;
            // the gradient placeholder remains visible underneath until the
            // image is painted, and onError still activates the retry path.
            className="absolute inset-0 h-full w-full object-cover opacity-100 transition duration-500 group-hover:scale-[1.03]"
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
      <div className="shrink-0 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-[-0.015em] text-slate-950 dark:text-white">{resource.title || resource.description}</h3>
          <span className="max-w-[34%] shrink-0 truncate rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-500 dark:bg-indigo-500/10 dark:text-indigo-300">
            {resource.columnTag || "其他"}
          </span>
        </div>
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[10.5px] text-slate-400">
          {resource.author ? (
            <Link
              to={`/creator/${encodeURIComponent(resource.author)}`}
              onClick={(event) => event.stopPropagation()}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-slate-500 transition hover:text-[#0071e3] dark:text-slate-400 dark:hover:text-sky-300"
              title={`查看 ${resource.author} 的全部素材`}
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#2997ff] to-[#0071e3] text-[9px] font-semibold text-white shadow-sm">
                {creatorAvatarUrl ? (
                  <img src={creatorAvatarUrl} alt={`${resource.author}的头像`} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  resource.author.trim().slice(0, 1).toUpperCase() || "👤"
                )}
              </span>
              <span className="min-w-0 truncate font-medium">{resource.author}</span>
            </Link>
          ) : <span className="min-w-0 flex-1" />}
          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              aria-label={favorited ? "取消收藏" : "收藏"}
              aria-pressed={favorited}
              disabled={favoriting}
              onClick={(event) => {
                event.stopPropagation();
                onFavorite(resource);
              }}
                className={`inline-flex items-center rounded-full p-1 text-sm transition disabled:cursor-not-allowed ${favorited ? "bg-amber-50 text-amber-500" : "hover:bg-amber-50 hover:text-amber-500"}`}
            >
              {favoriting ? <span aria-hidden="true">…</span> : <ThemeIcon name="favorite" size={15} filled={favorited} />}
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
                className={`inline-flex items-center gap-0.5 rounded-full px-1 py-1 transition disabled:cursor-not-allowed ${liked ? "bg-rose-50 text-rose-500" : "hover:bg-rose-50 hover:text-rose-500"}`}
            >
              <ThemeIcon name="like" size={14} filled={liked} />
              <span>{liking ? "…" : likeCount}</span>
            </button>
            <span className="inline-flex items-center gap-0.5 px-0.5"><ThemeIcon name="download" size={13} /> {downloadCount}</span>
            {onFollow || onHiddenChange || onAdminQuotaReset || onAdminDelete || onAdminPurgeUploader ? (
              <details className="group/card-menu relative" onClick={(event) => event.stopPropagation()}>
                <summary className="grid h-5 w-5 cursor-pointer list-none place-items-center rounded-full text-[11px] font-bold tracking-[-1px] text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white [&::-webkit-details-marker]:hidden" aria-label="更多素材操作">
                  •••
                </summary>
                <div className="absolute bottom-[calc(100%+7px)] right-0 z-30 grid w-56 gap-1 rounded-xl border border-black/[.07] bg-white/95 p-1.5 text-[11px] shadow-[0_14px_38px_rgba(15,23,42,.2)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/95">
                  {onFollow ? (
                    <button
                      type="button"
                      disabled={following || adminUploaderPurging}
                      onClick={() => onFollow(resource, !followed)}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-slate-600 transition hover:bg-sky-50 hover:text-[#0071e3] disabled:opacity-60 dark:text-slate-200 dark:hover:bg-sky-500/10 dark:hover:text-sky-300"
                    >
                      <span className="w-4 text-center" aria-hidden="true">{followed ? "✓" : "+"}</span>
                      {following ? "处理中…" : followed ? "取消关注" : "关注上传者"}
                    </button>
                  ) : null}
                  {onHiddenChange ? (
                    <button
                      type="button"
                      disabled={hiding || adminUploaderPurging}
                      onClick={() => onHiddenChange(resource, !hidden)}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:opacity-60 dark:text-slate-200 dark:hover:bg-white/[.07] dark:hover:text-white"
                    >
                      <ThemeIcon name={hidden ? "restore" : "block"} size={14} />
                      {hiding ? "处理中…" : hidden ? "恢复该用户" : "屏蔽该用户"}
                    </button>
                  ) : null}
                  {onAdminQuotaReset ? (
                    <button
                      type="button"
                      disabled={adminQuotaResetting || adminDeleting || adminUploaderPurging}
                      onClick={() => onAdminQuotaReset(resource)}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sky-700 transition hover:bg-sky-50 disabled:opacity-60 dark:text-sky-300 dark:hover:bg-sky-500/10"
                    >
                      <span className="w-4 text-center" aria-hidden="true">↻</span>
                      {adminQuotaResetting ? "重置中…" : "重置上传额度（50）"}
                    </button>
                  ) : null}
                  {onAdminDelete ? (
                    <button
                      type="button"
                      disabled={adminDeleting || adminQuotaResetting || adminUploaderPurging}
                      onClick={() => onAdminDelete(resource)}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-rose-600 transition hover:bg-rose-50 disabled:opacity-60 dark:text-rose-300 dark:hover:bg-rose-500/10"
                    >
                      <span className="w-4 text-center" aria-hidden="true">⌫</span>
                      {adminDeleting ? "删除中…" : "永久删除素材"}
                    </button>
                  ) : null}
                  {onAdminPurgeUploader ? (
                    <button
                      type="button"
                      disabled={adminUploaderPurging || adminDeleting || adminQuotaResetting}
                      onClick={() => onAdminPurgeUploader(resource)}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-rose-700 transition hover:bg-rose-50 disabled:opacity-60 dark:text-rose-300 dark:hover:bg-rose-500/10"
                    >
                      <span className="w-4 text-center" aria-hidden="true">⊘</span>
                      {adminUploaderPurging ? "清理并禁用中…" : "删除该上传人全部素材并禁用上传"}
                    </button>
                  ) : null}
                </div>
              </details>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export function CompactResourceCardSkeleton() {
  return (
    <div className="resource-card-apple flex aspect-[1.618] animate-pulse flex-col overflow-hidden rounded-[22px] border border-black/[.055] bg-white shadow-sm dark:border-white/10 dark:bg-slate-900" aria-hidden="true">
      <div className="resource-skeleton-shimmer min-h-0 flex-1 bg-slate-200/80 dark:bg-slate-800" />
      <div className="shrink-0 space-y-2 px-3 py-2.5">
        <div className="h-3 w-3/5 rounded-full bg-slate-200 dark:bg-slate-700" />
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 rounded-full bg-slate-200 dark:bg-slate-700" />
          <div className="h-2.5 w-1/3 rounded-full bg-slate-200 dark:bg-slate-700" />
          <div className="ml-auto h-2.5 w-1/4 rounded-full bg-slate-200 dark:bg-slate-700" />
        </div>
      </div>
    </div>
  );
}
