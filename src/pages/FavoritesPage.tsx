import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ResourceCard } from "../components/ResourceCard";
import { ResourceLibraryHeader } from "../components/ResourceLibraryHeader";
import { SiteFooter } from "../components/SiteFooter";
import { V1ProTransferNotice } from "../components/V1ProTransferNotice";
import { useResourceCatalog } from "../hooks/useResourceCatalog";
import { useResourceInteractions } from "../hooks/useResourceInteractions";
import { hasValidLocalAuth } from "../services/authService";
import { fetchResourceDownloads } from "../services/downloadStatsService";
import { fetchResourceFavorites } from "../services/favoriteService";
import { fetchResourceLikes } from "../services/likeService";

export default function FavoritesPage() {
  const navigate = useNavigate();
  const { resources, loading, error } = useResourceCatalog();
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
    <div className="site-page-shell resource-library-shell min-h-screen text-[#2b3245]">
      <V1ProTransferNotice message={transferNotice} onDismiss={() => setTransferNotice("")} />
      <ResourceLibraryHeader keyword="" onSearch={(value) => navigate(value ? `/?q=${encodeURIComponent(value)}` : "/")} />
      <main className="mx-auto max-w-[1120px] space-y-[14px] px-4 py-6 sm:px-6">
        <section className="overflow-hidden rounded-[18px] border border-[#e6e9f2] bg-white shadow-[0_10px_30px_rgba(43,50,69,.06)]">
          <div className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-5 py-6 sm:px-8">
            <div className="grid h-16 w-16 place-items-center rounded-[20px] bg-gradient-to-br from-[#ff8a5c] to-[#7c6cf0] text-3xl text-white shadow-[0_8px_20px_rgba(124,108,240,.24)]">♥</div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#ff8a5c]">My Favorites</p>
              <h1 className="mt-1 text-2xl font-extrabold">我的收藏</h1>
            </div>
            <div className="col-start-3 row-start-1 rounded-[16px] bg-[#fff7f2] px-4 py-3 text-center sm:row-span-2 sm:px-6">
              <p className="text-[11px] font-semibold text-[#8a93a8]">收藏素材</p>
              <p className="mt-0.5 text-2xl font-extrabold text-[#ff8a5c]">{loading ? "—" : favoriteResources.length}</p>
            </div>
            <p className="col-span-3 max-w-2xl text-[13px] leading-6 text-[#8a93a8] sm:col-span-1 sm:col-start-2">按当前设备 SN 保存，可在这里快速播放、下载或传输收藏的素材。</p>
          </div>
        </section>

        {error || errorMessage ? (
          <div className="rounded-[14px] border border-[#ffd8d5] bg-[#fff4f3] px-5 py-4 text-sm text-[#dc5d55]">{error || errorMessage}</div>
        ) : null}

        {loading ? <div className="rounded-[18px] border border-[#e6e9f2] bg-white p-12 text-center text-sm text-[#8a93a8]">正在加载收藏…</div> : null}

        {!loading && favoriteResources.length === 0 ? (
          <section className="rounded-[18px] border border-[#e6e9f2] bg-white px-6 py-14 text-center shadow-[0_8px_24px_rgba(43,50,69,.04)]">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-[20px] bg-[#f0edff] text-3xl text-[#7c6cf0]">☆</div>
            <h2 className="mt-4 text-lg font-extrabold">还没有收藏素材</h2>
            <p className="mt-2 text-[13px] text-[#8a93a8]">浏览素材时点击星标，收藏内容会按当前设备 SN 保存在这里。</p>
            <button type="button" onClick={() => navigate("/")} className="mt-5 rounded-full bg-gradient-to-br from-[#ff8a5c] to-[#ff6f9c] px-6 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(255,138,92,.25)]">去素材中心看看</button>
          </section>
        ) : null}

        {!loading && favoriteResources.length > 0 ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3 px-1 pt-2">
              <div>
                <h2 className="text-lg font-extrabold">已收藏素材</h2>
                <p className="mt-1 text-xs text-[#8a93a8]">点击星标可取消收藏，操作后列表会立即更新</p>
              </div>
            </div>
            <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
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
                transferring={transferringId === resource.id}
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
          </>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
