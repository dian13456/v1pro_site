import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { V1ProTransferNotice } from "../components/V1ProTransferNotice";
import { SiteFooter } from "../components/SiteFooter";
import { ResourceLibraryHeader } from "../components/ResourceLibraryHeader";
import { ResourceLibrarySidebar } from "../components/ResourceLibrarySidebar";
import { CompactResourceCard, CompactResourceCardSkeleton } from "../components/CompactResourceCard";
import { AlbumSelectionPanel } from "../components/AlbumSelectionPanel";
import { DeviceAuthenticationDialog } from "../components/DeviceAuthenticationDialog";
import { ResourceDetailModal, type ResourceWebUsbTransferOptions } from "../components/ResourceDetailModal";
import { SiteAlert } from "../components/SiteUi";
import { useImagePreload } from "../hooks/useImagePreload";
import { useResourceCatalog } from "../hooks/useResourceCatalog";
import { hasValidLocalAuth } from "../services/authService";
import { fetchResourceDownloads, displayDownloadCount } from "../services/downloadStatsService";
import type { DownloadStatsSnapshot } from "../types/downloadStats";
import { fetchResourceLikes, likeResource } from "../services/likeService";
import { fetchResourceFavorites, toggleResourceFavorite } from "../services/favoriteService";
import { fetchHiddenResourceState, setUploaderHidden } from "../services/hiddenResourceService";
import { fetchUploaderFollows, setUploaderFollowed } from "../services/followService";
import {
  fetchResourceRecommendations,
  recordResourceInteraction,
  type ResourceRecommendation,
} from "../services/recommendationService";
import { isStaticMode } from "../services/runtimeMode";
import type { ResourceItem } from "../types/resource";
import {
  requiredFramesForResource,
  resourceMetricsFromCatalog,
  type DeviceFrameCapacity,
} from "../utils/resourceCapacity";
import { pickRandomItems } from "../utils/randomPick";
import {
  V1PRO_TRANSFER_LAUNCHED_MESSAGE,
  canTransferViaV1Pro,
  handleTransferButtonClick,
  prefetchTransferDownloadUrl,
} from "../services/v1proTransferService";
import {
  transferAlbumResourcesViaWebUsb,
  transferResourceViaWebUsb,
  type AlbumTransition,
} from "../services/v1proWebResourceTransferService";
import {
  beginTransferTask,
  completeTransferTask,
  failTransferTask,
  updateTransferTask,
} from "../services/transferTaskStore";

const RANDOM_PAGE_SIZE = 4;
const WEEKLY_TOP_LIMIT = 20;
const DEFAULT_PAGE_SIZE = 16;
const RECOMMENDATION_FETCH_SIZE = 64;
const RECENT_RECOMMENDATIONS_KEY = "jiadian_recent_recommendations_v2";
const CURRENT_DEVICE_NOT_FOUND_PATTERN = /^未找到当前认证的 V1PRO（SN .+），请重新认证该设备$/;

function readRecentRecommendationIds(): number[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(RECENT_RECOMMENDATIONS_KEY) || "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is number => Number.isSafeInteger(id) && id > 0).slice(0, 96)
      : [];
  } catch {
    return [];
  }
}

function rememberRecommendationIds(ids: number[]): void {
  const recent = readRecentRecommendationIds();
  const merged = Array.from(new Set([...ids, ...recent])).slice(0, 96);
  sessionStorage.setItem(RECENT_RECOMMENDATIONS_KEY, JSON.stringify(merged));
}

function newRecommendationSeed(): string {
  const bytes = new Uint32Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(8, "0")).join("");
}

