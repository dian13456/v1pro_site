import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { DevicePreviewFrame } from "../components/DevicePreviewFrame";
import { SitePageLayout } from "../components/SitePageLayout";
import {
  SiteAlert,
  SiteButton,
  SiteChipButton,
  SitePanel,
  SiteSectionTitle,
  SiteTextarea,
  SITE_BTN_SECONDARY,
} from "../components/SiteUi";
import { V1ProTransferNotice } from "../components/V1ProTransferNotice";
import { useThemeMode } from "../hooks/useThemeMode";
import {
  ImageReviewPendingError,
  MAX_PROMPT_LENGTH,
  downloadGeneratedImage,
  generateAiImages,
  getStarterPrompts,
  readLocalImageFile,
  shareAiImageToCatalog,
  transferAiImageToDevice,
} from "../services/aiImageService";
import { hasValidLocalAuth } from "../services/authService";
import { formatClientError } from "../services/httpClient";
import {
  AI_CREDIT_COST,
  DEFAULT_AI_CREDITS,
  fetchProfile,
} from "../services/profileService";
import { V1PRO_TRANSFER_LAUNCHED_MESSAGE } from "../services/v1proTransferService";
import type { GeneratedAiImage } from "../types/aiImage";

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

export default function AiImagePage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useThemeMode();
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [transferringId, setTransferringId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [uploadingPick, setUploadingPick] = useState(false);
  const [sharedIds, setSharedIds] = useState<Set<string>>(new Set());
  const [transferNotice, setTransferNotice] = useState("");
  const [shareNotice, setShareNotice] = useState("");
  const [images, setImages] = useState<GeneratedAiImage[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [credits, setCredits] = useState<number | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!hasValidLocalAuth()) return;
    void fetchProfile()
      .then((profile) => {
        if (typeof profile.credits === "number") {
          setCredits(profile.credits);
        } else {
          setCredits(DEFAULT_AI_CREDITS);
        }
      })
      .catch(() => setCredits(DEFAULT_AI_CREDITS));
  }, []);

  const creditsKnown = typeof credits === "number";
  const canGenerate = creditsKnown ? credits > 0 : true;

  const handleGenerate = async () => {
    if (loading) return;
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }

    setLoading(true);
    setErrorMessage("");
    try {
      const result = await generateAiImages(prompt);
      setImages(result.images);
      setSharedIds(new Set());
      if (typeof result.creditsRemaining === "number") {
        setCredits(result.creditsRemaining);
      }
    } catch (err) {
      if (err instanceof ImageReviewPendingError) {
        setShareNotice(formatReviewPendingMessage(err));
        window.setTimeout(() => setShareNotice(""), 8000);
        void fetchProfile()
          .then((profile) => {
            if (typeof profile.credits === "number") {
              setCredits(profile.credits);
            }
          })
          .catch(() => undefined);
        return;
      }
      const message = formatClientError(err, "AI 图片生成失败");
      setErrorMessage(message);
      if (message.includes("认证")) {
        navigate("/auth", { replace: true });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUploadPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }

    setErrorMessage("");
    setUploadingPick(true);
    try {
      const uploaded = await readLocalImageFile(file);
      setImages([uploaded]);
      setSharedIds(new Set());
      if (!prompt.trim()) {
        setPrompt(uploaded.fileName || "用户上传图片");
      }
    } catch (err) {
      setErrorMessage(formatClientError(err, "图片上传失败"));
    } finally {
      setUploadingPick(false);
    }
  };

  const handleTransfer = async (image: GeneratedAiImage, index: number) => {
    if (transferringId) return;
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }

    const fileName = `ai-image-${index + 1}.jpg`;
    setErrorMessage("");
    setTransferringId(image.id);
    try {
      await transferAiImageToDevice(image, fileName);
      setTransferNotice(V1PRO_TRANSFER_LAUNCHED_MESSAGE);
      window.setTimeout(() => setTransferNotice(""), 5000);
    } catch (err) {
      if (err instanceof ImageReviewPendingError) {
        setTransferNotice(formatReviewPendingMessage(err));
        window.setTimeout(() => setTransferNotice(""), 8000);
        return;
      }
      const message = formatClientError(err, "传输失败");
      setErrorMessage(message);
      if (message.includes("认证")) {
        navigate("/auth", { replace: true });
      }
    } finally {
      setTransferringId(null);
    }
  };

  const handleShare = async (image: GeneratedAiImage) => {
    if (sharingId || sharedIds.has(image.id)) return;
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }

    setErrorMessage("");
    setSharingId(image.id);
    try {
      const sharePrompt =
        prompt.trim() ||
        (image.source === "upload" ? image.fileName || "用户上传图片" : "");
      const result = await shareAiImageToCatalog(image, sharePrompt);
      setSharedIds((prev) => new Set(prev).add(image.id));
      const remaining =
        typeof result.shareRemaining === "number"
          ? result.shareRemaining
          : undefined;
      setShareNotice(
        remaining !== undefined
          ? `已分享到素材库（#${result.resourceId || ""}），剩余分享次数 ${remaining}`
          : `已分享到素材库（#${result.resourceId || ""}），可在素材中心查看`
      );
      window.setTimeout(() => setShareNotice(""), 5000);
    } catch (err) {
      if (err instanceof ImageReviewPendingError) {
        setShareNotice(formatReviewPendingMessage(err));
        window.setTimeout(() => setShareNotice(""), 8000);
        return;
      }
      const message = formatClientError(err, "分享失败");
      setErrorMessage(message);
      if (message.includes("认证")) {
        navigate("/auth", { replace: true });
      }
    } finally {
      setSharingId(null);
    }
  };

  const isBusy = Boolean(transferringId || sharingId);

  return (
    <SitePageLayout
      subtitle="AI 生图 / 上传图片"
      theme={theme}
      onToggleTheme={toggleTheme}
      beforeContent={
        <>
          <V1ProTransferNotice message={transferNotice} onDismiss={() => setTransferNotice("")} />
          <V1ProTransferNotice message={shareNotice} onDismiss={() => setShareNotice("")} />
        </>
      }
    >
        <SitePanel accent>
          <SiteSectionTitle
            title="AI 生图 / 上传图片"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,image/bmp,image/gif"
                  className="hidden"
                  onChange={(event) => void handleUploadPick(event)}
                />
                <button
                  type="button"
                  disabled={loading || isBusy || uploadingPick}
                  onClick={() => uploadInputRef.current?.click()}
                  className={SITE_BTN_SECONDARY}
                >
                  {uploadingPick ? "处理图片中..." : "上传本地图片"}
                </button>
                <span className={`${SITE_BTN_SECONDARY} cursor-default hover:bg-white/50 dark:hover:bg-slate-900/45`}>
                  剩余积分 {creditsKnown ? credits : "…"}（每次消耗 {AI_CREDIT_COST}）
                </span>
              </div>
            }
          />
        </SitePanel>

        <section className="mb-4 flex flex-wrap gap-2">
          {getStarterPrompts().map((starter) => (
            <SiteChipButton key={starter} disabled={loading} onClick={() => setPrompt(starter)}>
              {starter}
            </SiteChipButton>
          ))}
        </section>

        <SitePanel className="space-y-5">
          <div className="space-y-3">
            <SiteTextarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value.slice(0, MAX_PROMPT_LENGTH))}
              rows={4}
              placeholder="描述你想要的画面，例如：赛博朋克风格的城市夜景，霓虹灯，雨夜反光，高细节"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {prompt.trim().length}/{MAX_PROMPT_LENGTH}
              </span>
              <SiteButton
                type="button"
                disabled={loading || !prompt.trim() || !canGenerate}
                onClick={() => void handleGenerate()}
                className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-500 hover:brightness-110"
              >
                {loading ? "生成中…" : canGenerate ? "生成图片" : "积分不足"}
              </SiteButton>
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">正在绘制，请稍候…</div>
          ) : null}

          {errorMessage ? <SiteAlert variant="error">{errorMessage}</SiteAlert> : null}

          {images.length > 0 ? (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
              {images.map((image, index) => (
                <article
                  key={image.id}
                  className="group rounded-3xl border border-white/25 bg-white/70 p-4 dark:border-white/10 dark:bg-slate-950/40"
                >
                  <div className="mb-3 inline-flex rounded-full bg-violet-600 px-3 py-1 text-xs text-white">
                    {image.source === "upload" ? "本地上传 · 1.9 寸预览" : "AI 生成 · 1.9 寸预览"}
                  </div>
                  <DevicePreviewFrame hoverGlow>
                    <img
                      src={image.dataUrl}
                      alt={`AI 生成图片 ${index + 1}`}
                      className="h-full w-full object-cover"
                    />
                  </DevicePreviewFrame>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => downloadGeneratedImage(image, `ai-image-${index + 1}.jpg`)}
                      className="rounded-xl border border-slate-200/80 bg-white px-2 py-2.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 sm:px-4 sm:text-sm"
                    >
                      下载
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleTransfer(image, index)}
                      className="rounded-xl bg-cyan-600 px-2 py-2.5 text-xs font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60 sm:px-4 sm:text-sm"
                    >
                      {transferringId === image.id ? "准备传输..." : "传输到设备"}
                    </button>
                    <button
                      type="button"
                      disabled={isBusy || sharedIds.has(image.id)}
                      onClick={() => void handleShare(image)}
                      className="rounded-xl bg-violet-600 px-2 py-2.5 text-xs font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60 sm:px-4 sm:text-sm"
                    >
                      {sharingId === image.id
                        ? "分享中..."
                        : sharedIds.has(image.id)
                          ? "已分享"
                          : "一键分享"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </SitePanel>

    </SitePageLayout>
  );
}
