import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CategoryTabs } from "../components/CategoryTabs";
import { ResourceCard } from "../components/ResourceCard";
import { V1ProTransferNotice } from "../components/V1ProTransferNotice";
import { SearchBar } from "../components/SearchBar";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";
import { SiteNav } from "../components/SiteNav";
import { ThemeToggle } from "../components/ThemeToggle";
import { useImagePreload } from "../hooks/useImagePreload";
import { useThemeMode } from "../hooks/useThemeMode";
import { useResourceCatalog } from "../hooks/useResourceCatalog";
import { clearAuthState, hasValidLocalAuth } from "../services/authService";
import { createDownloadUrl } from "../services/downloadService";
import { fetchResourceDownloads, displayDownloadCount } from "../services/downloadStatsService";
import type { DownloadStatsSnapshot } from "../types/downloadStats";
import { createImageUrl } from "../services/imageService";
import { fetchResourceLikes, likeResource } from "../services/likeService";
import { isStaticMode } from "../services/runtimeMode";
import type { ResourceItem } from "../types/resource";
import { pickRandomItems } from "../utils/randomPick";
import {
  V1PRO_TRANSFER_LAUNCHED_MESSAGE,
  transferResourceToDevice,
} from "../services/v1proTransferService";

const RANDOM_PAGE_SIZE = 4;
const WEEKLY_TOP_LIMIT = 20;
const DEFAULT_PAGE_SIZE = 16;

