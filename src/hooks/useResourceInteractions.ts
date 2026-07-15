import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { hasValidLocalAuth } from "../services/authService";
import { createDownloadUrl, prefetchPlayUrl } from "../services/downloadService";
import type { DownloadStatsSnapshot } from "../types/downloadStats";
import { createImageUrl } from "../services/imageService";
import { toggleResourceFavorite } from "../services/favoriteService";
import { likeResource } from "../services/likeService";
import type { ResourceItem } from "../types/resource";
import {
  V1PRO_TRANSFER_LAUNCHED_MESSAGE,
  handleTransferButtonClick,
  prefetchTransferDownloadUrl,
} from "../services/v1proTransferService";

export function useResourceInteractions() {
  const navigate = useNavigate();
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [transferringId, setTransferringId] = useState<number | null>(null);
  const [transferNotice, setTransferNotice] = useState("");
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [playingResourceId, setPlayingResourceId] = useState<number | null>(null);
  const [playingUrl, setPlayingUrl] = useState("");
  const [likingId, setLikingId] = useState<number | null>(null);
  const [likeCounts, setLikeCounts] = useState<Record<number, number>>({});
  const [likedIds, setLikedIds] = useState<Set<number>>(new Set<number>());
  const [favoriteIds, setFavoriteIds] = useState<number[]>([]);
  const [favoritingId, setFavoritingId] = useState<number | null>(null);
  const [totalDownloadCounts, setTotalDownloadCounts] = useState<Record<number, number>>({});
  const [weeklyDownloadCounts, setWeeklyDownloadCounts] = useState<Record<number, number>>({});
  const [errorMessage, setErrorMessage] = useState("");

  const applyDownloadStats = (resourceId: number, stats?: DownloadStatsSnapshot | null) => {
    if (!stats) return;
    setTotalDownloadCounts((prev) => ({ ...prev, [resourceId]: stats.totalCount }));
    setWeeklyDownloadCounts((prev) => ({ ...prev, [resourceId]: stats.weeklyCount }));
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
      const playResult = await createDownloadUrl(resource.id, resource.download, { forDownload: false });
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

  const handleTransferPrepare = (resource: ResourceItem, options?: { urgent?: boolean }) => {
    prefetchTransferDownloadUrl(resource, options);
  };

  const handleTransfer = (resource: ResourceItem) => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    setErrorMessage("");
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
    if (likedIds.has(resource.id) || !hasValidLocalAuth()) {
      if (!hasValidLocalAuth()) navigate("/auth", { replace: true });
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
        setLikedIds((prev) => new Set(prev).add(resource.id));
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

  const stopPlay = () => {
    setPlayingResourceId(null);
    setPlayingUrl("");
  };

  return {
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
    favoriteIdSet: new Set(favoriteIds),
    favoritingId,
    setFavoriteIds,
    totalDownloadCounts,
    weeklyDownloadCounts,
    errorMessage,
    setErrorMessage,
    setLikeCounts,
    setLikedIds,
    setTotalDownloadCounts,
    setWeeklyDownloadCounts,
    handleDownload,
    handleTransferPrepare,
    handleTransfer,
    handlePlay,
    handlePlayPrepare,
    handleLike,
    handleFavorite,
    stopPlay,
  };
}
