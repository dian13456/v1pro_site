import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SitePageLayout } from "../components/SitePageLayout";
import {
  SiteAlert,
  SiteButton,
  SiteInput,
  SiteLabel,
  SiteMediaPreview,
  SitePanel,
  SiteSectionTitle,
  SiteSelect,
  SITE_CONTENT_NARROW,
} from "../components/SiteUi";
import { useThemeMode } from "../hooks/useThemeMode";
import { useColumnTags } from "../hooks/useColumnTags";
import { buildShareColumnTagOptions } from "../data/columnTags";
import {
  ImageReviewPendingError,
  readLocalImageFile,
  shareAiImageToCatalog,
} from "../services/aiImageService";
import { getAuthState, hasValidLocalAuth } from "../services/authService";
import { formatClientError } from "../services/httpClient";
import {
  MAX_GIF_UPLOAD_BYTES,
  shareGifToCatalog,
} from "../services/gifUploadService";
import {
  MAX_VIDEO_UPLOAD_BYTES,
  shareVideoToCatalog,
} from "../services/videoUploadService";
import {
  createV1ProWebTransferClient,
  listAuthorizedV1ProDevices,
} from "../services/v1proWebTransferClient";

type ShareMediaKind = "image" | "gif" | "video";

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

function detectShareKind(file: File): ShareMediaKind | null {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".gif")) {
    return "gif";
  }
  if (/\.(mp4|webm|mov|m4v)$/.test(lower)) {
    return "video";
  }
  if (file.type.startsWith("image/")) {
    return "image";
  }
  return null;
}

function validateFile(file: File, kind: ShareMediaKind): string | null {
  switch (kind) {
    case "gif":
      if (file.size > MAX_GIF_UPLOAD_BYTES) {
        return `GIF 不能超过 ${Math.floor(MAX_GIF_UPLOAD_BYTES / (1024 * 1024))}MB`;
      }
      break;
    case "video":
      if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
        return `视频不能超过 ${Math.floor(MAX_VIDEO_UPLOAD_BYTES / (1024 * 1024))}MB`;
      }
      break;
    case "image":
      if (file.size > 8 * 1024 * 1024) {
        return "图片不能超过 8MB";
      }
      if (file.size < 16) {
        return "图片文件过小";
      }
      break;
  }
  if (file.size <= 0) {
    return "文件无效";
  }
  return null;
}

function kindLabel(kind: ShareMediaKind): string {
  switch (kind) {
    case "gif":
      return "GIF";
    case "video":
      return "视频";
    default:
      return "图片";
  }
}

