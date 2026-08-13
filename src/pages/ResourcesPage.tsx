import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CategoryTabs } from "../components/CategoryTabs";
import { ResourceCard } from "../components/ResourceCard";
import { V1ProTransferNotice } from "../components/V1ProTransferNotice";
import { SearchBar } from "../components/SearchBar";
import { SitePageLayout } from "../components/SitePageLayout";
import { SitePageShell } from "../components/SitePageShell";
import { SiteFooter } from "../components/SiteFooter";
import { ResourceLibraryHeader } from "../components/ResourceLibraryHeader";
import { ResourceLibrarySidebar } from "../components/ResourceLibrarySidebar";
import { CompactResourceCard } from "../components/CompactResourceCard";
import { AlbumSelectionPanel } from "../components/AlbumSelectionPanel";
import { ResourceDetailModal } from "../components/ResourceDetailModal";
import { SiteFilterChip, SiteAlert } from "../components/SiteUi";
import { useImagePreload } from "../hooks/useImagePreload";
import { useThemeMode } from "../hooks/useThemeMode";
import { useResourceCatalog } from "../hooks/useResourceCatalog";
import { hasValidLocalAuth } from "../services/authService";
import { createDownloadUrl, prefetchPlayUrl } from "../services/downloadService";
import { fetchResourceDownloads, displayDownloadCount } from "../services/downloadStatsService";
import type { DownloadStatsSnapshot } from "../types/downloadStats";
import { createImageUrl } from "../services/imageService";
import { fetchResourceLikes, likeResource } from "../services/likeService";
import { fetchResourceFavorites, toggleResourceFavorite } from "../services/favoriteService";
import { fetchHiddenResourceState, setUploaderHidden } from "../services/hiddenResourceService";
import { isStaticMode } from "../services/runtimeMode";
import type { ResourceItem } from "../types/resource";
import {
  requiredFramesForResource,
  resourceMetricsFromCatalog,
  type DeviceFrameCapacity,
  type VideoFpsOption,
} from "../utils/resourceCapacity";
import { pickRandomItems } from "../utils/randomPick";
import {
  V1PRO_TRANSFER_LAUNCHED_MESSAGE,
  canTransferViaV1Pro,
  handleTransferButtonClick,
  prefetchTransferDownloadUrl,
} from "../services/v1proTransferService";
import {
  canWebUsbDirectTransfer,
  transferAlbumResourcesViaWebUsb,
  transferResourceViaWebUsb,
  type AlbumTransition,
} from "../services/v1proWebResourceTransferService";

const RANDOM_PAGE_SIZE = 4;
const WEEKLY_TOP_LIMIT = 20;
const DEFAULT_PAGE_SIZE = 16;

