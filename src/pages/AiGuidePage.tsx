import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ResourceCard } from "../components/ResourceCard";
import { V1ProTransferNotice } from "../components/V1ProTransferNotice";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { SitePageShell } from "../components/SitePageShell";
import { SitePageToolbar } from "../components/SitePageToolbar";
import { useResourceInteractions } from "../hooks/useResourceInteractions";
import { useThemeMode } from "../hooks/useThemeMode";
import { MAX_QUESTION_LENGTH, askAiGuide } from "../services/aiGuideService";
import { hasValidLocalAuth } from "../services/authService";
import { displayDownloadCount, fetchResourceDownloads } from "../services/downloadStatsService";
import { fetchResourceFavorites } from "../services/favoriteService";
import { fetchResourceLikes } from "../services/likeService";
import { fetchResources } from "../services/resourceService";
import type { AiGuideMessage } from "../types/aiGuide";
import type { ResourceItem } from "../types/resource";

const STARTER_PROMPTS = [
  "有什么适合横屏的可爱 GIF？",
  "推荐几个视频素材",
  "月薪喵专栏有什么？",
  "最近上传了哪些素材？",
];

export default function AiGuidePage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useThemeMode();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<AiGuideMessage[]>([
    {
      role: "assistant",
      content:
        "你好，我是 AI 助手。你可以告诉我想要的主题、角色、风格或素材类型，我会从素材库中帮你推荐合适的内容。",
    },
  ]);
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const {
    downloadingId,
    transferringId,
    transferNotice,
    setTransferNotice,
    playingId,
    playingResourceId,
    playingUrl,
    likingId,
    likeCounts,
    likedIds,
    favoriteIds,
    favoriteIdSet,
    favoritingId,
    totalDownloadCounts,
    weeklyDownloadCounts,
    errorMessage,
    setErrorMessage,
    setLikeCounts,
    setLikedIds,
    setFavoriteIds,
    setTotalDownloadCounts,
    setWeeklyDownloadCounts,
    handleDownload,
    handleTransferPrepare,
    handleTransfer,
    handlePlay,
    handleLike,
    handleFavorite,
    stopPlay,
  } = useResourceInteractions();

  useEffect(() => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    void fetchResources().then(setResources).catch(() => setResources([]));
    void fetchResourceLikes()
      .then((state) => {
        setLikeCounts(state.counts);
        setLikedIds(state.likedIds);
      })
      .catch(() => undefined);
    void fetchResourceFavorites()
      .then((state) => setFavoriteIds(state.favoriteIds))
      .catch(() => undefined);
    void fetchResourceDownloads()
      .then((state) => {
        setTotalDownloadCounts(state.totalCounts);
        setWeeklyDownloadCounts(state.weeklyCounts);
      })
      .catch(() => undefined);
  }, [navigate, setFavoriteIds, setLikeCounts, setLikedIds, setTotalDownloadCounts, setWeeklyDownloadCounts]);

  const resourceMap = useMemo(() => {
    const map = new Map<number, ResourceItem>();
    for (const item of resources) {
      map.set(item.id, item);
    }
    return map;
  }, [resources]);

  const submitQuestion = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setErrorMessage("");
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setInput("");

    try {
      const result = await askAiGuide(trimmed);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.answer || "已为你整理相关素材。",
          resourceIds: result.resourceIds,
          mode: result.mode,
        },
      ]);
    } catch (err) {
      const message = (err as Error)?.message || "AI 助手请求失败";
      setErrorMessage(message);
      if (message.includes("认证")) {
        navigate("/auth", { replace: true });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SitePageShell
      beforeContent={
        <V1ProTransferNotice message={transferNotice} onDismiss={() => setTransferNotice("")} />
      }
    >
        <SiteHeader
          title="佳点电子资源中心"
          subtitle="AI 助手 · 从素材库中智能推荐"
          rightSlot={<SitePageToolbar theme={theme} onToggleTheme={toggleTheme} />}
        />

        <section className="mb-4 flex flex-wrap gap-2">
          {STARTER_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={loading}
              onClick={() => void submitQuestion(prompt)}
              className="rounded-full border border-cyan-200/70 bg-cyan-50/80 px-4 py-2 text-sm text-cyan-800 transition hover:bg-cyan-100 disabled:opacity-60 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-200"
            >
              {prompt}
            </button>
          ))}
        </section>

        <section className="space-y-6 rounded-3xl border border-white/25 bg-white/55 p-5 backdrop-blur dark:border-white/10 dark:bg-slate-900/45">
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className="space-y-4">
              <div className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[760px] rounded-2xl px-4 py-3 text-sm leading-6 ${
                    message.role === "user"
                      ? "bg-cyan-600 text-white"
                      : "border border-white/20 bg-white/80 text-slate-700 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-200"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
                </div>
              </div>

              {message.role === "assistant" && message.resourceIds && message.resourceIds.length > 0 ? (
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
                  {message.resourceIds.map((id) => {
                    const resource = resourceMap.get(id);
                    if (!resource) {
                      return (
                        <div
                          key={id}
                          className="rounded-3xl border border-white/25 bg-white/55 p-4 text-sm text-slate-500 dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-400"
                        >
                          素材 #{id} 暂不可用
                        </div>
                      );
                    }
                    return (
                      <ResourceCard
                        key={`${index}-${resource.id}`}
                        resource={resource}
                        onDownload={handleDownload}
                        onTransfer={handleTransfer}
                        onTransferPrepare={handleTransferPrepare}
                        onPlay={handlePlay}
                        onStopPlay={stopPlay}
                        onLike={handleLike}
                        onFavorite={handleFavorite}
                        downloading={downloadingId === resource.id}
                        transferring={transferringId === resource.id}
                        playing={playingId === resource.id}
                        isPlaying={playingResourceId === resource.id}
                        playUrl={playingResourceId === resource.id ? playingUrl : ""}
                        liking={likingId === resource.id}
                        liked={likedIds.has(resource.id)}
                        likeCount={likeCounts[resource.id] || 0}
                        favorited={favoriteIdSet.has(resource.id)}
                        favoriting={favoritingId === resource.id}
                        downloadCount={displayDownloadCount(totalDownloadCounts[resource.id] || 0)}
                        weeklyDownloadCount={displayDownloadCount(weeklyDownloadCounts[resource.id] || 0)}
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>
          ))}

          {loading ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">AI 正在思考…</div>
          ) : null}

          {errorMessage ? (
            <div className="rounded-2xl border border-rose-200/70 bg-rose-50/90 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
              {errorMessage}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 border-t border-white/20 pt-4 dark:border-white/10">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value.slice(0, MAX_QUESTION_LENGTH))}
              rows={3}
              placeholder="例如：推荐几个孤独摇滚相关的 GIF"
              className="w-full resize-y rounded-2xl border border-white/30 bg-white/70 px-4 py-3 text-sm outline-none ring-cyan-400/40 focus:ring-2 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {input.trim().length}/{MAX_QUESTION_LENGTH}
              </span>
              <button
                type="button"
                disabled={loading || !input.trim()}
                onClick={() => void submitQuestion(input)}
                className="rounded-full bg-cyan-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "发送中..." : "发送"}
              </button>
            </div>
          </div>
        </section>

        <SiteFooter />
    </SitePageShell>
  );
}
