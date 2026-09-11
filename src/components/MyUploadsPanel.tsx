import { useI18n, translate as t, formatDate } from "../i18n";
import { Link } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DevicePreviewFrame } from "./DevicePreviewFrame";
import {
  SiteAlert,
  SiteButton,
  SiteCard,
  SiteEmptyBlock,
  SiteLabel,
  SiteLoadingBlock,
  SitePanel,
} from "./SiteUi";
import { createImageUrl } from "../services/imageService";
import {
  deleteMyUpload,
  fetchMyUploads,
  materialTypeLabel,
  renameMyUpload,
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
  useI18n();
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
        <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">{t("暂无预览")}</div>
      )}
    </DevicePreviewFrame>
  );
}

function UploadCard({
  item,
  deleting,
  saving,
  onRename,
  onDelete,
}: {
  item: UploadListItem;
  deleting: boolean;
  saving: boolean;
  onRename: (item: UploadListItem, title: string) => void;
  onDelete: (item: UploadListItem) => void;
}) {
  useI18n();
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
    status === "published" ? t("已发布") : uploadStatusLabel(status);

  const deleteLabel =
    item.kind === "published"
      ? t("确定从素材库删除「{v0}」？删除后他人将无法再访问。", undefined, {v0: title})
      : t("确定删除上传记录「{v0}」？", undefined, {v0: title});

  return (
    <SiteCard className="overflow-hidden p-0">
      <div className="p-3">
        <UploadPreview item={item} />
      </div>
      <div className="space-y-2 border-t border-white/20 px-4 py-3 dark:border-white/10">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="line-clamp-2 text-sm font-medium text-slate-900 dark:text-slate-100">{title}</h3>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClass}`}>
            {t(statusText)}
          </span>
        </div>
        {description ? (
          <p className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{description}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
          <span>{t(materialTypeLabel(materialType))}</span>
          <span>{formatDate(timestamp)}</span>
          {item.kind === "review" && item.review.reviewNote ? (
            <span className="text-rose-600 dark:text-rose-300">{t("原因：")}{item.review.reviewNote}</span>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <SiteButton
            type="button"
            variant="secondary"
            disabled={deleting || saving}
            onClick={() => {
              const nextTitle = window.prompt(t("请输入新的素材标题（最多 80 个字符）"), title);
              if (nextTitle === null || nextTitle.trim() === title.trim()) return;
              onRename(item, nextTitle);
            }}
          >
            {saving ? t("保存中…") : t("修改标题")}
          </SiteButton>
          <SiteButton
            type="button"
            variant="secondary"
            disabled={deleting || saving}
            className="border-rose-200/80 text-rose-700 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-200 dark:hover:bg-rose-500/10"
            onClick={() => {
              if (!window.confirm(deleteLabel)) return;
              onDelete(item);
            }}
          >
            {deleting ? t("删除中…") : t("删除素材")}
          </SiteButton>
        </div>
      </div>
    </SiteCard>
  );
}

export function MyUploadsPanel() {
  useI18n();
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [noticeMessage, setNoticeMessage] = useState("");
  const [published, setPublished] = useState<ResourceItem[]>([]);
  const [reviews, setReviews] = useState<ProfileUploadReview[]>([]);
  const [deletingKey, setDeletingKey] = useState("");
  const [savingKey, setSavingKey] = useState("");

  const loadUploads = useCallback(() => {
    setLoading(true);
    setErrorMessage("");
    return fetchMyUploads()
      .then((state) => {
        setPublished(state.published);
        setReviews(state.reviews);
      })
      .catch((err: unknown) => {
        setErrorMessage((err as Error)?.message || t("加载上传记录失败"));
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
      let result;
      if (item.kind === "published") {
        result = await deleteMyUpload({ kind: "published", resourceId: item.resource.id });
      } else {
        result = await deleteMyUpload({ kind: "review", reviewId: item.review.reviewId });
      }
      await loadUploads();
      if (!result.cleanupComplete) {
        const details = result.cleanupWarnings.join("、");
        setErrorMessage(details ? t("素材已删除，但{v0}", undefined, {v0: details}) : t("素材已删除，部分关联数据清理失败"));
      } else {
        setNoticeMessage(result.message);
        window.setTimeout(() => setNoticeMessage(""), 3000);
      }
    } catch (err) {
      setErrorMessage((err as Error)?.message || t("删除失败"));
    } finally {
      setDeletingKey("");
    }
  };

  const handleRename = async (item: UploadListItem, nextTitle: string) => {
    const key = item.kind === "published" ? `pub-${item.resource.id}` : `rev-${item.review.reviewId}`;
    setSavingKey(key);
    setErrorMessage("");
    setNoticeMessage("");
    try {
      await renameMyUpload({
        kind: item.kind,
        title: nextTitle,
        resourceId: item.kind === "published" ? item.resource.id : undefined,
        reviewId: item.kind === "review" ? item.review.reviewId : undefined,
      });
      setNoticeMessage(t("标题已修改"));
      window.setTimeout(() => setNoticeMessage(""), 3000);
      await loadUploads();
    } catch (err) {
      setErrorMessage((err as Error)?.message || t("修改标题失败"));
    } finally {
      setSavingKey("");
    }
  };

  return (
    <SitePanel className="mt-0 space-y-4 !rounded-[18px] !border-[#e6e9f2] !bg-white !p-6 !shadow-[0_10px_30px_rgba(43,50,69,.06)]">
      <div className="space-y-1">
        <SiteLabel>{t("本设备上传的素材")}</SiteLabel>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {" "}{t("展示当前 SN 码分享至素材库的内容，含已发布与审核中的记录；可自行修改标题或删除素材。")}{" "}</p>
      </div>

      {loading ? <SiteLoadingBlock>{t("正在加载上传记录...")}</SiteLoadingBlock> : null}
      {noticeMessage ? <SiteAlert variant="success">{t(noticeMessage)}</SiteAlert> : null}
      {errorMessage ? <SiteAlert variant="error">{t(errorMessage)}</SiteAlert> : null}

      {!loading && items.length === 0 ? (
        <SiteEmptyBlock>
          {" "}{t("还没有上传记录。前往")}{" "}<Link to="/share" className="mx-1 text-violet-600 underline-offset-2 hover:underline dark:text-violet-300">
            {" "}{t("分享素材")}{" "}</Link>
          {" "}{t("上传图片、GIF 或视频。")}{" "}</SiteEmptyBlock>
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
                saving={savingKey === key}
                onRename={(target, nextTitle) => void handleRename(target, nextTitle)}
                onDelete={(target) => void handleDelete(target)}
              />
            );
          })}
        </section>
      ) : null}
    </SitePanel>
  );
}
