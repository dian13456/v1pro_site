import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { SitePageShell } from "../components/SitePageShell";
import { SitePageToolbar } from "../components/SitePageToolbar";
import { useThemeMode } from "../hooks/useThemeMode";
import { ImageReviewPendingError } from "../services/aiImageService";
import { hasValidLocalAuth } from "../services/authService";
import {
  MAX_GIF_UPLOAD_BYTES,
  shareGifToCatalog,
} from "../services/gifUploadService";

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

export default function GifUploadPage() {
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
    if (!file.name.toLowerCase().endsWith(".gif")) {
      setErrorMessage("请选择 .gif 文件");
      return;
    }
    if (file.size > MAX_GIF_UPLOAD_BYTES) {
      setErrorMessage(`GIF 不能超过 ${Math.floor(MAX_GIF_UPLOAD_BYTES / (1024 * 1024))}MB`);
      return;
    }
    setSelectedFile(file);
    const baseName = file.name.replace(/\.gif$/i, "");
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
      const result = await shareGifToCatalog(selectedFile, {
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
      setErrorMessage((err as Error)?.message || "GIF 分享失败");
    } finally {
      setUploading(false);
      setProgress("");
    }
  };

  const maxMb = Math.floor(MAX_GIF_UPLOAD_BYTES / (1024 * 1024));

  return (
    <SitePageShell theme={theme}>
      <SiteHeader theme={theme} onToggleTheme={toggleTheme} />
      <SitePageToolbar
        title="上传 GIF"
        subtitle="分享动图到素材库"
        backTo="/"
        backLabel="返回素材中心"
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
        <div className="rounded-2xl border border-white/20 bg-white/70 p-6 shadow-lg backdrop-blur dark:border-white/10 dark:bg-slate-900/60">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">上传 GIF 素材</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            支持 {maxMb}MB 以内的 .gif 文件，上传后写入素材库。他人点赞可为你的 SN 增加积分。
            {shareRemaining != null ? (
              <span className="ml-1">当前剩余分享次数：{shareRemaining}</span>
            ) : null}
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".gif,image/gif"
              className="hidden"
              onChange={handlePick}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:opacity-60"
            >
              选择 GIF 文件
            </button>
            {selectedFile ? (
              <button
                type="button"
                disabled={uploading}
                onClick={() => void handleShare()}
                className="rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-60"
              >
                {uploading ? progress || "上传中..." : "分享到素材库"}
              </button>
            ) : null}
          </div>

          {selectedFile ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  标题
                </label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={80}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  描述
                </label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div className="sm:col-span-2 text-xs text-slate-500 dark:text-slate-400">
                已选：{selectedFile.name}（{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB）
              </div>
            </div>
          ) : null}

          {previewUrl ? (
            <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-950">
              <img src={previewUrl} alt="GIF 预览" className="mx-auto max-h-72 object-contain" />
            </div>
          ) : null}

          {notice ? (
            <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
              {notice}
            </p>
          ) : null}
          {errorMessage ? (
            <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-200">
              {errorMessage}
            </p>
          ) : null}

          <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">
            内容需符合站点使用规范。封面会经内容安全检测，可疑内容将进入人工复核。也可在{" "}
            <Link to="/ai-image" className="text-violet-600 underline dark:text-violet-300">
              AI 生图页
            </Link>{" "}
            上传静态图片。
          </p>
        </div>
      </main>

      <SiteFooter />
    </SitePageShell>
  );
}