export default function ResourcesPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [transferringId, setTransferringId] = useState<number | null>(null);
  const [webUsbTransferringId, setWebUsbTransferringId] = useState<number | null>(null);
  const [transferNotice, setTransferNotice] = useState("");
  const [webUsbProgress, setWebUsbProgress] = useState<number | null>(null);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [playingResourceId, setPlayingResourceId] = useState<number | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string>("");
  const [likingId, setLikingId] = useState<number | null>(null);
  const [likeCounts, setLikeCounts] = useState<Record<number, number>>({});
  const [likedIds, setLikedIds] = useState<Set<number>>(new Set<number>());
  const [favoriteIds, setFavoriteIds] = useState<number[]>([]);
  const [favoritingId, setFavoritingId] = useState<number | null>(null);
  const [hiddenIds, setHiddenIds] = useState<number[]>([]);
  const [blockedUploaderCount, setBlockedUploaderCount] = useState(0);
  const [hidingId, setHidingId] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [totalDownloadCounts, setTotalDownloadCounts] = useState<Record<number, number>>({});
  const [weeklyDownloadCounts, setWeeklyDownloadCounts] = useState<Record<number, number>>({});
  const [downloadWeekKey, setDownloadWeekKey] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageJumpValue, setPageJumpValue] = useState("");
  const [randomMode, setRandomMode] = useState(false);
  const [randomItems, setRandomItems] = useState<ResourceItem[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [capacityFilter, setCapacityFilter] = useState<"all" | DeviceFrameCapacity>("all");
  const [selectedResource, setSelectedResource] = useState<ResourceItem | null>(null);
  const [albumMode, setAlbumMode] = useState(false);
  const [albumCapacity, setAlbumCapacity] = useState<DeviceFrameCapacity>(308);
  const [albumSelectedIds, setAlbumSelectedIds] = useState<number[]>([]);
  const [albumSwitchDelayMs, setAlbumSwitchDelayMs] = useState(2000);
  const [albumTransition, setAlbumTransition] = useState<AlbumTransition>("fade");
  const [albumTransferring, setAlbumTransferring] = useState(false);
  const [albumTransferStatus, setAlbumTransferStatus] = useState("");
  const { theme, setTheme } = useThemeMode();
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

  const hiddenIdSet = useMemo(() => new Set(hiddenIds), [hiddenIds]);
  const visibilityFilteredResources = useMemo(
    () => filtered.filter((resource) => showHidden === hiddenIdSet.has(resource.id)),
    [filtered, hiddenIdSet, showHidden]
  );
  const sortedResources = useMemo(() => {
    if (sortMode === "hot") {
      return [...visibilityFilteredResources].sort((a, b) => {
        const likeA = likeCounts[a.id] || 0;
        const likeB = likeCounts[b.id] || 0;
        if (likeA !== likeB) return likeB - likeA;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    }
    if (sortMode === "weeklyTop") {
      return [...visibilityFilteredResources]
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
    return visibilityFilteredResources;
  }, [visibilityFilteredResources, sortMode, likeCounts, weeklyDownloadCounts, totalDownloadCounts]);
  const capacityFilteredResources = useMemo(() => {
    if (capacityFilter === "all") return sortedResources;
    return sortedResources.filter((resource) => {
      const frames = requiredFramesForResource(resource, resourceMetricsFromCatalog(resource), 25);
      // Legacy catalog entries without indexed media metrics stay visible until
      // their detail dialog probes the file. New uploads can filter precisely.
      return frames == null || frames <= capacityFilter;
    });
  }, [capacityFilter, sortedResources]);
  const totalItems = capacityFilteredResources.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  useEffect(() => {
    setCurrentPage(1);
    setRandomMode(false);
    setRandomItems([]);
  }, [keyword, category, materialType, columnTag, sortMode, pageSize]);

  useEffect(() => {
    setCurrentPage(1);
    setRandomMode(false);
    setRandomItems([]);
    setAlbumMode(false);
    setAlbumSelectedIds([]);
  }, [showHidden]);

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
      return capacityFilteredResources;
    }
    const start = (currentPage - 1) * pageSize;
    return capacityFilteredResources.slice(start, start + pageSize);
  }, [randomMode, randomItems, sortMode, capacityFilteredResources, currentPage, pageSize]);

  const albumResources = useMemo(() => {
    const resourceMap = new Map(resources.map((resource) => [resource.id, resource]));
    return albumSelectedIds
      .map((resourceId) => resourceMap.get(resourceId))
      .filter((resource): resource is ResourceItem => Boolean(resource));
  }, [albumSelectedIds, resources]);

  const pageList = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages = new Set<number>([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
    return Array.from(pages)
      .filter((p) => p >= 1 && p <= totalPages)
      .sort((a, b) => a - b);
  }, [totalPages, currentPage]);

  const handleJumpToPage = () => {
    const parsed = Number.parseInt(pageJumpValue.trim(), 10);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const target = Math.min(totalPages, Math.max(1, parsed));
    setCurrentPage(target);
    setPageJumpValue(String(target));
  };

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
    if (!hasValidLocalAuth() || isStaticMode()) return;
    for (const item of visibleItems) {
      if (canTransferViaV1Pro(item)) {
        prefetchTransferDownloadUrl(item);
      }
    }
  }, [visibleItems]);

  useEffect(() => {
    let active = true;
    const loadLikes = (attempt = 0) => {
      fetchResourceLikes()
        .then((state) => {
          if (!active) return;
          setLikeCounts(state.counts);
          setLikedIds(state.likedIds);
        })
        .catch(() => {
          if (!active) return;
          if (attempt < 1) {
            window.setTimeout(() => loadLikes(attempt + 1), 800);
            return;
          }
          setErrorMessage((current) => current || "点赞数据加载失败，刷新页面后可重试");
        });
    };
    loadLikes();
    fetchResourceFavorites()
      .then((state) => {
        if (!active) return;
        setFavoriteIds(state.favoriteIds);
      })
      .catch(() => undefined);
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

  useEffect(() => {
    let active = true;
    fetchHiddenResourceState(resources)
      .then((state) => {
        if (!active) return;
        setHiddenIds(state.hiddenResourceIds);
        setBlockedUploaderCount(state.blockedUploaderCount);
      })
      .catch(() => {
        if (active) setErrorMessage((current) => current || "屏蔽列表加载失败，刷新页面后可重试");
      });
    return () => {
      active = false;
    };
  }, [resources]);

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

  const handleTransferPrepare = (resource: ResourceItem, options?: { urgent?: boolean }) => {
    prefetchTransferDownloadUrl(resource, options);
  };

  const handleWebUsbTransferPrepare = (_resource: ResourceItem, _options?: { urgent?: boolean }) => {
    // Blob 下载走同源 API，无需预取 COS 签名链接。
  };

  const handleWebUsbTransfer = (resource: ResourceItem, videoFps?: VideoFpsOption) => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    if (webUsbTransferringId !== null || albumTransferring) {
      return;
    }

    setErrorMessage("");
    setWebUsbTransferringId(resource.id);
    setWebUsbProgress(0);
    void transferResourceViaWebUsb(resource, {
      onStatus: (message) => setTransferNotice(message),
      onProgress: setWebUsbProgress,
    }, {
      videoFps: resource.materialType === "video" ? videoFps : undefined,
    })
      .then((result) => {
        let message = result.predictedFrameCount != null
          ? `网页直传完成：预计 ${result.predictedFrameCount} 帧 · 实际 ${result.frameCount} 帧${result.fps ? ` · ${result.fps}fps` : ""}`
          : `网页直传完成：${result.frameCount} 帧${result.fps ? ` · ${result.fps}fps` : ""}`;
        if (result.note) {
          message += `（${result.note}）`;
        }
        setTransferNotice(message);
        setWebUsbProgress(100);
        window.setTimeout(() => {
          setTransferNotice("");
          setWebUsbProgress(null);
        }, 6000);
      })
      .catch((err) => {
        setTransferNotice("");
        setWebUsbProgress(null);
        setErrorMessage((err as Error)?.message || "网页直传失败");
      })
      .finally(() => {
        setWebUsbTransferringId(null);
      });
  };

  const handleTransfer = (resource: ResourceItem) => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }

    setErrorMessage("");
    setWebUsbProgress(null);
    void handleTransferButtonClick(
      resource,
      {
        onLaunched: (result) => {
          applyDownloadStats(resource.id, result.stats);
          setTransferNotice(V1PRO_TRANSFER_LAUNCHED_MESSAGE);
          window.setTimeout(() => setTransferNotice(""), 5000);
        },
        onError: (message) => {
          setErrorMessage(message);
        },
        onPreparing: () => setTransferringId(resource.id),
        onPrepareEnd: () => setTransferringId(null),
      },
      { auto: true },
    );
  };

  const handleFavorite = async (resource: ResourceItem) => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    try {
      setFavoritingId(resource.id);
      setErrorMessage("");
      const result = await toggleResourceFavorite(resource.id);
      setFavoriteIds(result.state.favoriteIds);
    } catch (err) {
      const message = (err as Error)?.message || "收藏操作失败";
      setErrorMessage(message);
      if (message.includes("认证")) {
        navigate("/auth", { replace: true });
      }
    } finally {
      setFavoritingId(null);
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
      setLikeCounts((prev) => {
        const previous = prev[resource.id] || 0;
        const nextCount = result.alreadyLiked
          ? Math.max(result.likeCount, previous)
          : Math.max(result.likeCount, previous + 1);
        return { ...prev, [resource.id]: nextCount };
      });
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

  const handlePlay = async (resource: ResourceItem): Promise<string | void> => {
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
      return playResult.url;
    } catch (err) {
      const message = (err as Error)?.message || "播放链接生成失败";
      setErrorMessage(message);
      if (message.includes("认证")) {
        navigate("/auth", { replace: true });
      }
      throw err;
    } finally {
      setPlayingId(null);
    }
  };

  const handlePlayPrepare = (resource: ResourceItem) => {
    if (resource.materialType !== "video" && resource.materialType !== "gif") return;
    if (!hasValidLocalAuth()) return;
    prefetchPlayUrl(resource.id, resource.download);
  };

  const handleHiddenChange = async (resource: ResourceItem, hidden: boolean) => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    try {
      setHidingId(resource.id);
      setErrorMessage("");
      setStatusMessage("");
      const state = await setUploaderHidden(resource, hidden, resources);
      setHiddenIds(state.hiddenResourceIds);
      setBlockedUploaderCount(state.blockedUploaderCount);
      setRandomMode(false);
      setRandomItems([]);
      setAlbumSelectedIds((current) => current.filter((id) => id !== resource.id));
      setSelectedResource((current) => current?.id === resource.id ? null : current);
      setStatusMessage(hidden
        ? `已为当前设备屏蔽“${resource.author || "该用户"}”上传的全部素材`
        : `已恢复“${resource.author || "该用户"}”上传的全部素材`);
    } catch (err) {
      const message = (err as Error)?.message || "屏蔽设置失败";
      setErrorMessage(message);
      if (message.includes("认证")) navigate("/auth", { replace: true });
    } finally {
      setHidingId(null);
    }
  };

  const toggleAlbumMode = () => {
    if (albumTransferring) return;
    setAlbumMode((current) => {
      if (current) {
        setAlbumSelectedIds([]);
        setAlbumTransferStatus("");
        return false;
      }
      if (capacityFilter !== "all") {
        setAlbumCapacity(capacityFilter);
      }
      setMaterialType("image");
      setSelectedResource(null);
      setAlbumTransferStatus("");
      return true;
    });
  };

  const toggleAlbumResource = (resource: ResourceItem) => {
    if (albumTransferring) return;
    if (resource.materialType !== "image") {
      setErrorMessage("相册模式目前仅支持图片素材");
      return;
    }
    setErrorMessage("");
    setAlbumTransferStatus("");
    setAlbumSelectedIds((current) => (
      current.includes(resource.id)
        ? current.filter((resourceId) => resourceId !== resource.id)
        : [...current, resource.id]
    ));
  };

  const closeAlbumMode = () => {
    if (albumTransferring) return;
    setAlbumMode(false);
    setAlbumSelectedIds([]);
    setAlbumTransferStatus("");
  };

  const handleAlbumTransfer = () => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    if (albumTransferring || webUsbTransferringId !== null) return;
    if (albumResources.length === 0) {
      setErrorMessage("请先选择要写入相册的图片");
      return;
    }

    setErrorMessage("");
    setAlbumTransferStatus("正在准备图片相册…");
    setAlbumTransferring(true);
    setWebUsbProgress(0);
    void transferAlbumResourcesViaWebUsb(
      albumResources,
      {
        onStatus: (message) => setAlbumTransferStatus(message),
        onProgress: setWebUsbProgress,
      },
      {
        targetFrameCapacity: albumCapacity,
        switchDelayMs: albumSwitchDelayMs,
        transition: albumTransition,
      },
    )
      .then((result) => {
        setWebUsbProgress(100);
        setAlbumTransferStatus(result.note || `相册传输完成：${result.frameCount} 帧`);
      })
      .catch((err) => {
        setWebUsbProgress(null);
        setAlbumTransferStatus("");
        setErrorMessage((err as Error)?.message || "相册网页直传失败");
      })
      .finally(() => {
        setAlbumTransferring(false);
      });
  };

  return (
    <div className="site-page-shell resource-library-shell min-h-screen text-[#2b3245]">
      <V1ProTransferNotice message={webUsbProgress == null ? transferNotice : ""} onDismiss={() => setTransferNotice("")} />
      <ResourceLibraryHeader
        keyword={keyword}
        onSearch={(value) => {
          setKeyword(value);
          setCurrentPage(1);
        }}
      />
      <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">
        <details className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 lg:hidden dark:border-slate-800 dark:bg-slate-900">
          <summary className="cursor-pointer font-semibold">筛选素材</summary>
          <div className="mt-4">
            <ResourceLibrarySidebar
              resources={resources}
              materialType={materialType}
              onMaterialType={setMaterialType}
              capacity={capacityFilter}
              onCapacity={setCapacityFilter}
              sortMode={randomMode ? "random" : sortMode}
              onSortMode={(value) => {
                if (value === "random") handleRandomRecommend();
                else {
                  handleExitRandomMode();
                  setSortMode(value);
                }
              }}
              columnTag={columnTag}
              onColumnTag={setColumnTag}
              columnOptions={columnTagFilterOptions}
            />
          </div>
        </details>

        <div className={`grid items-start gap-6 lg:grid-cols-[218px_minmax(0,1fr)] ${albumMode ? "xl:grid-cols-[218px_minmax(0,1fr)_280px]" : ""}`}>
          <div className="hidden lg:sticky lg:top-[84px] lg:block">
            <ResourceLibrarySidebar
              resources={resources}
              materialType={materialType}
              onMaterialType={setMaterialType}
              capacity={capacityFilter}
              onCapacity={setCapacityFilter}
              sortMode={randomMode ? "random" : sortMode}
              onSortMode={(value) => {
                if (value === "random") handleRandomRecommend();
                else {
                  handleExitRandomMode();
                  setSortMode(value);
                }
              }}
              columnTag={columnTag}
              onColumnTag={setColumnTag}
              columnOptions={columnTagFilterOptions}
            />
          </div>

          <div className="min-w-0">
            <div className="mb-[18px] flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-400">
                共 <strong className="text-lg text-slate-700 dark:text-slate-200">{totalItems}</strong> 张，{totalPages} 页 · 每页
                <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="ml-1 rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
                  {[16, 20, 40, 60, 100].map((size) => <option key={size} value={size}>{size} 张</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowHidden((current) => !current)}
                  aria-pressed={showHidden}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                    showHidden
                      ? "border-violet-300 bg-violet-50 text-violet-600 shadow-sm dark:border-violet-500/50 dark:bg-violet-500/15 dark:text-violet-300"
                      : "border-slate-200 bg-white text-slate-500 hover:border-violet-200 hover:text-violet-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  }`}
                >
                  <span aria-hidden="true">⊘</span>
                  {showHidden ? "返回素材库" : `已屏蔽用户 ${blockedUploaderCount}`}
                </button>
                <button
                  type="button"
                  onClick={toggleAlbumMode}
                  aria-pressed={albumMode}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                    albumMode
                      ? "border-[#ff8a5c] bg-[#fff2ec] text-[#ff7448] shadow-sm dark:bg-orange-500/15"
                      : "border-slate-200 bg-white text-slate-500 hover:border-orange-200 hover:text-[#ff7448] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  }`}
                >
                  <span aria-hidden="true">▦</span>
                  {albumMode ? `相册模式 · ${albumSelectedIds.length}` : "相册模式"}
                </button>
                <select
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as typeof sortMode)}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-500 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  <option value="latest">最新优先</option>
                  <option value="earliest">最早优先</option>
                  <option value="hot">热门排行</option>
                  <option value="weeklyTop">周下载 TOP20</option>
                </select>
              </div>
            </div>

            {error || errorMessage ? <SiteAlert variant="error" className="mb-5">{error || errorMessage}</SiteAlert> : null}
            {statusMessage ? <SiteAlert variant="success" className="mb-5">{statusMessage}</SiteAlert> : null}
            {loading ? <div className="rounded-2xl bg-white p-10 text-center text-slate-400 dark:bg-slate-900">正在加载素材…</div> : null}
            {!loading ? (
              <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {visibleItems.map((resource) => (
                  <CompactResourceCard
                    key={resource.id}
                    resource={resource}
                    downloadCount={displayDownloadCount(totalDownloadCounts[resource.id] || 0)}
                    likeCount={likeCounts[resource.id] || 0}
                    liked={likedIds.has(resource.id)}
                    liking={likingId === resource.id}
                    favorited={favoriteIds.includes(resource.id)}
                    favoriting={favoritingId === resource.id}
                    onOpen={setSelectedResource}
                    onLike={(item) => void handleLike(item)}
                    onFavorite={(item) => void handleFavorite(item)}
                    hidden={hiddenIdSet.has(resource.id)}
                    hiding={hidingId === resource.id}
                    onHiddenChange={resource.uploaderBlockable
                      ? (item, hidden) => void handleHiddenChange(item, hidden)
                      : undefined}
                    selectionMode={albumMode}
                    selected={albumSelectedIds.includes(resource.id)}
                    onToggleSelection={toggleAlbumResource}
                  />
                ))}
              </section>
            ) : null}
            {!loading && visibleItems.length === 0 ? (
              <div className="rounded-2xl bg-white p-10 text-center text-slate-400 dark:bg-slate-900">
                {showHidden ? "当前设备没有已屏蔽素材。" : "没有匹配的素材，请调整筛选条件。"}
              </div>
            ) : null}

            {!loading && !randomMode && sortMode !== "weeklyTop" && totalItems > 0 ? (
              <nav className="mt-8 flex flex-wrap items-center justify-center gap-2" aria-label="素材分页">
                <button type="button" disabled={currentPage <= 1} onClick={() => setCurrentPage((value) => Math.max(1, value - 1))} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900">上一页</button>
                {pageList.map((page) => (
                  <button key={page} type="button" onClick={() => setCurrentPage(page)} className={`h-9 min-w-9 rounded-full px-3 text-sm ${currentPage === page ? "bg-orange-500 text-white" : "border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"}`}>{page}</button>
                ))}
                <button type="button" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((value) => Math.min(totalPages, value + 1))} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900">下一页</button>
              </nav>
            ) : null}

            {albumMode ? (
              <AlbumSelectionPanel
                resources={albumResources}
                capacity={albumCapacity}
                onCapacityChange={setAlbumCapacity}
                onRemove={(resourceId) => setAlbumSelectedIds((current) => current.filter((id) => id !== resourceId))}
                onClear={() => setAlbumSelectedIds([])}
                onClose={closeAlbumMode}
                switchDelayMs={albumSwitchDelayMs}
                onSwitchDelayChange={setAlbumSwitchDelayMs}
                transition={albumTransition}
                onTransitionChange={setAlbumTransition}
                onTransfer={handleAlbumTransfer}
                transferring={albumTransferring}
                transferProgress={albumTransferring || webUsbProgress === 100 ? webUsbProgress : null}
                transferStatus={albumTransferStatus}
                className="mt-6 xl:hidden"
              />
            ) : null}
          </div>

          {albumMode ? (
            <div className="hidden xl:sticky xl:top-[84px] xl:block">
              <AlbumSelectionPanel
                resources={albumResources}
                capacity={albumCapacity}
                onCapacityChange={setAlbumCapacity}
                onRemove={(resourceId) => setAlbumSelectedIds((current) => current.filter((id) => id !== resourceId))}
                onClear={() => setAlbumSelectedIds([])}
                onClose={closeAlbumMode}
                switchDelayMs={albumSwitchDelayMs}
                onSwitchDelayChange={setAlbumSwitchDelayMs}
                transition={albumTransition}
                onTransitionChange={setAlbumTransition}
                onTransfer={handleAlbumTransfer}
                transferring={albumTransferring}
                transferProgress={albumTransferring || webUsbProgress === 100 ? webUsbProgress : null}
                transferStatus={albumTransferStatus}
              />
            </div>
          ) : null}
        </div>
      </main>
      <SiteFooter />
      {selectedResource ? (
        <ResourceDetailModal
          resource={selectedResource}
          downloadCount={displayDownloadCount(totalDownloadCounts[selectedResource.id] || 0)}
          transferring={transferringId === selectedResource.id}
          webUsbTransferring={webUsbTransferringId === selectedResource.id}
          webUsbProgress={webUsbTransferringId === selectedResource.id || webUsbProgress === 100 ? webUsbProgress : null}
          transferMessage={transferNotice}
          onClose={() => setSelectedResource(null)}
          onTransfer={handleTransfer}
          onWebUsbTransfer={handleWebUsbTransfer}
        />
      ) : null}
    </div>
  );
}