export default function ResourcesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [transferringId, setTransferringId] = useState<number | null>(null);
  const [transferNotice, setTransferNotice] = useState("");
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [playingResourceId, setPlayingResourceId] = useState<number | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string>("");
  const [likingId, setLikingId] = useState<number | null>(null);
  const [likeCounts, setLikeCounts] = useState<Record<number, number>>({});
  const [likedIds, setLikedIds] = useState<Set<number>>(new Set<number>());
  const [totalDownloadCounts, setTotalDownloadCounts] = useState<Record<number, number>>({});
  const [weeklyDownloadCounts, setWeeklyDownloadCounts] = useState<Record<number, number>>({});
  const [downloadWeekKey, setDownloadWeekKey] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [randomMode, setRandomMode] = useState(false);
  const [randomItems, setRandomItems] = useState<ResourceItem[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const { theme, toggleTheme } = useThemeMode();
  const {
    resources,
    filtered,
    loading,
    error,
    keyword,
    setKeyword,
    category,
    setCategory,
    materialType,
    setMaterialType,
    columnTag,
    setColumnTag,
    columnTagFilterOptions,
    sortMode,
    setSortMode,
  } = useResourceCatalog();

  useEffect(() => {
    const search = searchParams.get("search")?.trim();
    if (search) {
      setKeyword(search);
      setCurrentPage(1);
    }
  }, [searchParams, setKeyword]);

  const sortedResources = useMemo(() => {
    if (sortMode === "hot") {
      return [...filtered].sort((a, b) => {
        const likeA = likeCounts[a.id] || 0;
        const likeB = likeCounts[b.id] || 0;
        if (likeA !== likeB) return likeB - likeA;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    }
    if (sortMode === "weeklyTop") {
      return [...filtered]
        .sort((a, b) => {
          const weeklyA = weeklyDownloadCounts[a.id] || 0;
          const weeklyB = weeklyDownloadCounts[b.id] || 0;
          if (weeklyA !== weeklyB) return weeklyB - weeklyA;
          const totalA = totalDownloadCounts[a.id] || 0;
          const totalB = totalDownloadCounts[b.id] || 0;
          if (totalA !== totalB) return totalB - totalA;
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        })
        .slice(0, WEEKLY_TOP_LIMIT);
    }
    return filtered;
  }, [filtered, sortMode, likeCounts, weeklyDownloadCounts, totalDownloadCounts]);
  const totalItems = sortedResources.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  useEffect(() => {
    setCurrentPage(1);
    setRandomMode(false);
    setRandomItems([]);
  }, [keyword, category, materialType, columnTag, sortMode, pageSize]);

  useEffect(() => {
    if (sortMode === "weeklyTop") {
      setRandomMode(false);
      setRandomItems([]);
    }
  }, [sortMode]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const visibleItems = useMemo(() => {
    if (randomMode) {
      return randomItems;
    }
    if (sortMode === "weeklyTop") {
      return sortedResources;
    }
    const start = (currentPage - 1) * pageSize;
    return sortedResources.slice(start, start + pageSize);
  }, [randomMode, randomItems, sortMode, sortedResources, currentPage, pageSize]);

  const pageList = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages = new Set<number>([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
    return Array.from(pages)
      .filter((p) => p >= 1 && p <= totalPages)
      .sort((a, b) => a - b);
  }, [totalPages, currentPage]);

  const preloadList = useMemo(
    () =>
      isStaticMode()
        ? visibleItems
            .slice(0, Math.min(visibleItems.length + 6, 26))
            .map((item) => item.image)
            .filter((url) => /^https?:\/\//i.test(url))
        : [],
    [visibleItems]
  );
  useImagePreload(preloadList);

  useEffect(() => {
    let active = true;
    fetchResourceLikes()
      .then((state) => {
        if (!active) return;
        setLikeCounts(state.counts);
        setLikedIds(state.likedIds);
      })
      .catch(() => {
        // Ignore like init errors, download flow handles auth failures explicitly.
      });
    fetchResourceDownloads()
      .then((state) => {
        if (!active) return;
        setTotalDownloadCounts(state.totalCounts);
        setWeeklyDownloadCounts(state.weeklyCounts);
        setDownloadWeekKey(state.weekKey);
      })
      .catch(() => {
        // Ignore download stats init errors.
      });
    return () => {
      active = false;
    };
  }, []);

  const handleLogout = () => {
    clearAuthState();
    navigate("/auth", { replace: true });
  };

  const handleRandomRecommend = () => {
    const pool = filtered.filter(
      (resource) =>
        resource.materialType === "image" ||
        resource.materialType === "video" ||
        resource.materialType === "gif"
    );
    setRandomItems(pickRandomItems(pool, RANDOM_PAGE_SIZE));
    setRandomMode(true);
    setCurrentPage(1);
    setPlayingResourceId(null);
    setPlayingUrl("");
    setErrorMessage("");
  };

  const handleExitRandomMode = () => {
    setRandomMode(false);
    setRandomItems([]);
    setCurrentPage(1);
  };

  const applyDownloadStats = (resourceId: number, stats?: DownloadStatsSnapshot | null) => {
    if (!stats) return;
    setTotalDownloadCounts((prev) => ({
      ...prev,
      [resourceId]: stats.totalCount,
    }));
    setWeeklyDownloadCounts((prev) => ({
      ...prev,
      [resourceId]: stats.weeklyCount,
    }));
    if (stats.weekKey) {
      setDownloadWeekKey(stats.weekKey);
    }
  };

  const handleDownload = async (resource: ResourceItem) => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }

    try {
      setDownloadingId(resource.id);
      setErrorMessage("");
      const downloadResult =
        resource.materialType === "image"
          ? await createImageUrl(resource.id, resource.image, { forDownload: true })
          : await createDownloadUrl(resource.id, resource.download, { forDownload: true });
      applyDownloadStats(resource.id, downloadResult.stats);
      if (!downloadResult.url) {
        throw new Error("下载链接生成失败");
      }
      window.open(downloadResult.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      const message = (err as Error)?.message || "下载失败";
      setErrorMessage(message);
      if (message.includes("认证")) {
        navigate("/auth", { replace: true });
      }
    } finally {
      setDownloadingId(null);
    }
  };

  const handleTransfer = async (resource: ResourceItem) => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }

    try {
      setTransferringId(resource.id);
      setErrorMessage("");
      const { stats } = await transferResourceToDevice(resource, { auto: true });
      applyDownloadStats(resource.id, stats);
      setTransferNotice(V1PRO_TRANSFER_LAUNCHED_MESSAGE);
      window.setTimeout(() => setTransferNotice(""), 5000);
    } catch (err) {
      const message = (err as Error)?.message || "传输失败";
      setErrorMessage(message);
      if (message.includes("认证")) {
        navigate("/auth", { replace: true });
      }
    } finally {
      setTransferringId(null);
    }
  };

  const handleLike = async (resource: ResourceItem) => {
    if (likedIds.has(resource.id)) {
      return;
    }
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    try {
      setLikingId(resource.id);
      setErrorMessage("");
      const result = await likeResource(resource.id);
      setLikeCounts((prev) => ({
        ...prev,
        [resource.id]: result.likeCount,
      }));
      if (result.liked || result.alreadyLiked) {
        setLikedIds((prev) => {
          const next = new Set(prev);
          next.add(resource.id);
          return next;
        });
      }
    } catch (err) {
      const message = (err as Error)?.message || "点赞失败";
      setErrorMessage(message);
      if (message.includes("认证")) {
        navigate("/auth", { replace: true });
      }
    } finally {
      setLikingId(null);
    }
  };

  const handlePlay = async (resource: ResourceItem) => {
    if (playingResourceId === resource.id) {
      setPlayingResourceId(null);
      setPlayingUrl("");
      return;
    }

    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }

    try {
      setPlayingId(resource.id);
      setErrorMessage("");
      const playResult = await createDownloadUrl(resource.id, resource.download, {
        forDownload: false,
      });
      if (!playResult.url) {
        throw new Error("播放链接生成失败");
      }
      setPlayingResourceId(resource.id);
      setPlayingUrl(playResult.url);
    } catch (err) {
      const message = (err as Error)?.message || "播放链接生成失败";
      setErrorMessage(message);
      if (message.includes("认证")) {
        navigate("/auth", { replace: true });
      }
    } finally {
      setPlayingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_8%_14%,rgba(125,211,252,0.22),transparent_42%),radial-gradient(circle_at_90%_10%,rgba(147,197,253,0.2),transparent_38%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] text-slate-900 dark:bg-[radial-gradient(circle_at_8%_14%,rgba(14,116,144,0.25),transparent_42%),radial-gradient(circle_at_90%_10%,rgba(30,64,175,0.24),transparent_38%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] dark:text-slate-100">
      <V1ProTransferNotice message={transferNotice} onDismiss={() => setTransferNotice("")} />
      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
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

        <section className="mb-6 grid gap-3 md:grid-cols-[1fr_auto]">
          <SearchBar value={keyword} onChange={setKeyword} />
          <CategoryTabs value={category} onChange={setCategory} />
        </section>

        <section className="mb-4 flex flex-wrap gap-2">
          {[
            { value: "all", label: "全部类型" },
            { value: "image", label: "图片素材" },
            { value: "video", label: "视频素材" },
            { value: "gif", label: "GIF素材" },
            { value: "v1pro-pack", label: "V1PRO素材包" },
          ].map((item) => {
            const active = materialType === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setMaterialType(item.value as typeof materialType)}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  active
                    ? "bg-cyan-600 text-white"
                    : "border border-white/25 bg-white/55 text-slate-700 dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-200"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </section>
        <section className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500 dark:text-slate-300">专栏</span>
          {columnTagFilterOptions.map((item) => {
            const active = columnTag === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setColumnTag(item.value)}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  active
                    ? "bg-amber-500 text-white"
                    : "border border-amber-200/70 bg-amber-50/80 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </section>
        <section className="mb-6 flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-500 dark:text-slate-300">排序</span>
          {[
            { value: "latest", label: "最新优先" },
            { value: "hot", label: "热门排行" },
            { value: "weeklyTop", label: "周下载TOP20" },
          ].map((item) => {
            const active = sortMode === item.value;
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => setSortMode(item.value as typeof sortMode)}
                className={`rounded-full px-4 py-2 text-sm transition ${
                  active
                    ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                    : "border border-white/25 bg-white/55 text-slate-700 dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-200"
                }`}
              >
                {item.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={handleRandomRecommend}
            disabled={loading || resources.length === 0}
            className={`rounded-full px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
              randomMode
                ? "bg-violet-600 text-white"
                : "border border-violet-300/60 bg-violet-50 text-violet-700 hover:bg-violet-100 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-200 dark:hover:bg-violet-500/25"
            }`}
          >
            随机推荐
          </button>
          {randomMode ? (
            <>
              <button
                type="button"
                onClick={handleRandomRecommend}
                className="rounded-full border border-white/25 bg-white/55 px-4 py-2 text-sm text-slate-700 transition hover:bg-white/80 dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-200 dark:hover:bg-slate-900/70"
              >
                换一批
              </button>
              <button
                type="button"
                onClick={handleExitRandomMode}
                className="rounded-full border border-white/25 bg-white/55 px-4 py-2 text-sm text-slate-700 transition hover:bg-white/80 dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-200 dark:hover:bg-slate-900/70"
              >
                退出随机
              </button>
            </>
          ) : null}
        </section>
        <section className="mb-6 flex flex-wrap items-center gap-3">
          {randomMode ? (
            <span className="text-sm text-violet-700 dark:text-violet-200">
              随机推荐 {visibleItems.length} 张素材（从素材库随机抽取）
            </span>
          ) : sortMode === "weeklyTop" ? (
            <span className="text-sm text-sky-700 dark:text-sky-200">
              周下载 TOP20{downloadWeekKey ? `（${downloadWeekKey}）` : ""}，显示 {visibleItems.length} 张
            </span>
          ) : (
            <>
              <span className="text-sm text-slate-500 dark:text-slate-300">每页</span>
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="rounded-full border border-white/25 bg-white/55 px-3 py-2 text-sm text-slate-700 outline-none dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-200"
              >
                {[16, 20, 40, 60, 100].map((size) => (
                  <option key={size} value={size}>
                    {size} 张
                  </option>
                ))}
              </select>
              <span className="text-sm text-slate-500 dark:text-slate-300">
                共 {totalItems} 张，{totalPages} 页
              </span>
            </>
          )}
        </section>

        {error || errorMessage ? (
          <div className="mb-4 rounded-xl border border-rose-300/60 bg-rose-100/70 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
            {error || errorMessage}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-2xl border border-white/20 bg-white/45 p-8 text-center text-slate-600 backdrop-blur dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-300">
            正在加载资源...
          </div>
        ) : null}

        {!loading ? (
          <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {visibleItems.map((resource) => (
              <ResourceCard
                key={resource.id}
                resource={resource}
                onDownload={handleDownload}
                onTransfer={handleTransfer}
                onPlay={handlePlay}
                onStopPlay={() => {
                  setPlayingResourceId(null);
                  setPlayingUrl("");
                }}
                onLike={handleLike}
                downloading={downloadingId === resource.id}
                transferring={transferringId === resource.id}
                playing={playingId === resource.id}
                isPlaying={playingResourceId === resource.id}
                playUrl={playingResourceId === resource.id ? playingUrl : ""}
                liking={likingId === resource.id}
                liked={likedIds.has(resource.id)}
                likeCount={likeCounts[resource.id] || 0}
                downloadCount={displayDownloadCount(totalDownloadCounts[resource.id] || 0)}
                weeklyDownloadCount={displayDownloadCount(weeklyDownloadCounts[resource.id] || 0)}
                showWeeklyDownloadCount={sortMode === "weeklyTop"}
              />
            ))}
          </section>
        ) : null}

        {!loading && visibleItems.length === 0 ? (
          <div className="mt-6 rounded-xl border border-white/30 bg-white/55 p-6 text-center text-slate-600 backdrop-blur dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-300">
            {randomMode ? "素材库暂无可推荐的素材。" : "没有匹配的资源，请尝试修改关键词或分类。"}
          </div>
        ) : null}

        {!loading && !randomMode && sortMode !== "weeklyTop" && totalItems > 0 ? (
          <section className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              className="rounded-full border border-white/25 bg-white/55 px-4 py-2 text-sm text-slate-700 transition hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-200 dark:hover:bg-slate-900/70"
            >
              上一页
            </button>
            {pageList.map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => setCurrentPage(page)}
                className={`rounded-full px-3 py-2 text-sm transition ${
                  currentPage === page
                    ? "bg-cyan-600 text-white"
                    : "border border-white/25 bg-white/55 text-slate-700 hover:bg-white/80 dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-200 dark:hover:bg-slate-900/70"
                }`}
              >
                {page}
              </button>
            ))}
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              className="rounded-full border border-white/25 bg-white/55 px-4 py-2 text-sm text-slate-700 transition hover:bg-white/80 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-200 dark:hover:bg-slate-900/70"
            >
              下一页
            </button>
          </section>
        ) : null}
        <SiteFooter />
      </div>
    </div>
  );
}
