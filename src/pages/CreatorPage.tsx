import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CompactResourceCard } from "../components/CompactResourceCard";
import { ResourceDetailModal } from "../components/ResourceDetailModal";
import { ResourceLibraryHeader } from "../components/ResourceLibraryHeader";
import { SiteFooter } from "../components/SiteFooter";
import { V1ProTransferNotice } from "../components/V1ProTransferNotice";
import { useResourceCatalog } from "../hooks/useResourceCatalog";
import { useResourceInteractions } from "../hooks/useResourceInteractions";
import { hasValidLocalAuth } from "../services/authService";
import { displayDownloadCount, fetchResourceDownloads } from "../services/downloadStatsService";
import { fetchResourceFavorites } from "../services/favoriteService";
import { fetchResourceLikes } from "../services/likeService";
import { transferResourceViaWebUsb } from "../services/v1proWebResourceTransferService";
import type { ResourceItem } from "../types/resource";
import type { VideoFpsOption } from "../utils/resourceCapacity";
import { fetchCreatorProfile } from "../services/avatarService";

export default function CreatorPage() {
  const navigate = useNavigate();
  const { author: authorParam = "" } = useParams();
  const author = authorParam.trim();
  const { resources, loading, error } = useResourceCatalog();
  const [selectedResource, setSelectedResource] = useState<ResourceItem | null>(null);
  const [webUsbTransferringId, setWebUsbTransferringId] = useState<number | null>(null);
  const [webUsbProgress, setWebUsbProgress] = useState<number | null>(null);
  const [avatarUrl, setAvatarUrl] = useState("");
  const {
    transferringId,
    transferNotice,
    setTransferNotice,
    likingId,
    likeCounts,
    likedIds,
    favoriteIds,
    favoritingId,
    totalDownloadCounts,
    errorMessage,
    setErrorMessage,
    setLikeCounts,
    setLikedIds,
    setFavoriteIds,
    setTotalDownloadCounts,
    setWeeklyDownloadCounts,
    handleTransfer,
    handleLike,
    handleFavorite,
  } = useResourceInteractions();

  useEffect(() => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    void fetchResourceFavorites().then((state) => setFavoriteIds(state.favoriteIds)).catch(() => undefined);
    void fetchResourceLikes().then((state) => {
      setLikeCounts(state.counts);
      setLikedIds(state.likedIds);
    }).catch(() => undefined);
    void fetchResourceDownloads().then((state) => {
      setTotalDownloadCounts(state.totalCounts);
      setWeeklyDownloadCounts(state.weeklyCounts);
    }).catch(() => undefined);
  }, [navigate, setFavoriteIds, setLikeCounts, setLikedIds, setTotalDownloadCounts, setWeeklyDownloadCounts]);

  useEffect(() => {
    let active = true;
    if (!author) {
      setAvatarUrl("");
      return () => { active = false; };
    }
    void fetchCreatorProfile(author)
      .then((profile) => {
        if (active) setAvatarUrl(profile.avatarUrl || "");
      })
      .catch(() => {
        if (active) setAvatarUrl("");
      });
    return () => { active = false; };
  }, [author]);

  const authorResources = useMemo(() => {
    const normalized = author.toLocaleLowerCase("zh-CN");
    return resources.filter((item) => item.author?.trim().toLocaleLowerCase("zh-CN") === normalized);
  }, [author, resources]);

  const handleWebUsbTransfer = (resource: ResourceItem, videoFps?: VideoFpsOption) => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    if (webUsbTransferringId !== null) return;
    setErrorMessage("");
    setWebUsbTransferringId(resource.id);
    setWebUsbProgress(0);
    void transferResourceViaWebUsb(
      resource,
      { onStatus: (message) => setTransferNotice(message), onProgress: setWebUsbProgress },
      { videoFps: resource.materialType === "video" ? videoFps : undefined },
    )
      .then((result) => {
        const predicted = result.predictedFrameCount != null ? `预计 ${result.predictedFrameCount} 帧 · ` : "";
        let message = `网页直传完成：${predicted}实际 ${result.frameCount} 帧${result.fps ? ` · ${result.fps}fps` : ""}`;
        if (result.note) message += `（${result.note}）`;
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
      .finally(() => setWebUsbTransferringId(null));
  };

  return (
    <div className="site-page-shell resource-library-shell min-h-screen text-[#2b3245]">
      <V1ProTransferNotice message={webUsbProgress == null ? transferNotice : ""} onDismiss={() => setTransferNotice("")} />
      <ResourceLibraryHeader keyword="" onSearch={(value) => navigate(value ? `/?q=${encodeURIComponent(value)}` : "/")} />
      <main className="mx-auto max-w-[1120px] space-y-[14px] px-4 py-6 sm:px-6">
        <section className="overflow-hidden rounded-[18px] border border-[#e6e9f2] bg-white shadow-[0_10px_30px_rgba(43,50,69,.06)]">
          <div className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-5 py-6 sm:px-8">
            <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-[20px] bg-gradient-to-br from-[#ff8a5c] to-[#7c6cf0] text-3xl text-white shadow-[0_8px_20px_rgba(124,108,240,.24)]">{avatarUrl ? <img src={avatarUrl} alt={`${author}的头像`} className="h-full w-full object-cover" /> : "👤"}</div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#ff8a5c]">Creator Profile</p>
              <h1 className="mt-1 truncate text-2xl font-extrabold">{author || "未知上传人"}</h1>
            </div>
            <div className="col-start-3 row-start-1 rounded-[16px] bg-[#fff7f2] px-4 py-3 text-center sm:row-span-2 sm:px-6">
              <p className="text-[11px] font-semibold text-[#8a93a8]">公开素材</p>
              <p className="mt-0.5 text-2xl font-extrabold text-[#ff8a5c]">{loading ? "—" : authorResources.length}</p>
            </div>
            <p className="col-span-3 max-w-2xl text-[13px] leading-6 text-[#8a93a8] sm:col-span-1 sm:col-start-2">查看这位上传人的全部公开素材。页面只展示公开昵称与已发布作品。</p>
          </div>
        </section>

        {error || errorMessage ? <div className="rounded-[14px] border border-[#ffd8d5] bg-[#fff4f3] px-5 py-4 text-sm text-[#dc5d55]">{error || errorMessage}</div> : null}
        {loading ? <div className="rounded-[18px] border border-[#e6e9f2] bg-white p-12 text-center text-sm text-[#8a93a8]">正在加载上传人的素材…</div> : null}
        {!loading && authorResources.length === 0 ? (
          <section className="rounded-[18px] border border-[#e6e9f2] bg-white px-6 py-14 text-center shadow-[0_8px_24px_rgba(43,50,69,.04)]">
            <div className="text-4xl">📭</div>
            <h2 className="mt-4 text-lg font-extrabold">暂无公开素材</h2>
            <button type="button" onClick={() => navigate("/")} className="mt-5 rounded-full bg-gradient-to-br from-[#ff8a5c] to-[#ff6f9c] px-6 py-2.5 text-[13px] font-semibold text-white">返回素材中心</button>
          </section>
        ) : null}
        {!loading && authorResources.length > 0 ? (
          <section className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {authorResources.map((resource) => (
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
              />
            ))}
          </section>
        ) : null}
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
