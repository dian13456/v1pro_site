import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ResourceLibraryHeader } from "../components/ResourceLibraryHeader";
import { SiteFooter } from "../components/SiteFooter";
import { SiteAlert } from "../components/SiteUi";
import { useColumnTags } from "../hooks/useColumnTags";
import { buildShareColumnTagOptions } from "../data/columnTags";
import {
  ImageReviewPendingError,
  readLocalImageFile,
  shareAiImageToCatalog,
} from "../services/aiImageService";
import {
  getAuthState,
  hasValidLocalAuth,
  matchesAuthenticatedUsbDevice,
} from "../services/authService";
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
import {
  convertBrowserRasterWithFfmpeg,
  convertBrowserVideoWithFfmpeg,
  MAX_BROWSER_DIRECT_TRANSFER_VIDEO_BYTES,
  planBrowserFfmpegVideo,
  probeBrowserVideoDuration,
} from "../services/browserFfmpegVideoService";
import { scheduleFfmpegAssetPreload } from "../services/ffmpegAssetCache";
import { validateShareCoverFile } from "../services/shareCoverService";
import { defaultTransferFitMode } from "../utils/transferFitMode";

type ShareMediaKind = "image" | "gif" | "video";
type VideoColorProfile = "normal" | "vivid" | "professional";

