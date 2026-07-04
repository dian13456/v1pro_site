import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAuthState } from "../services/authService";
import { createDownloadUrl } from "../services/downloadService";
import {
  dismissSoftwarePrompt,
  hasDismissedSoftwarePrompt,
  hasDismissedWelcome,
} from "../services/firstVisitPromptService";
import { createImageUrl } from "../services/imageService";
import { fetchResources } from "../services/resourceService";
import type { ResourceItem } from "../types/resource";
import { findLatestSoftware } from "../utils/latestSoftware";

export function LatestSoftwareModal() {
  const navigate = useNavigate();
  const auth = getAuthState();
  const serial = auth?.serial || "";
  const [software, setSoftware] = useState<ResourceItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(() => Boolean(serial) && !hasDismissedSoftwarePrompt(serial));
  const [welcomeBlocking, setWelcomeBlocking] = useState(() => Boolean(serial) && !hasDismissedWelcome(serial));

  useEffect(() => {
    if (!serial || !open) {
      setLoading(false);
      return;
    }

    let active = true;
    void fetchResources()
      .then((resources) => {
        if (!active) return;
        const latest = findLatestSoftware(resources);
        setSoftware(latest);
        if (!latest) {
          dismissSoftwarePrompt(serial);
          setOpen(false);
        }
      })
      .catch(() => {
        if (!active) return;
        setSoftware(null);
        setOpen(false);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [serial, open]);

  useEffect(() => {
    if (!software || !open) {
      setPreviewUrl("");
      return;
    }

    let active = true;
    void createImageUrl(software.id, software.image)
      .then((result) => {
        if (active && result.url) {
          setPreviewUrl(result.url);
        }
      })
      .catch(() => {
        if (active) setPreviewUrl("");
      });

    return () => {
      active = false;
    };
  }, [software, open]);

  useEffect(() => {
    if (!serial || !open || !welcomeBlocking) return;

    const timer = window.setInterval(() => {
      if (hasDismissedWelcome(serial)) {
        setWelcomeBlocking(false);
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [serial, open, welcomeBlocking]);

  if (!serial || !open || !software || welcomeBlocking) {
    return null;
  }

  const handleDismiss = () => {
    dismissSoftwarePrompt(serial);
    setOpen(false);
  };

  const handleDownload = async () => {
    try {
      setDownloading(true);
      setError("");
      const result = await createDownloadUrl(software.id, software.download, { forDownload: true });
      if (!result.url) {
        throw new Error("下载链接生成失败");
      }
      window.open(result.url, "_blank", "noopener,noreferrer");
      dismissSoftwarePrompt(serial);
      setOpen(false);
    } catch (err) {
      const message = (err as Error)?.message || "下载失败";
      setError(message);
      if (message.includes("认证")) {
        navigate("/auth", { replace: true });
      }
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[89] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="latest-software-title"
        className="relative w-full max-w-md overflow-hidden rounded-3xl border border-violet-200/60 bg-gradient-to-b from-violet-50 via-white to-fuchsia-50 p-6 shadow-2xl dark:border-violet-500/20 dark:from-violet-950/80 dark:via-slate-900 dark:to-fuchsia-950/60"
      >
        <button
          type="button"
          aria-label="关闭软件推荐"
          onClick={handleDismiss}
          className="absolute right-4 top-4 rounded-full px-2 py-1 text-lg leading-none text-slate-400 transition hover:bg-white/60 hover:text-slate-600 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
        >
          ×
        </button>

        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-600 dark:text-violet-300">
          Software
        </p>
        <h2 id="latest-software-title" className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-50">
          最新软件下载
        </h2>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          首次进入已为你匹配最新版桌面软件，可直接下载安装。
        </p>

        <div className="mt-5 overflow-hidden rounded-2xl border border-violet-100/80 bg-white/70 dark:border-violet-500/15 dark:bg-slate-950/40">
          {previewUrl ? (
            <img src={previewUrl} alt={software.title} className="mx-auto max-h-40 w-full object-contain p-4" />
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">封面加载中...</div>
          )}
          <div className="border-t border-violet-100/80 px-4 py-3 dark:border-violet-500/15">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{software.title}</p>
            <p className="mt-1 text-xs leading-6 text-slate-600 dark:text-slate-300">{software.description}</p>
            {software.size && software.size !== "未知" ? (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">大小：{software.size}</p>
            ) : null}
          </div>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">正在获取最新软件...</p>
        ) : null}
        {error ? <p className="mt-4 text-sm text-rose-600 dark:text-rose-300">{error}</p> : null}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={handleDismiss}
            className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            稍后再说
          </button>
          <button
            type="button"
            disabled={downloading || loading}
            onClick={() => void handleDownload()}
            className="flex-1 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {downloading ? "生成链接..." : "立即下载"}
          </button>
        </div>
      </div>
    </div>
  );
}
