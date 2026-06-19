import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SitePageLayout } from "../components/SitePageLayout";
import {
  SiteAlert,
  SiteButton,
  SiteInput,
  SiteLabel,
  SitePanel,
  SiteSectionTitle,
} from "../components/SiteUi";
import { useThemeMode } from "../hooks/useThemeMode";
import { ImageReviewPendingError } from "../services/aiImageService";
import { hasValidLocalAuth } from "../services/authService";
import { formatClientError } from "../services/httpClient";
import {
  MAX_VIDEO_UPLOAD_BYTES,
  shareVideoToCatalog,
} from "../services/videoUploadService";

function formatReviewPendingMessage(err: ImageReviewPendingError): string {
  const parts = [err.message];
  if (err.reviewId) {
    parts.push(`复核编号 ${err.reviewId}`);
  }
  if (err.label) {
    parts.push(`标签 ${err.label}`);
  }
  return parts.join(" · ");
}

export default function VideoUploadPage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useThemeMode();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [shareRemaining, setShareRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  const handlePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    setErrorMessage("");
    setNotice("");
    if (!file) return;
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    const lower = file.name.toLowerCase();
    if (!/\.(mp4|webm|mov|m4v)$/.test(lower)) {
      setErrorMessage("请选择 .mp4、.webm、.mov 或 .m4v 文件");
      return;
    }
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      setErrorMessage(`视频不能超过 ${Math.floor(MAX_VIDEO_UPLOAD_BYTES / (1024 * 1024))}MB`);
      return;
    }
    setSelectedFile(file);
    const baseName = file.name.replace(/\.[^.]+$/i, "");
    setTitle(baseName);
    setDescription(baseName);
  };

  const handleShare = async () => {
    if (!selectedFile || uploading) return;
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }

    setUploading(true);
    setErrorMessage("");
    setNotice("");
    setProgress("准备上传...");
    try {
      const result = await shareVideoToCatalog(selectedFile, {
        title,
        description,
        onProgress: setProgress,
      });
      setNotice(`分享成功！素材编号 ${result.resourceId}，已发布到素材库。`);
      if (typeof result.shareRemaining === "number") {
        setShareRemaining(result.shareRemaining);
      }
      setSelectedFile(null);
      setTitle("");
      setDescription("");
    } catch (err) {
      if (err instanceof ImageReviewPendingError) {
        setNotice(formatReviewPendingMessage(err));
        setSelectedFile(null);
        return;
      }
      setErrorMessage(formatClientError(err, "视频分享失败"));
    } finally {
      setUploading(false);
      setProgress("");
    }
  };

  const maxMb = Math.floor(MAX_VIDEO_UPLOAD_BYTES / (1024 * 1024));

  return (
    <SitePageLayout
      subtitle="上传视频 · 分享短片到素材库"
      theme={theme}
      onToggleTheme={toggleTheme}
      contentClassName="mx-auto w-full max-w-3xl space-y-5"
    >
      <SitePanel>
        <SiteSectionTitle
          title="上传视频素材"
          description={`支持 ${maxMb}MB 以内的 .mp4、.webm、.mov、.m4v 文件。他人点赞可为你的 SN 增加积分。${
            shareRemaining != null ? ` 当前剩余分享次数：${shareRemaining}` : ""
          }`}
        />

        <div className="flex flex-wrap gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,.webm,.mov,.m4v,video/mp4,video/webm,video/quicktime"
            className="hidden"
            onChange={handlePick}
          />
          <SiteButton type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            选择视频文件
          </SiteButton>
          {selectedFile ? (
            <SiteButton
              type="button"
              variant="success"
              disabled={uploading}
              onClick={() => void handleShare()}
            >
              {uploading ? progress || "上传中..." : "分享到素材库"}
            </SiteButton>
          ) : null}
        </div>

        {selectedFile ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <SiteLabel>标题</SiteLabel>
              <SiteInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
            </div>
            <div className="space-y-2">
              <SiteLabel>描述</SiteLabel>
              <SiteInput
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
              />
            </div>
            <div className="sm:col-span-2 text-xs text-slate-500 dark:text-slate-400">
              已选：{selectedFile.name}（{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB）
            </div>
          </div>
        ) : null}

        {previewUrl ? (
          <div className="mt-6 overflow-hidden rounded-2xl border border-white/30 bg-white/70 dark:border-white/10 dark:bg-slate-950/50">
            <video
              src={previewUrl}
              controls
              playsInline
              className="mx-auto max-h-72 w-full object-contain"
            />
          </div>
        ) : null}

        {notice ? (
          <SiteAlert variant="success" className="mt-4">
            {notice}
          </SiteAlert>
        ) : null}
        {errorMessage ? (
          <SiteAlert variant="error" className="mt-4">
            {errorMessage}
          </SiteAlert>
        ) : null}

        <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">
          内容需符合站点使用规范。封面与视频会经腾讯云内容安全抽帧检测，可疑内容将进入人工复核。也可在{" "}
          <Link to="/upload-gif" className="text-violet-600 underline dark:text-violet-300">
            GIF 上传页
          </Link>{" "}
          分享动图。
        </p>
      </SitePanel>
    </SitePageLayout>
  );
}
