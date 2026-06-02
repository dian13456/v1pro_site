import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { SiteNav } from "../components/SiteNav";
import { ThemeToggle } from "../components/ThemeToggle";
import { useThemeMode } from "../hooks/useThemeMode";
import {
  ASPECT_RATIO_OPTIONS,
  MAX_PROMPT_LENGTH,
  downloadGeneratedImage,
  generateAiImages,
  getStarterPrompts,
} from "../services/aiImageService";
import { clearAuthState, hasValidLocalAuth } from "../services/authService";
import type { AiImageAspectRatio, GeneratedAiImage } from "../types/aiImage";
import { pushDataUrlImageToDevice, type PushImageProgress } from "../services/usbImagePushService";

const IMAGE_COUNT_OPTIONS = [1, 2, 4] as const;

function progressLabel(progress: PushImageProgress | null): string {
  if (!progress) return "";
  if (progress.phase === "convert") return "正在转换图片格式…";
  if (progress.phase === "transfer") {
    if (progress.total > 0) {
      const pct = Math.min(100, Math.round((progress.sent / progress.total) * 100));
      return `正在传输到设备 ${pct}%`;
    }
    return "正在传输到设备…";
  }
  if (progress.phase === "done") return "传输完成";
  return "准备中…";
}

export default function AiImagePage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useThemeMode();
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AiImageAspectRatio>("9:16");
  const [count, setCount] = useState<(typeof IMAGE_COUNT_OPTIONS)[number]>(1);
  const [loading, setLoading] = useState(false);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [pushProgress, setPushProgress] = useState<PushImageProgress | null>(null);
  const [images, setImages] = useState<GeneratedAiImage[]>([]);
  const [errorMessage, setErrorMessage] = useState("");

  const handleLogout = () => {
    clearAuthState();
    navigate("/auth", { replace: true });
  };

  const handleGenerate = async () => {
    if (loading) return;
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }

    setLoading(true);
    setErrorMessage("");
    try {
      const result = await generateAiImages(prompt, aspectRatio, count);
      setImages(result);
    } catch (err) {
      const message = (err as Error)?.message || "AI 图片生成失败";
      setErrorMessage(message);
      if (message.includes("认证")) {
        navigate("/auth", { replace: true });
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePush = async (image: GeneratedAiImage) => {
    if (pushingId) return;
    setErrorMessage("");
    setPushingId(image.id);
    setPushProgress(null);
    try {
      await pushDataUrlImageToDevice(image.dataUrl, setPushProgress);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "传输到设备失败");
    } finally {
      setPushingId(null);
      setPushProgress(null);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_8%_14%,rgba(125,211,252,0.22),transparent_42%),radial-gradient(circle_at_90%_10%,rgba(147,197,253,0.2),transparent_38%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] text-slate-900 dark:bg-[radial-gradient(circle_at_8%_14%,rgba(14,116,144,0.25),transparent_42%),radial-gradient(circle_at_90%_10%,rgba(30,64,175,0.24),transparent_38%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] dark:text-slate-100">
      <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
        <SiteHeader
          title="佳点电子资源中心"
          rightSlot={
            <div className="flex flex-wrap items-center gap-2">
              <SiteNav />
              <ThemeToggle dark={theme === "dark"} onToggle={toggleTheme} />
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full border border-white/30 bg-white/50 px-4 py-2 text-sm text-slate-700 backdrop-blur dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-100"
              >
                退出认证
              </button>
            </div>
          }
        />

        <section className="mb-4 rounded-3xl border border-violet-200/60 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/10 to-cyan-500/10 p-5 dark:border-violet-500/20">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">AI 生成图片</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            输入文字描述，由 MiniMax image-01 模型生成图片。生成后可下载，或通过 WebUSB 直接发送到已连接的设备。
          </p>
        </section>

        <section className="mb-4 flex flex-wrap gap-2">
          {getStarterPrompts().map((starter) => (
            <button
              key={starter}
              type="button"
              disabled={loading}
              onClick={() => setPrompt(starter)}
              className="rounded-full border border-violet-200/70 bg-violet-50/80 px-4 py-2 text-sm text-violet-800 transition hover:bg-violet-100 disabled:opacity-60 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200"
            >
              {starter}
            </button>
          ))}
        </section>

        <section className="space-y-5 rounded-3xl border border-white/25 bg-white/55 p-5 backdrop-blur dark:border-white/10 dark:bg-slate-900/45">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-2 text-sm">
              <span className="text-slate-600 dark:text-slate-300">画面比例</span>
              <select
                value={aspectRatio}
                onChange={(event) => setAspectRatio(event.target.value as AiImageAspectRatio)}
                className="w-full rounded-2xl border border-white/30 bg-white/70 px-4 py-3 outline-none ring-violet-400/40 focus:ring-2 dark:border-white/10 dark:bg-slate-950/50"
              >
                {ASPECT_RATIO_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-2 text-sm">
              <span className="text-slate-600 dark:text-slate-300">生成数量</span>
              <select
                value={count}
                onChange={(event) => setCount(Number(event.target.value) as (typeof IMAGE_COUNT_OPTIONS)[number])}
                className="w-full rounded-2xl border border-white/30 bg-white/70 px-4 py-3 outline-none ring-violet-400/40 focus:ring-2 dark:border-white/10 dark:bg-slate-950/50"
              >
                {IMAGE_COUNT_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value} 张
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-3">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value.slice(0, MAX_PROMPT_LENGTH))}
              rows={4}
              placeholder="描述你想要的画面，例如：赛博朋克风格的城市夜景，霓虹灯，雨夜反光，高细节"
              className="w-full resize-y rounded-2xl border border-white/30 bg-white/70 px-4 py-3 text-sm outline-none ring-violet-400/40 focus:ring-2 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {prompt.trim().length}/{MAX_PROMPT_LENGTH}
              </span>
              <button
                type="button"
                disabled={loading || !prompt.trim()}
                onClick={() => void handleGenerate()}
                className="rounded-full bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-500 px-6 py-2.5 text-sm font-medium text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "生成中…" : "生成图片"}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">MiniMax 正在绘制，请稍候…</div>
          ) : null}

          {errorMessage ? (
            <div className="rounded-2xl border border-rose-200/70 bg-rose-50/90 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
              {errorMessage}
            </div>
          ) : null}

          {pushingId && pushProgress ? (
            <div className="rounded-2xl border border-cyan-200/70 bg-cyan-50/90 px-4 py-3 text-sm text-cyan-800 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-200">
              {progressLabel(pushProgress)}
            </div>
          ) : null}

          {images.length > 0 ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {images.map((image, index) => (
                <article
                  key={image.id}
                  className="overflow-hidden rounded-3xl border border-white/25 bg-white/70 dark:border-white/10 dark:bg-slate-950/40"
                >
                  <img
                    src={image.dataUrl}
                    alt={`AI 生成图片 ${index + 1}`}
                    className="aspect-[9/16] w-full bg-slate-900 object-contain"
                  />
                  <div className="flex flex-wrap gap-2 p-4">
                    <button
                      type="button"
                      onClick={() => downloadGeneratedImage(image, `ai-image-${index + 1}.jpg`)}
                      className="rounded-full border border-slate-200/80 bg-white px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100"
                    >
                      下载
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(pushingId)}
                      onClick={() => void handlePush(image)}
                      className="rounded-full bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pushingId === image.id ? "传输中…" : "发送到设备"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>

        <SiteFooter />
      </div>
    </div>
  );
}