function fallbackRecommendationRank(resourceId: number, seed: string): number {
  let hash = 2166136261;
  const input = `${seed}:${resourceId}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export default function ResourcesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [transferringId, setTransferringId] = useState<number | null>(null);
  const [webUsbTransferringId, setWebUsbTransferringId] = useState<number | null>(null);
  const [transferNotice, setTransferNotice] = useState("");
  const [webUsbProgress, setWebUsbProgress] = useState<number | null>(null);
  const [likingId, setLikingId] = useState<number | null>(null);
  const [likeCounts, setLikeCounts] = useState<Record<number, number>>({});
  const [likedIds, setLikedIds] = useState<Set<number>>(new Set<number>());
  const [favoriteIds, setFavoriteIds] = useState<number[]>([]);
  const [favoritingId, setFavoritingId] = useState<number | null>(null);
  const [hiddenIds, setHiddenIds] = useState<number[]>([]);
  const [blockedUploaderCount, setBlockedUploaderCount] = useState(0);
  const [hidingId, setHidingId] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [followedIds, setFollowedIds] = useState<number[]>([]);
  const [ownResourceIds, setOwnResourceIds] = useState<number[]>([]);
  const [followedUploaderCount, setFollowedUploaderCount] = useState(0);
  const [followingId, setFollowingId] = useState<number | null>(null);
  const [followingOnly, setFollowingOnly] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [totalDownloadCounts, setTotalDownloadCounts] = useState<Record<number, number>>({});
  const [weeklyDownloadCounts, setWeeklyDownloadCounts] = useState<Record<number, number>>({});
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [randomMode, setRandomMode] = useState(false);
  const [randomItems, setRandomItems] = useState<ResourceItem[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [deviceAuthErrorMessage, setDeviceAuthErrorMessage] = useState("");
  const [capacityFilter, setCapacityFilter] = useState<"all" | DeviceFrameCapacity>("all");
  const [selectedResource, setSelectedResource] = useState<ResourceItem | null>(null);
  const [albumMode, setAlbumMode] = useState(false);
  const [albumCapacity, setAlbumCapacity] = useState<DeviceFrameCapacity>(308);
  const [albumSelectedIds, setAlbumSelectedIds] = useState<number[]>([]);
  const [albumSwitchDelayMs, setAlbumSwitchDelayMs] = useState(2000);
  const [albumTransition, setAlbumTransition] = useState<AlbumTransition>("fade");
  const [albumTransferring, setAlbumTransferring] = useState(false);
  const [albumTransferStatus, setAlbumTransferStatus] = useState("");
  const [recommendationItems, setRecommendationItems] = useState<ResourceRecommendation[]>([]);
  const [recommendationResources, setRecommendationResources] = useState<ResourceItem[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(true);
  const [recommendationRefreshKey, setRecommendationRefreshKey] = useState(0);
  const {
    resources,
    filtered,
    loading,
    error,
    keyword,
    setKeyword,
    category,
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
  const followedIdSet = useMemo(() => new Set(followedIds), [followedIds]);
  const ownResourceIdSet = useMemo(() => new Set(ownResourceIds), [ownResourceIds]);
  const visibilityFilteredResources = useMemo(
    () => filtered.filter((resource) => {
      if (showHidden) return hiddenIdSet.has(resource.id);
      if (hiddenIdSet.has(resource.id)) return false;
      return !followingOnly || followedIdSet.has(resource.id);
    }),
    [filtered, followedIdSet, followingOnly, hiddenIdSet, showHidden]
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
    setRandomMode(false);
    setRandomItems([]);
  }, [keyword, category, materialType, columnTag, sortMode, pageSize]);

  useEffect(() => {
    setRandomMode(false);
    setRandomItems([]);
    setAlbumMode(false);
    setAlbumSelectedIds([]);
  }, [showHidden, followingOnly]);

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
    const catalogPage = Math.max(1, currentPage);
    const start = (catalogPage - 1) * pageSize;
    return capacityFilteredResources.slice(start, start + pageSize);
  }, [randomMode, randomItems, sortMode, capacityFilteredResources, currentPage, pageSize]);

  const albumResources = useMemo(() => {
    const resourceMap = new Map(resources.map((resource) => [resource.id, resource]));
    return albumSelectedIds
      .map((resourceId) => resourceMap.get(resourceId))
      .filter((resource): resource is ResourceItem => Boolean(resource));
  }, [albumSelectedIds, resources]);

  const fallbackRecommendationResources = useMemo(() => {
    const eligible = resources.filter((resource) =>
      resource.category === "gif" &&
      (resource.materialType === "image" || resource.materialType === "video" || resource.materialType === "gif") &&
      !hiddenIdSet.has(resource.id)
    );
    const recentIds = new Set(readRecentRecommendationIds());
    const unseen = eligible.filter((resource) => !recentIds.has(resource.id));
    const seed = `${location.key}:${recommendationRefreshKey}`;
    return [...(unseen.length >= DEFAULT_PAGE_SIZE ? unseen : eligible)]
      .sort((left, right) => fallbackRecommendationRank(left.id, seed) - fallbackRecommendationRank(right.id, seed))
      .slice(0, DEFAULT_PAGE_SIZE);
  }, [hiddenIdSet, location.key, recommendationRefreshKey, resources]);

  const recommendedResources = useMemo(() => {
    const resourceMap = new Map(
      [...recommendationResources, ...resources].map((resource) => [resource.id, resource])
    );
    const personalized = recommendationItems
      .map((recommendation) => resourceMap.get(recommendation.resourceId))
      .filter((resource): resource is ResourceItem => resource !== undefined && !hiddenIdSet.has(resource.id))
      .slice(0, DEFAULT_PAGE_SIZE);
    return personalized.length > 0 ? personalized : fallbackRecommendationResources;
  }, [fallbackRecommendationResources, hiddenIdSet, recommendationItems, recommendationResources, resources]);

  useEffect(() => {
    if (recommendationsLoading || recommendationItems.length > 0 || fallbackRecommendationResources.length === 0) {
      return;
    }
    rememberRecommendationIds(fallbackRecommendationResources.map((resource) => resource.id));
  }, [fallbackRecommendationResources, recommendationItems.length, recommendationsLoading]);

  const showingRecommendations =
    !showHidden &&
    !albumMode &&
    !randomMode &&
    currentPage === 0;
  const displayedItems = showingRecommendations ? recommendedResources : visibleItems;
  const canRenderCards = showingRecommendations ? !recommendationsLoading : !loading;
  const showInitialLoader = !canRenderCards;
  const displayedTotalItems = currentPage === 0 ? recommendedResources.length : totalItems;
  const displayedTotalPages = currentPage === 0 ? 1 : totalPages;

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
        ? displayedItems
            .slice(0, Math.min(displayedItems.length + 6, 26))
            .map((item) => item.image)
            .filter((url) => /^https?:\/\//i.test(url))
        : [],
    [displayedItems]
  );
  useImagePreload(preloadList);

  useEffect(() => {
    if (!hasValidLocalAuth() || isStaticMode()) return;
    for (const item of displayedItems) {
      if (canTransferViaV1Pro(item)) {
        prefetchTransferDownloadUrl(item);
      }
    }
  }, [displayedItems]);

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
      })
      .catch(() => {
        // Ignore download stats init errors.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (resources.length === 0) return;
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

  useEffect(() => {
    if (resources.length === 0) return;
    let active = true;
    fetchUploaderFollows(resources)
      .then((state) => {
        if (!active) return;
        setFollowedIds(state.followedResourceIds);
        setOwnResourceIds(state.ownResourceIds);
        setFollowedUploaderCount(state.followedUploaderCount);
      })
      .catch(() => {
        if (active) setErrorMessage((current) => current || "关注列表加载失败，刷新页面后可重试");
      });
    return () => {
      active = false;
    };
  }, [resources]);

  useEffect(() => {
    if (!hasValidLocalAuth() || isStaticMode()) {
      setRecommendationsLoading(false);
      return;
    }
    let active = true;
    setRecommendationsLoading(true);
    fetchResourceRecommendations(RECOMMENDATION_FETCH_SIZE, {
      seed: newRecommendationSeed(),
      excludeIds: readRecentRecommendationIds(),
    })
      .then((result) => {
        if (!active) return;
        setRecommendationItems(result.items);
        setRecommendationResources(result.resources);
        rememberRecommendationIds(result.items.slice(0, DEFAULT_PAGE_SIZE).map((item) => item.resourceId));
      })
      .catch(() => {
        if (active) setRecommendationItems([]);
        if (active) setRecommendationResources([]);
      })
      .finally(() => {
        if (active) setRecommendationsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [location.key, recommendationRefreshKey]);

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
    setErrorMessage("");
  };

  const handleRecommendationHome = () => {
    setCurrentPage(0);
    setRandomMode(false);
    setRandomItems([]);
    setShowHidden(false);
    setFollowingOnly(false);
    setAlbumMode(false);
    setAlbumSelectedIds([]);
  };

  const handleExitRandomMode = () => {
    setRandomMode(false);
    setRandomItems([]);
    setCurrentPage(1);
  };

  const handleDiscoverySection = (section: "recommend" | "latest" | "following" | "hot") => {
    setErrorMessage("");
    setShowHidden(false);
    setAlbumMode(false);
    setAlbumSelectedIds([]);
    if (section === "recommend") {
      handleRecommendationHome();
      return;
    }
    setRandomMode(false);
    setRandomItems([]);
    setCurrentPage(1);
    if (section === "following") {
      setFollowingOnly(true);
      return;
    }
    setFollowingOnly(false);
    setSortMode(section);
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
  };

  const showResourceError = (message: string) => {
    setErrorMessage(message);
    if (CURRENT_DEVICE_NOT_FOUND_PATTERN.test(message)) {
      setDeviceAuthErrorMessage(message);
    }
  };

  const handleOpenResource = (resource: ResourceItem) => {
    setSelectedResource(resource);
    void recordResourceInteraction(resource.id, "view").catch(() => undefined);
  };

  const handleWebUsbTransfer = (resource: ResourceItem, options: ResourceWebUsbTransferOptions) => {
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
    beginTransferTask(`网页直传 · ${resource.title || resource.description || "未命名素材"}`);
    void transferResourceViaWebUsb(resource, {
      onStatus: (message) => {
        setTransferNotice(message);
        updateTransferTask({ message });
      },
      onProgress: (progress) => {
        setWebUsbProgress(progress);
        updateTransferTask({ progress });
      },
    }, {
      videoFps: resource.materialType === "video" ? options.videoFps : undefined,
      fitMode: options.fitMode,
      rotationDeg: options.rotationDeg,
      colorProfile: options.colorProfile,
    })
      .then((result) => {
        let message = result.predictedFrameCount != null
          ? `网页直传完成：预计 ${result.predictedFrameCount} 帧 · 实际 ${result.frameCount} 帧${result.fps ? ` · ${result.fps}fps` : ""}`
          : `网页直传完成：${result.frameCount} 帧${result.fps ? ` · ${result.fps}fps` : ""}`;
        if (result.note) {
          message += `（${result.note}）`;
        }
        setTransferNotice(message);
        completeTransferTask(message);
        void recordResourceInteraction(resource.id, "transfer").catch(() => undefined);
        setWebUsbProgress(100);
        window.setTimeout(() => {
          setTransferNotice("");
          setWebUsbProgress(null);
        }, 6000);
      })
      .catch((err) => {
        const message = (err as Error)?.message || "网页直传失败";
        setTransferNotice("");
        setWebUsbProgress(null);
        failTransferTask(message);
        showResourceError(message);
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
          void recordResourceInteraction(resource.id, "transfer").catch(() => undefined);
          window.setTimeout(() => setTransferNotice(""), 5000);
        },
        onError: (message) => {
          showResourceError(message);
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

  const handleFollowChange = async (resource: ResourceItem, followed: boolean) => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    try {
      setFollowingId(resource.id);
      setErrorMessage("");
      setStatusMessage("");
      const result = await setUploaderFollowed(resource, followed, resources);
      setFollowedIds(result.state.followedResourceIds);
      setOwnResourceIds(result.state.ownResourceIds);
      setFollowedUploaderCount(result.state.followedUploaderCount);
      setStatusMessage(result.followed
        ? `已关注“${resource.author || "该上传者"}”`
        : `已取消关注“${resource.author || "该上传者"}”`);
    } catch (err) {
      const message = (err as Error)?.message || "关注操作失败";
      setErrorMessage(message);
      if (message.includes("认证")) navigate("/auth", { replace: true });
    } finally {
      setFollowingId(null);
    }
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
      setCurrentPage(1);
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
    beginTransferTask(`图片相册 · ${albumResources.length} 张素材`, "正在准备图片相册…");
    void transferAlbumResourcesViaWebUsb(
      albumResources,
      {
        onStatus: (message) => {
          setAlbumTransferStatus(message);
          updateTransferTask({ message });
        },
        onProgress: (progress) => {
          setWebUsbProgress(progress);
          updateTransferTask({ progress });
        },
      },
      {
        targetFrameCapacity: albumCapacity,
        switchDelayMs: albumSwitchDelayMs,
        transition: albumTransition,
      },
    )
      .then((result) => {
        const message = result.note || `相册传输完成：${result.frameCount} 帧`;
        setWebUsbProgress(100);
        setAlbumTransferStatus(message);
        completeTransferTask(message);
      })
      .catch((err) => {
        const message = (err as Error)?.message || "相册网页直传失败";
        setWebUsbProgress(null);
        setAlbumTransferStatus("");
        failTransferTask(message);
        showResourceError(message);
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
      <main className="mx-auto max-w-[1488px] px-4 py-6 sm:px-6">
        <details className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 lg:hidden dark:border-slate-800 dark:bg-slate-900">
          <summary className="cursor-pointer font-semibold">筛选素材</summary>
          <div className="mt-4">
            <ResourceLibrarySidebar
              resources={resources}
              materialType={materialType}
              onMaterialType={(value) => {
                setCurrentPage(1);
                setMaterialType(value);
              }}
              capacity={capacityFilter}
              onCapacity={(value) => {
                setCurrentPage(1);
                setCapacityFilter(value);
              }}
              showSortOptions={currentPage !== 0}
              sortMode={followingOnly ? "following" : randomMode ? "random" : sortMode}
              onSortMode={(value) => {
                if (value === "following") {
                  handleExitRandomMode();
                  setShowHidden(false);
                  setFollowingOnly(true);
                } else if (value === "random") {
                  setFollowingOnly(false);
                  handleRandomRecommend();
                }
                else {
                  setFollowingOnly(false);
                  handleExitRandomMode();
                  setCurrentPage(1);
                  setSortMode(value);
                }
              }}
              followedUploaderCount={followedUploaderCount}
              columnTag={columnTag}
              onColumnTag={(value) => {
                setCurrentPage(1);
                setColumnTag(value);
              }}
              columnOptions={columnTagFilterOptions}
            />
          </div>
        </details>

        <div className={`grid items-start gap-6 lg:grid-cols-[218px_minmax(0,1fr)] ${albumMode ? "xl:grid-cols-[218px_minmax(0,1fr)_280px]" : ""}`}>
          <div className="resource-sidebar-scroll hidden self-start lg:sticky lg:top-[80px] lg:block lg:max-h-[calc(100vh-96px)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
            <ResourceLibrarySidebar
              resources={resources}
              materialType={materialType}
              onMaterialType={(value) => {
                setCurrentPage(1);
                setMaterialType(value);
              }}
              capacity={capacityFilter}
              onCapacity={(value) => {
                setCurrentPage(1);
                setCapacityFilter(value);
              }}
              showSortOptions={currentPage !== 0}
              sortMode={followingOnly ? "following" : randomMode ? "random" : sortMode}
              onSortMode={(value) => {
                if (value === "following") {
                  handleExitRandomMode();
                  setShowHidden(false);
                  setFollowingOnly(true);
                } else if (value === "random") {
                  setFollowingOnly(false);
                  handleRandomRecommend();
                }
                else {
                  setFollowingOnly(false);
                  handleExitRandomMode();
                  setCurrentPage(1);
                  setSortMode(value);
                }
              }}
              followedUploaderCount={followedUploaderCount}
              columnTag={columnTag}
              onColumnTag={(value) => {
                setCurrentPage(1);
                setColumnTag(value);
              }}
              columnOptions={columnTagFilterOptions}
            />
          </div>

          <div className="min-w-0">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <nav className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-black/[.055] bg-white/65 p-1 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/[.055]" aria-label="素材发现栏目">
                {([
                  ["recommend", "为你推荐"],
                  ["latest", "最新上传"],
                  ["following", "关注动态"],
                  ["hot", "热门排行"],
                ] as const).map(([value, label]) => {
                  const active = value === "recommend"
                    ? showingRecommendations
                    : value === "following"
                      ? followingOnly && !showHidden
                      : !showingRecommendations && !followingOnly && !showHidden && sortMode === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleDiscoverySection(value)}
                      className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
                        active
                          ? "bg-[#0071e3] text-white shadow-[0_5px_14px_rgba(0,113,227,.22)]"
                          : "text-slate-500 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </nav>
              {showingRecommendations ? (
                <button
                  type="button"
                  disabled={recommendationsLoading}
                  onClick={() => setRecommendationRefreshKey((value) => value + 1)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-black/[.06] bg-white/70 px-3.5 py-2 text-sm font-medium text-[#0071e3] shadow-sm transition hover:-translate-y-0.5 hover:bg-white disabled:cursor-wait disabled:opacity-60 dark:border-white/10 dark:bg-white/[.055] dark:text-sky-300"
                  aria-label="刷新推荐素材"
                >
                  <span aria-hidden="true">↻</span>
                  {recommendationsLoading ? "刷新中…" : "换一批"}
                </button>
              ) : null}
            </div>
            <div className="mb-[18px] flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-400">
                共 <strong className="text-lg text-slate-700 dark:text-slate-200">{displayedTotalItems}</strong> 张，{displayedTotalPages} 页
                {currentPage !== 0 ? (
                  <>
                    <span> · 每页</span>
                    <select value={pageSize} onChange={(event) => {
                      setCurrentPage(1);
                      setPageSize(Number(event.target.value));
                    }} className="ml-1 rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-700 dark:bg-slate-900">
                      {[16, 20, 40, 60, 100].map((size) => <option key={size} value={size}>{size} 张</option>)}
                    </select>
                  </>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentPage(1);
                    setFollowingOnly(false);
                    setShowHidden((current) => !current);
                  }}
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
                {currentPage !== 0 ? (
                  <select
                    value={sortMode}
                    onChange={(event) => {
                      setCurrentPage(1);
                      setFollowingOnly(false);
                      setSortMode(event.target.value as typeof sortMode);
                    }}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-500 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    <option value="latest">最新优先</option>
                    <option value="earliest">最早优先</option>
                    <option value="hot">热门排行</option>
                    <option value="weeklyTop">周下载 TOP20</option>
                  </select>
                ) : null}
              </div>
            </div>

            {error || errorMessage ? <SiteAlert variant="error" className="mb-5">{error || errorMessage}</SiteAlert> : null}
            {statusMessage ? <SiteAlert variant="success" className="mb-5">{statusMessage}</SiteAlert> : null}
            {showInitialLoader ? (
              <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label={recommendationsLoading ? "正在加载推荐素材" : "正在加载素材"}>
                {Array.from({ length: 8 }, (_, index) => <CompactResourceCardSkeleton key={index} />)}
              </section>
            ) : null}
            {canRenderCards ? (
              <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {displayedItems.map((resource) => (
                  <CompactResourceCard
                    key={resource.id}
                    resource={resource}
                    downloadCount={displayDownloadCount(totalDownloadCounts[resource.id] || 0)}
                    likeCount={likeCounts[resource.id] || 0}
                    liked={likedIds.has(resource.id)}
                    liking={likingId === resource.id}
                    favorited={favoriteIds.includes(resource.id)}
                    favoriting={favoritingId === resource.id}
                    onOpen={handleOpenResource}
                    onLike={(item) => void handleLike(item)}
                    onFavorite={(item) => void handleFavorite(item)}
                    followed={followedIdSet.has(resource.id)}
                    following={followingId === resource.id}
                    onFollow={resource.uploaderBlockable && !ownResourceIdSet.has(resource.id)
                      ? (item, followed) => void handleFollowChange(item, followed)
                      : undefined}
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
            {canRenderCards && displayedItems.length === 0 ? (
              <div className="rounded-2xl bg-white p-10 text-center text-slate-400 dark:bg-slate-900">
                {showingRecommendations
                  ? "暂时没有可推荐的素材，请点击“换一批”重试。"
                  : showHidden
                    ? "当前设备没有已屏蔽素材。"
                    : followingOnly
                      ? "还没有关注上传者，先在喜欢的上传者素材卡片上点击关注。"
                      : "没有匹配的素材，请调整筛选条件。"}
              </div>
            ) : null}

            {!loading && !randomMode && totalItems > 0 && (currentPage === 0 || sortMode !== "weeklyTop") ? (
              <nav className="mt-8 flex flex-wrap items-center justify-center gap-2" aria-label="素材分页">
                <button type="button" disabled={currentPage <= 0} onClick={() => {
                  if (currentPage === 1) handleRecommendationHome();
                  else setCurrentPage((value) => Math.max(0, value - 1));
                }} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900">上一页</button>
                <button type="button" onClick={handleRecommendationHome} className={`h-9 rounded-full px-3.5 text-sm ${currentPage === 0 ? "bg-orange-500 text-white" : "border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"}`}>首页</button>
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
      {deviceAuthErrorMessage ? (
        <DeviceAuthenticationDialog
          message={deviceAuthErrorMessage}
          onClose={() => setDeviceAuthErrorMessage("")}
          onReauthenticate={() => {
            setDeviceAuthErrorMessage("");
            setSelectedResource(null);
            navigate("/auth", { replace: true });
          }}
        />
      ) : null}
    </div>
  );
}