const VIDEO_PREVIEW_FILTER: Record<VideoColorProfile, string> = {
  normal: "saturate(1.08) contrast(1.05) brightness(1.002)",
  vivid: "saturate(1.18) contrast(1.07) brightness(1.003)",
  professional: "saturate(1.04) contrast(1.05) brightness(1.002) sepia(.015)",
};

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
  const { columnTagOptions } = useColumnTags();
  const shareColumnOptions = useMemo(
    () => buildShareColumnTagOptions(columnTagOptions),
    [columnTagOptions]
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [mediaKind, setMediaKind] = useState<ShareMediaKind | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [customCoverFile, setCustomCoverFile] = useState<File | null>(null);
  const [customCoverPreviewUrl, setCustomCoverPreviewUrl] = useState("");
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
  const [videoColorProfile, setVideoColorProfile] = useState<VideoColorProfile>("normal");

  useEffect(() => {
    scheduleFfmpegAssetPreload();
  }, []);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  useEffect(() => {
    if (!customCoverFile) {
      setCustomCoverPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(customCoverFile);
    setCustomCoverPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [customCoverFile]);

  const selectFile = (file?: File) => {
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
    setCustomCoverFile(null);
    setFitMode(defaultTransferFitMode(kind));
    setTitle("");
    setDescription("");
    setColumnTag("");
  };

  const handlePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    selectFile(file);
  };

  const handleCoverPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const validationError = validateShareCoverFile(file);
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }
    setErrorMessage("");
    setCustomCoverFile(file);
  };

  const handleShare = async () => {
    if (!selectedFile || !mediaKind || uploading) return;
    if (!title.trim()) {
      setErrorMessage("请填写素材标题，标题不会再自动使用文件名称");
      return;
    }
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
            coverFile: customCoverFile || undefined,
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
            coverFile: customCoverFile || undefined,
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
            description.trim() || title.trim(),
            { title: title.trim(), description: description.trim() || title.trim() },
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
      setCustomCoverFile(null);
      setTitle("");
      setDescription("");
      setColumnTag("");
    } catch (err) {
      if (err instanceof ImageReviewPendingError) {
        setNotice(formatReviewPendingMessage(err));
        setSelectedFile(null);
        setMediaKind(null);
        setCustomCoverFile(null);
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
      const device = devices.find((item) => matchesAuthenticatedUsbDevice(item, serial));
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
      const transferProgress = (info: { phase: "encode" | "transfer"; ratio: number; sent: number; note?: string }) => {
        if (info.note && info.sent === 0) {
          setProgress(info.note);
          return;
        }
        const percent = Math.round(info.ratio * 100);
        setProgress(info.phase === "encode" ? `正在编码 ${percent}%` : `正在下传 ${percent}%`);
      };

      let result;
      if (mediaKind === "video") {
        if (selectedFile.size > MAX_BROWSER_DIRECT_TRANSFER_VIDEO_BYTES) {
          throw new Error("超过 50MB 的视频请先完成分享压缩，再从素材中心进行网页直传");
        }
        const duration = await probeBrowserVideoDuration(selectedFile);
        const plan = planBrowserFfmpegVideo(duration, detectedFrames, videoFps);
        let preparedTransferStarted = false;
        try {
          const converted = await convertBrowserVideoWithFfmpeg(selectedFile, {
            plan,
            fileName: selectedFile.name,
            fitMode,
            rotationDeg,
            colorProfile: videoColorProfile,
            onStatus: setProgress,
            onProgress: (ratio) => setProgress(`FFmpeg 本地转换 ${Math.round(ratio * 100)}%`),
          });
          setProgress("本地转换完成，正在准备设备存储…");
          preparedTransferStarted = true;
          await client.beginPreparedVideoTransfer(converted.totalBytes);
          result = await client.transferFile(converted.blob, {
            fileName: selectedFile.name,
            mediaType: "video",
            maxFrames: detectedFrames,
            maxVideoFps: videoFps,
            minVideoFps: videoFps,
            pingFirst: false,
            preparedTotalBytes: converted.totalBytes,
            prebuiltGfm1: {
              frameCount: converted.frameCount,
              fps: converted.fps,
              note: converted.note,
            },
            onProgress: transferProgress,
          });
        } catch (ffmpegError) {
          if (preparedTransferStarted) throw ffmpegError;
          setProgress("浏览器 FFmpeg 不可用，已切换兼容转换…");
          result = await client.transferFile(selectedFile, {
            fileName: selectedFile.name,
            mediaType: "video",
            maxFrames: detectedFrames,
            maxVideoFps: videoFps,
            minVideoFps: videoFps,
            maxVideoSpeed: 10,
            fitMode,
            rotationDeg,
            colorProfile: videoColorProfile,
            pingFirst: false,
            onProgress: transferProgress,
          });
        }
      } else {
        const converted = await convertBrowserRasterWithFfmpeg(selectedFile, {
          fileName: selectedFile.name,
          mediaType: mediaKind,
          maxFrames: detectedFrames,
          fitMode,
          rotationDeg,
          colorProfile: videoColorProfile,
          onStatus: setProgress,
          onProgress: (ratio) => setProgress(`FFmpeg 本地转换 ${Math.round(ratio * 100)}%`),
        });
        result = await client.transferFile(converted.blob, {
          fileName: selectedFile.name,
          mediaType: mediaKind,
          maxFrames: detectedFrames,
          pingFirst: false,
          prebuiltGfm1: {
            frameCount: converted.frameCount,
            note: converted.note,
          },
          onProgress: transferProgress,
        });
      }
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
  const fieldClass = "w-full rounded-[10px] border border-[#e6e9f2] bg-[#fafbfe] px-3 py-[9px] text-[13px] text-[#2b3245] outline-none transition focus:border-[#ff8a5c] disabled:cursor-not-allowed disabled:opacity-50";
  const fieldLabelClass = "mb-[7px] block text-[12.5px] font-semibold text-[#4a5270]";

  return (
    <div className="site-page-shell resource-library-shell min-h-screen text-[#2b3245]">
      <ResourceLibraryHeader
        keyword=""
        onSearch={(value) => navigate(value ? `/?q=${encodeURIComponent(value)}` : "/")}
      />
      <main className="mx-auto flex max-w-[1280px] justify-center px-4 py-6 sm:px-6">
        <section className="w-full max-w-[640px] overflow-hidden rounded-[18px] bg-white shadow-[0_24px_60px_rgba(43,50,69,.16)]">
          <header className="border-b border-[#e6e9f2] px-[26px] pb-3.5 pt-5">
            <h1 className="text-[17px] font-bold">分享素材</h1>
            <p className="mt-1.5 text-xs leading-[1.6] text-[#8a93a8]">
              支持静态图片（8MB）、GIF（{gifMb}MB）、视频源文件（{videoMb}MB）；超过约 20MB 的视频会在浏览器本地压缩后直传 COS。
              他人点赞可增加 <b className="text-[#2b3245]">1 积分</b>，有效下载再增加 <b className="text-[#2b3245]">0.5 积分</b>。
              {shareUnlimited ? " 当前分享次数：无限制。" : shareRemaining != null ? ` 当前剩余分享次数：${shareRemaining}。` : ""}
            </p>
          </header>

          <div className="px-[26px] py-5">
            <div className="mb-4">
              <label className={fieldLabelClass}><span className="text-[#ff8a5c]">*</span> 素材文件</label>
              <button
                type="button"
                disabled={uploading || transferring}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  selectFile(event.dataTransfer.files?.[0]);
                }}
                className="flex min-h-[118px] w-full cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-[1.5px] border-dashed border-[#cfd5ea] bg-[#fafbfe] px-5 py-4 text-center text-[12.5px] text-[#8a93a8] transition hover:border-[#ff8a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {previewUrl && mediaKind ? (
                  mediaKind === "video" ? (
                    <video src={previewUrl} muted playsInline className="mb-2 max-h-24 max-w-full rounded-lg object-contain" style={{ filter: VIDEO_PREVIEW_FILTER[videoColorProfile] }} />
                  ) : (
                    <img src={previewUrl} alt="素材预览" className="mb-2 max-h-24 max-w-full rounded-lg object-contain" style={{ filter: VIDEO_PREVIEW_FILTER[videoColorProfile] }} />
                  )
                ) : <span className="mb-1.5 text-[28px]">📁</span>}
                <span>点击选择文件，或拖拽到此处</span>
                <strong className="mt-1 max-w-full truncate text-[#2b3245]">
                  {selectedFile ? `${selectedFile.name}（${(selectedFile.size / 1048576).toFixed(1)} MB）` : "未选择"}
                </strong>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".gif,.mp4,.webm,.mov,.m4v,image/png,image/jpeg,image/jpg,image/webp,image/bmp"
                className="hidden"
                onChange={handlePick}
              />
            </div>

            <div className="mb-4">
              <label className={fieldLabelClass}>自定义封面 <span className="font-normal text-[#8a93a8]">（视频/GIF 可选）</span></label>
              <div className="flex min-h-[92px] items-center gap-3 rounded-xl border border-[#e6e9f2] bg-[#fafbfe] p-3">
                {customCoverPreviewUrl ? (
                  <img
                    src={customCoverPreviewUrl}
                    alt="自定义封面预览"
                    className="h-[68px] w-[108px] shrink-0 rounded-lg border border-[#e6e9f2] bg-white object-cover"
                  />
                ) : (
                  <div className="flex h-[68px] w-[108px] shrink-0 items-center justify-center rounded-lg border border-dashed border-[#cfd5ea] bg-white text-2xl">🖼️</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-semibold text-[#4a5270]">
                    {customCoverFile
                      ? customCoverFile.name
                      : !mediaKind
                        ? "请先选择视频或 GIF 素材"
                        : mediaKind === "image"
                          ? "图片素材默认使用原图作为封面"
                          : "未上传时自动生成封面"}
                  </p>
                  <p className="mt-1 text-[11px] leading-5 text-[#8a93a8]">支持 JPG、PNG、WebP，最大 8MB</p>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={(mediaKind !== "video" && mediaKind !== "gif") || uploading || transferring}
                      onClick={() => coverInputRef.current?.click()}
                      className="rounded-lg border border-[#cfd5ea] bg-white px-3 py-1.5 text-[11.5px] font-semibold text-[#4a5270] transition hover:border-[#ff8a5c] hover:text-[#ff8a5c] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {customCoverFile ? "更换封面" : "上传封面"}
                    </button>
                    {customCoverFile ? (
                      <button
                        type="button"
                        disabled={uploading || transferring}
                        onClick={() => setCustomCoverFile(null)}
                        className="rounded-lg px-2 py-1.5 text-[11.5px] text-[#8a93a8] transition hover:text-rose-600 disabled:opacity-50"
                      >
                        恢复自动生成
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={handleCoverPick}
              />
            </div>

            <div className="mb-4">
              <label className={fieldLabelClass}><span className="text-[#ff8a5c]">*</span> 标题</label>
              <input className={fieldClass} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="例如：初音未来 · 眨眼循环" />
            </div>

            <div className="mb-4">
              <label className={fieldLabelClass}>描述</label>
              <textarea className={`${fieldClass} h-14 resize-none`} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="简单描述素材内容、动作、适用场景…" />
            </div>

            {mediaKind === "video" ? (
              <div className="mb-4">
                <label className={fieldLabelClass}>专栏</label>
                <select className={fieldClass} value={columnTag} onChange={(event) => setColumnTag(event.target.value)}>
                  {shareColumnOptions.map((item) => <option key={item.value || "none"} value={item.value}>{item.label}</option>)}
                </select>
              </div>
            ) : null}

            <div className="mb-4">
              <label className={fieldLabelClass}><span className="text-[#ff8a5c]">*</span> 目标设备容量（可多选）</label>
              <div className="grid grid-cols-3 gap-2.5">
                {[77, 154, 308].map((frames) => {
                  const selected = targetFrameOptions.includes(frames);
                  return (
                    <button
                      key={frames}
                      type="button"
                      onClick={() => setTargetFrameOptions((current) => selected ? current.filter((item) => item !== frames) : [...current, frames].sort((a, b) => a - b))}
                      className={`rounded-xl border-[1.5px] px-2.5 py-3 text-center transition ${selected ? "border-[#ff8a5c] bg-[#fff7f2] shadow-[0_0_0_2px_rgba(255,138,92,.18)]" : "border-[#e6e9f2] bg-white hover:border-[#ff8a5c]"}`}
                    >
                      <span className="block text-[19px] font-extrabold">{frames} 帧</span>
                      <span className="mt-1 block text-[11px] leading-[1.5] text-[#8a93a8]">约 {frames} 张图片<br />{videoFps}fps 约 {(frames / videoFps).toFixed(1)}s</span>
                    </button>
                  );
                })}
              </div>
              {targetFrameOptions.length === 0 ? <p className="mt-2 text-xs text-rose-600">请至少选择一种目标设备容量</p> : null}
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3.5">
              <div>
                <label className={fieldLabelClass}>视频帧率</label>
                <select className={fieldClass} value={videoFps} onChange={(event) => setVideoFps(Number(event.target.value))}>
                  <option value={20}>20 fps</option><option value={25}>25 fps</option><option value={30}>30 fps</option>
                </select>
              </div>
              <div>
                <label className={fieldLabelClass}>画面方向</label>
                <select className={fieldClass} value={rotationDeg} onChange={(event) => setRotationDeg(Number(event.target.value) as 0 | 90 | 180 | 270)}>
                  <option value={0}>0° 原方向</option><option value={90}>90° 顺时针</option><option value={180}>180°</option><option value={270}>270° 顺时针</option>
                </select>
              </div>
            </div>

            <div className="mb-4">
              <label className={fieldLabelClass}>画面显示</label>
              <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 pt-1 text-[13px] text-[#4a5270]">
                <label className="flex cursor-pointer items-center gap-1.5"><input type="radio" name="fitMode" checked={fitMode === "fill"} onChange={() => setFitMode("fill")} /> 铺满全屏</label>
                <label className="flex cursor-pointer items-center gap-1.5"><input type="radio" name="fitMode" checked={fitMode === "contain"} onChange={() => setFitMode("contain")} /> 适应屏幕</label>
              </div>
            </div>

            <div>
              <label className={fieldLabelClass}>素材色彩</label>
              <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 pt-1 text-[13px] text-[#4a5270]">
                {([ ["normal", "普通"], ["vivid", "鲜艳"], ["professional", "专业"] ] as const).map(([value, label]) => (
                  <label key={value} className="flex cursor-pointer items-center gap-1.5"><input type="radio" name="videoColor" checked={videoColorProfile === value} onChange={() => setVideoColorProfile(value)} /> {label}</label>
                ))}
              </div>
            </div>

            {notice ? <SiteAlert variant="success" className="mt-4">{notice}</SiteAlert> : null}
            {errorMessage ? <SiteAlert variant="error" className="mt-4">{errorMessage}</SiteAlert> : null}
          </div>

          <footer className="flex flex-wrap justify-end gap-3 border-t border-[#e6e9f2] px-[26px] pb-[22px] pt-4">
            <button type="button" disabled={uploading || transferring} onClick={() => navigate("/")} className="rounded-[10px] bg-[#f1f3f8] px-5 py-2.5 text-[13px] font-semibold text-[#4a5270] disabled:opacity-50">取消</button>
            <button type="button" disabled={!selectedFile || !mediaKind || uploading || transferring || targetFrameOptions.length === 0} onClick={() => void handleDeviceTransfer()} className="rounded-[10px] bg-gradient-to-br from-[#7c6cf0] to-[#5a9cff] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(124,108,240,.3)] disabled:opacity-50">
              {transferring ? progress || "下传中…" : "⬇ 下载到当前设备"}
            </button>
            <button type="button" disabled={!selectedFile || !mediaKind || uploading || !title.trim()} onClick={() => void handleShare()} className="rounded-[10px] bg-gradient-to-br from-[#ff8a5c] to-[#ff6f9c] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(255,138,92,.3)] disabled:opacity-50">
              {uploading ? progress || "分享中…" : "🚀 分享到素材库"}
            </button>
          </footer>
        </section>
      </main>

      <div className="mx-auto max-w-[640px] px-4 pb-6 text-center text-xs text-[#8a93a8]">
        内容需符合站点使用规范，上传后将经腾讯云内容安全审核。AI 图片可在 <Link to="/ai-image" className="text-[#7c6cf0] underline">AI 生图页</Link> 生成并分享。
      </div>
      <SiteFooter />
    </div>
  );
}
