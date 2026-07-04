import { Link } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DevicePreviewFrame } from "./DevicePreviewFrame";
import { SiteButton, SiteEmptyBlock, SiteLabel, SiteLoadingBlock, SitePanel } from "./SiteUi";
import { createImageUrl } from "../services/imageService";
import {
  deleteMyUpload,
  fetchMyUploads,
  formatUploadTimestamp,
  materialTypeLabel,
  uploadStatusLabel,
  type ProfileUploadReview,
} from "../services/profileUploadService";
import type { ResourceItem } from "../types/resource";

type UploadListItem =
  | { kind: "published"; resource: ResourceItem }
  | { kind: "review"; review: ProfileUploadReview };

function UploadPreview({
  item,
}: {
  item: UploadListItem;
}) {
  const [previewUrl, setPreviewUrl] = useState("");
  const materialType = item.kind === "published" ? item.resource.materialType : item.review.materialType;
  const previewFitClass = materialType === "video" || materialType === "image" ? "object-cover" : "object-contain";

  useEffect(() => {
    let cancelled = false;
    const loadPreview = async () => {
      try {
        if (item.kind === "review") {
          if (!cancelled) {
            setPreviewUrl(item.review.previewUrl || "");
          }
          return;
        }
        const signed = await createImageUrl(item.resource.id, item.resource.image || item.resource.download);
        if (!cancelled) {
          setPreviewUrl(signed.url || "");
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
  }, [item]);

  return (
    <DevicePreviewFrame>
      {previewUrl ? (
        <img src={previewUrl} alt="" className={`h-full w-full ${previewFitClass}`} loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">暂无预览</div>
      )}
    </DevicePreviewFrame>
  );
}

function UploadCard({
  item,
  deleting,
  onDelete,
}: {
  item: UploadListItem;
  deleting: boolean;
  onDelete: (item: UploadListItem) => void;
}) {
  const title = item.kind === "published" ? item.resource.title : item.review.title;
  const description =
    item.kind === "published" ? item.resource.description : item.review.description || "";
  const materialType = item.kind === "published" ? item.resource.materialType : item.review.materialType;
  const timestamp =
    item.kind === "published" ? item.resource.updatedAt : item.review.createdAt;
  const status =
    item.kind === "review"
      ? item.review.status
      : ("published" as const);

  const statusClass =
    status === "pending"
      ? "border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
      : status === "rejected"
        ? "border-rose-200/80 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"
        : "border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200";

  const statusText =
    status === "published" ? "已发布" : uploadStatusLabel(status);

  const deleteLabel =
    item.kind === "published"
      ? `确定从素材库删除「${title}」？删除后他人将无法再访问。`
      : `确定删除上传记录「${title}」？`;

  return (
    <article className="overflow-hidden rounded-2xl border border-white/25 bg-white/55 dark:border-white/10 dark:bg-slate-900/45">
      <div className="p-3">
        <UploadPreview item={item} />
      </div>
      <div className="space-y-2 border-t border-white/20 px-4 py-3 dark:border-white/10">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-100">{title}</h3>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClass}`}>
            {statusText}
          </span>
        </div>
        {description ? (
          <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{description}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
          <span>{materialTypeLabel(materialType)}</span>
          <span>{formatUploadTimestamp(timestamp)}</span>
          {item.kind === "review" && item.review.reviewNote ? (
            <span className="text-rose-600 dark:text-rose-300">原因：{item.review.reviewNote}</span>
          ) : null}
        </div>
        <div className="pt-1">
          <SiteButton
            type="button"
            variant="secondary"
            disabled={deleting}
            className="w-full border-rose-200/80 text-rose-700 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-200 dark:hover:bg-rose-500/10"
            onClick={() => {
              if (!window.confirm(deleteLabel)) return;
              onDelete(item);
            }}
          >
            {deleting ? "删除中…" : "删除素材"}
          </SiteButton>
        </div>
      </div>
    </article>
  );
}

export function MyUploadsPanel() {
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [published, setPublished] = useState<ResourceItem[]>([]);
  const [reviews, setReviews] = useState<ProfileUploadReview[]>([]);
  const [deletingKey, setDeletingKey] = useState("");

  const loadUploads = useCallback(() => {
    setLoading(true);
    setErrorMessage("");
    return fetchMyUploads()
      .then((state) => {
        setPublished(state.published);
        setReviews(state.reviews);
      })
      .catch((err: unknown) => {
        setErrorMessage((err as Error)?.message || "加载上传记录失败");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    void loadUploads();
  }, [loadUploads]);

  const items = useMemo<UploadListItem[]>(() => {
    const merged: UploadListItem[] = [
      ...reviews.map((review) => ({ kind: "review" as const, review })),
      ...published.map((resource) => ({ kind: "published" as const, resource })),
    ];
    merged.sort((left, right) => {
      const leftTime = new Date(
        left.kind === "published" ? left.resource.updatedAt : left.review.createdAt,
      ).getTime();
      const rightTime = new Date(
        right.kind === "published" ? right.resource.updatedAt : right.review.createdAt,
      ).getTime();
      return rightTime - leftTime;
    });
    return merged;
  }, [published, reviews]);

  const handleDelete = async (item: UploadListItem) => {
    const key = item.kind === "published" ? `pub-${item.resource.id}` : `rev-${item.review.reviewId}`;
    setDeletingKey(key);
    setErrorMessage("");
    setNoticeMessage("");
    try {
      if (item.kind === "published") {
        await deleteMyUpload({ kind: "published", resourceId: item.resource.id });
        setPublished((current) => current.filter((entry) => entry.id !== item.resource.id));
      } else {
        await deleteMyUpload({ kind: "review", reviewId: item.review.reviewId });
        setReviews((current) => current.filter((entry) => entry.reviewId !== item.review.reviewId));
      }
      setNoticeMessage("素材已删除");
      window.setTimeout(() => setNoticeMessage(""), 3000);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "删除失败");
    } finally {
      setDeletingKey("");
    }
  };

  return (
    <SitePanel className="mt-5 space-y-4">
      <div className="space-y-1">
        <SiteLabel>本设备上传的素材</SiteLabel>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          展示当前 SN 码分享至素材库的内容，含已发布与审核中的记录；可自行删除本设备上传的素材。
        </p>
      </div>

      {loading ? <SiteLoadingBlock>正在加载上传记录...</SiteLoadingBlock> : null}
      {noticeMessage ? <p className="text-sm text-emerald-600 dark:text-emerald-300">{noticeMessage}</p> : null}
      {errorMessage ? <p className="text-sm text-rose-600 dark:text-rose-300">{errorMessage}</p> : null}

      {!loading && items.length === 0 ? (
        <SiteEmptyBlock>
          还没有上传记录。前往
          <Link to="/share" className="mx-1 text-violet-600 underline-offset-2 hover:underline dark:text-violet-300">
            分享素材
          </Link>
          上传图片、GIF 或视频。
        </SiteEmptyBlock>
      ) : null}

      {!loading && items.length > 0 ? (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {items.map((item) => {
            const key = item.kind === "published" ? `pub-${item.resource.id}` : `rev-${item.review.reviewId}`;
            return (
              <UploadCard
                key={key}
                item={item}
                deleting={deletingKey === key}
                onDelete={(target) => void handleDelete(target)}
              />
            );
          })}
        </section>
      ) : null}
    </SitePanel>
  );
}