export default function SharePage() {
  const navigate = useNavigate();
  const { theme, setTheme } = useThemeMode();
  const { columnTagOptions } = useColumnTags();
  const shareColumnOptions = useMemo(
    () => buildShareColumnTagOptions(columnTagOptions),
    [columnTagOptions]
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [mediaKind, setMediaKind] = useState<ShareMediaKind | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [columnTag, setColumnTag] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [shareRemaining, setShareRemaining] = useState<number | null>(null);
  const [shareUnlimited, setShareUnlimited] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [targetFrameOptions, setTargetFrameOptions] = useState<number[]>([77, 154, 308]);
  const [videoFps, setVideoFps] = useState(25);
  const [fitMode, setFitMode] = useState<"fill" | "contain">("fill");
  const [rotationDeg, setRotationDeg] = useState<0 | 90 | 180 | 270>(0);

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

    const kind = detectShareKind(file);
    if (!kind) {
      setErrorMessage("请选择图片、GIF 或视频文件（.jpg/.png/.webp、.gif、.mp4/.webm/.mov/.m4v）");
      return;
    }
    const validationError = validateFile(file, kind);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setSelectedFile(file);
    setMediaKind(kind);
    const baseName = file.name.replace(/\.[^.]+$/i, "");
    setTitle(baseName);
    setDescription(baseName);
    setColumnTag("");
  };

  const handleShare = async () => {
    if (!selectedFile || !mediaKind || uploading) return;
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }

    setUploading(true);
    setErrorMessage("");
    setNotice("");
    setProgress("准备上传...");

    try {
      let resourceId: number | undefined;
      let remaining: number | undefined;
      let unlimited = false;

      switch (mediaKind) {
        case "gif": {
          const result = await shareGifToCatalog(selectedFile, {
            title,
            description,
            onProgress: setProgress,
          });
          resourceId = result.resourceId;
          remaining = result.shareRemaining;
          unlimited = Boolean(result.shareUnlimited);
          break;
        }
        case "video": {
          const result = await shareVideoToCatalog(selectedFile, {
            title,
            description,
            columnTag,
            onProgress: setProgress,
          });
          resourceId = result.resourceId;
          remaining = result.shareRemaining;
          unlimited = Boolean(result.shareUnlimited);
          break;
        }
        case "image": {
          setProgress("处理图片...");
          const uploaded = await readLocalImageFile(selectedFile);
          setProgress("提交分享...");
          const result = await shareAiImageToCatalog(
            uploaded,
            description.trim() || title.trim() || uploaded.fileName || "用户上传图片"
          );
          resourceId = result.resourceId;
          remaining = result.shareRemaining;
          unlimited = Boolean(result.shareUnlimited);
          break;
        }
      }

      setNotice(`分享成功！素材编号 ${resourceId ?? ""}，已发布到素材库。`);
      setShareUnlimited(unlimited);
      if (unlimited) {
        setShareRemaining(null);
      } else if (typeof remaining === "number") {
        setShareRemaining(remaining);
      }
      setSelectedFile(null);
      setMediaKind(null);
      setTitle("");
      setDescription("");
      setColumnTag("");
    } catch (err) {
      if (err instanceof ImageReviewPendingError) {
        setNotice(formatReviewPendingMessage(err));
        setSelectedFile(null);
        setMediaKind(null);
        return;
      }
      setErrorMessage(formatClientError(err, `${kindLabel(mediaKind)} 分享失败`));
    } finally {
      setUploading(false);
      setProgress("");
    }
  };

  const handleDeviceTransfer = async () => {
    if (!selectedFile || !mediaKind || transferring) return;
    const serial = getAuthState()?.serial?.trim();
    if (!serial) {
      navigate("/auth", { replace: true });
      return;
    }

    setTransferring(true);
    setErrorMessage("");
    setNotice("");
    setProgress("正在查找认证设备...");
    let client: Awaited<ReturnType<typeof createV1ProWebTransferClient>> | null = null;
    try {
      client = await createV1ProWebTransferClient();
      const devices = await listAuthorizedV1ProDevices();
      const device = devices.find((item) => item.serialNumber?.trim() === serial);
      if (!device) {
        throw new Error(`未找到当前认证的 V1PRO（SN ${serial}），请重新认证`);
      }

      setProgress(`正在连接 SN ${serial}...`);
      await client.connect({ device });
      const detectedFrames = client.deviceCapacity?.maxFrames;
      if (!detectedFrames) {
        throw new Error("无法读取设备容量，请重新连接后重试");
      }
      if (!targetFrameOptions.includes(detectedFrames)) {
        throw new Error(
          `当前设备为 ${detectedFrames} 帧，未在目标设备容量中勾选该型号`,
        );
      }
      const result = await client.transferFile(selectedFile, {
        fileName: selectedFile.name,
        mediaType: mediaKind,
        maxFrames: detectedFrames,
        maxVideoFps: videoFps,
        minVideoFps: videoFps,
        fitMode,
        rotationDeg,
        pingFirst: false,
        onProgress: (info) => {
          if (info.note && info.sent === 0) {
            setProgress(info.note);
            return;
          }
          const percent = Math.round(info.ratio * 100);
          setProgress(info.phase === "encode" ? `正在编码 ${percent}%` : `正在下传 ${percent}%`);
        },
      });
      setNotice(`下传完成：SN ${serial} · ${result.frameCount} 帧`);
    } catch (err) {
      setErrorMessage(formatClientError(err, "设备下传失败"));
    } finally {
      await client?.disconnect();
      setTransferring(false);
      setProgress("");
    }
  };

  const gifMb = Math.floor(MAX_GIF_UPLOAD_BYTES / (1024 * 1024));
  const videoMb = Math.floor(MAX_VIDEO_UPLOAD_BYTES / (1024 * 1024));

  return (
    <SitePageLayout
      subtitle="分享素材到素材库"
      theme={theme}
      onSetTheme={setTheme}
      contentClassName={SITE_CONTENT_NARROW}
    >
      <SitePanel>
        <SiteSectionTitle
          title="分享素材"
          description={`支持静态图片（8MB）、GIF（${gifMb}MB）、视频（${videoMb}MB，建议 H.264 8-bit MP4，兼容 Edge/Chrome）。他人点赞可为你的 SN 增加 1 积分，有效下载可再增加 0.5 积分。${
            shareUnlimited
              ? " 当前分享次数：无限制"
              : shareRemaining != null
                ? ` 当前剩余分享次数：${shareRemaining}`
                : ""
          }`}
        />

        <div className="flex flex-wrap gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".gif,.mp4,.webm,.mov,.m4v,image/png,image/jpeg,image/jpg,image/webp,image/bmp"
            className="hidden"
            onChange={handlePick}
          />
          <SiteButton type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            选择文件
          </SiteButton>
          {selectedFile ? (
            <SiteButton
              type="button"
              variant="success"
              disabled={uploading}
              onClick={() => void handleShare()}
            >
              {uploading ? progress || "分享中..." : "分享到素材库"}
            </SiteButton>
          ) : null}
          {selectedFile && mediaKind ? (
            <SiteButton
              type="button"
              variant="secondary"
              disabled={uploading || transferring || targetFrameOptions.length === 0}
              onClick={() => void handleDeviceTransfer()}
            >
              {transferring ? progress || "下传中..." : "下传到当前设备"}
            </SiteButton>
          ) : null}
        </div>

        {selectedFile && mediaKind ? (
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
            {mediaKind === "video" ? (
              <div className="space-y-2">
                <SiteLabel>专栏</SiteLabel>
                <SiteSelect value={columnTag} onChange={(event) => setColumnTag(event.target.value)}>
                  {shareColumnOptions.map((item) => (
                    <option key={item.value || "none"} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </SiteSelect>
              </div>
            ) : null}
            <div className="space-y-2 sm:col-span-2">
              <SiteLabel>目标设备容量</SiteLabel>
              <div className="flex flex-wrap gap-3">
                {[77, 154, 308].map((frames) => (
                  <label
                    key={frames}
                    className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={targetFrameOptions.includes(frames)}
                      onChange={(event) => {
                        setTargetFrameOptions((current) =>
                          event.target.checked
                            ? Array.from(new Set([...current, frames])).sort((a, b) => a - b)
                            : current.filter((item) => item !== frames),
                        );
                      }}
                    />
                    {frames} 帧设备
                  </label>
                ))}
              </div>
              {targetFrameOptions.length === 0 ? (
                <p className="text-xs text-rose-600 dark:text-rose-300">请至少选择一种目标设备容量</p>
              ) : null}
            </div>
            {mediaKind === "video" ? (
              <div className="space-y-2">
                <SiteLabel>视频帧率</SiteLabel>
                <SiteSelect value={videoFps} onChange={(event) => setVideoFps(Number(event.target.value))}>
                  <option value={10}>10 fps</option>
                  <option value={15}>15 fps</option>
                  <option value={20}>20 fps</option>
                  <option value={25}>25 fps</option>
                </SiteSelect>
              </div>
            ) : null}
            <div className="space-y-2">
              <SiteLabel>画面显示</SiteLabel>
              <SiteSelect value={fitMode} onChange={(event) => setFitMode(event.target.value as "fill" | "contain")}>
                <option value="fill">铺满全屏</option>
                <option value="contain">等比例完整显示</option>
              </SiteSelect>
            </div>
            <div className="space-y-2">
              <SiteLabel>画面方向</SiteLabel>
              <SiteSelect
                value={rotationDeg}
                onChange={(event) => setRotationDeg(Number(event.target.value) as 0 | 90 | 180 | 270)}
              >
                <option value={0}>0° 原方向</option>
                <option value={90}>90° 顺时针</option>
                <option value={180}>180°</option>
                <option value={270}>270° 顺时针</option>
              </SiteSelect>
            </div>
            <div className="sm:col-span-2 text-xs text-slate-500 dark:text-slate-400">
              已选：{kindLabel(mediaKind)} · {selectedFile.name}（
              {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB）
            </div>
          </div>
        ) : null}

        {previewUrl && mediaKind ? (
          <SiteMediaPreview className="mt-6">
            {mediaKind === "video" ? (
              <video
                src={previewUrl}
                controls
                playsInline
                className="mx-auto max-h-72 w-full object-contain"
              />
            ) : (
              <img
                src={previewUrl}
                alt={`${kindLabel(mediaKind)} 预览`}
                className="mx-auto max-h-72 object-contain"
              />
            )}
          </SiteMediaPreview>
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
          内容需符合站点使用规范，上传后将经腾讯云内容安全审核。AI 生成的图片可在{" "}
          <Link to="/ai-image" className="text-violet-600 underline dark:text-violet-300">
            AI 生图页
          </Link>{" "}
          生成并分享。
        </p>
      </SitePanel>
    </SitePageLayout>
  );
}
