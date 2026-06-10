import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ResourceCard } from "../components/ResourceCard";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { SitePageShell } from "../components/SitePageShell";
import { SitePageToolbar } from "../components/SitePageToolbar";
import { V1ProTransferNotice } from "../components/V1ProTransferNotice";
import { useResourceCatalog } from "../hooks/useResourceCatalog";
import { useResourceInteractions } from "../hooks/useResourceInteractions";
import { useThemeMode } from "../hooks/useThemeMode";
import { hasValidLocalAuth } from "../services/authService";
import { fetchResourceDownloads } from "../services/downloadStatsService";
import { fetchResourceFavorites } from "../services/favoriteService";
import { fetchResourceLikes } from "../services/likeService";

export default function FavoritesPage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useThemeMode();
  const { resources, loading, error } = useResourceCatalog();
  const {
    downloadingId,
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
    handlePlayPrepare,
    handleLike,
    handleFavorite,
    stopPlay,
  } = useResourceInteractions();

  useEffect(() => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    void fetchResourceFavorites()
      .then((state) => setFavoriteIds(state.favoriteIds))
      .catch(() => undefined);
    void fetchResourceLikes()
      .then((state) => {
        setLikeCounts(state.counts);
        setLikedIds(state.likedIds);
      })
      .catch(() => undefined);
    void fetchResourceDownloads()
      .then((state) => {
        setTotalDownloadCounts(state.totalCounts);
        setWeeklyDownloadCounts(state.weeklyCounts);
      })
      .catch(() => undefined);
  }, [
    navigate,
    setFavoriteIds,
    setLikeCounts,
    setLikedIds,
    setTotalDownloadCounts,
    setWeeklyDownloadCounts,
  ]);

  const favoriteResources = useMemo(() => {
    const map = new Map(resources.map((item) => [item.id, item]));
    return favoriteIds
      .map((id) => map.get(id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }, [favoriteIds, resources]);

  return (
    <SitePageShell
      beforeContent={
        <V1ProTransferNotice message={transferNotice} onDismiss={() => setTransferNotice("")} />
      }
    >
        <SiteHeader
          title="佳点电子资源中心"
          subtitle="我的收藏 · 按 SN 码保存的素材列表；传输到设备成功后会自动加入收藏"
          rightSlot={<SitePageToolbar theme={theme} onToggleTheme={toggleTheme} />}
        />

        {error || errorMessage ? (
          <div className="mb-4 rounded-xl border border-rose-300/60 bg-rose-100/70 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-200">
            {error || errorMessage}
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-2xl border border-white/20 bg-white/45 p-8 text-center text-slate-600 backdrop-blur dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-300">
            正在加载收藏...
          </div>
        ) : null}

        {!loading && favoriteResources.length === 0 ? (
          <div className="rounded-2xl border border-white/20 bg-white/45 p-8 text-center text-slate-600 backdrop-blur dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-300">
            还没有收藏素材。可在
            <button
              type="button"
              onClick={() => navigate("/")}
              className="mx-1 text-violet-600 underline-offset-2 hover:underline dark:text-violet-300"
            >
              素材中心
            </button>
            点星标收藏，或传输到设备后自动加入。
          </div>
        ) : null}

        {!loading && favoriteResources.length > 0 ? (
          <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {favoriteResources.map((resource) => (
              <ResourceCard
                key={resource.id}
                resource={resource}
                onDownload={handleDownload}
                onTransfer={handleTransfer}
                onTransferPrepare={handleTransferPrepare}
                onPlay={handlePlay}
                onPlayPrepare={handlePlayPrepare}
                onStopPlay={stopPlay}
                onLike={handleLike}
                onFavorite={handleFavorite}
                downloading={downloadingId === resource.id}
                playing={playingId === resource.id}
                isPlaying={playingResourceId === resource.id}
                playUrl={playingResourceId === resource.id ? playingUrl : ""}
                liking={likingId === resource.id}
                liked={likedIds.has(resource.id)}
                likeCount={likeCounts[resource.id] || 0}
                favorited={favoriteIdSet.has(resource.id)}
                favoriting={favoritingId === resource.id}
                downloadCount={totalDownloadCounts[resource.id] || 0}
                weeklyDownloadCount={weeklyDownloadCounts[resource.id] || 0}
              />
            ))}
          </section>
        ) : null}

        <SiteFooter />
    </SitePageShell>
  );
}
