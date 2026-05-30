import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CategoryTabs } from "../components/CategoryTabs";
import { ResourceCard } from "../components/ResourceCard";
import { SearchBar } from "../components/SearchBar";
import { SiteHeader } from "../components/SiteHeader";
import { ThemeToggle } from "../components/ThemeToggle";
import { useImagePreload } from "../hooks/useImagePreload";
import { useThemeMode } from "../hooks/useThemeMode";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";
import { useResourceCatalog } from "../hooks/useResourceCatalog";
import { clearAuthState, hasValidLocalAuth } from "../services/authService";
import { createDownloadUrl } from "../services/downloadService";
import { isStaticMode } from "../services/runtimeMode";
import type { ResourceItem } from "../types/resource";

export default function ResourcesPage() {
  const navigate = useNavigate();
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const { theme, toggleTheme } = useThemeMode();
  const {
    filtered,
    loading,
    error,
    keyword,
    setKeyword,
    category,
    setCategory,
    materialType,
    setMaterialType,
  } = useResourceCatalog();
  const { visibleItems, hasMore, sentinelRef } = useInfiniteScroll(filtered, 16);

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

  const handleLogout = () => {
    clearAuthState();
    navigate("/auth", { replace: true });
  };

  const handleDownload = async (resource: ResourceItem) => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }

    try {
      setDownloadingId(resource.id);
      setErrorMessage("");
      const signedUrl = await createDownloadUrl(resource.id, resource.download);
      window.open(signedUrl || resource.download, "_blank", "noopener,noreferrer");
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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_8%_14%,rgba(125,211,252,0.22),transparent_42%),radial-gradient(circle_at_90%_10%,rgba(147,197,253,0.2),transparent_38%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] text-slate-900 dark:bg-[radial-gradient(circle_at_8%_14%,rgba(14,116,144,0.25),transparent_42%),radial-gradient(circle_at_90%_10%,rgba(30,64,175,0.24),transparent_38%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] dark:text-slate-100">
      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
        <SiteHeader
          title="佳点 V1PRO 素材下载中心"
          subtitle="面向 1.9 寸（320×170 横屏）素材商店，支持 GIF、驱动、固件、软件与说明书下载。"
          rightSlot={
            <div className="flex items-center gap-2">
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

        <section className="mb-6 flex flex-wrap gap-2">
          {[
            { value: "all", label: "全部类型" },
            { value: "image", label: "图片素材" },
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
                downloading={downloadingId === resource.id}
              />
            ))}
          </section>
        ) : null}

        {!loading && visibleItems.length === 0 ? (
          <div className="mt-6 rounded-xl border border-white/30 bg-white/55 p-6 text-center text-slate-600 backdrop-blur dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-300">
            没有匹配的资源，请尝试修改关键词或分类。
          </div>
        ) : null}

        {hasMore ? <div ref={sentinelRef} className="h-8" /> : null}
      </div>
    </div>
  );
}
