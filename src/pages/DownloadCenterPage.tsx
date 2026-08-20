import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ResourceLibraryHeader } from "../components/ResourceLibraryHeader";
import { SiteFooter } from "../components/SiteFooter";
import { createDownloadUrl } from "../services/downloadService";
import { fetchResources } from "../services/resourceService";
import type { ResourceCategory, ResourceItem } from "../types/resource";
import { useDeviceFeatureAccess } from "../services/featureAccessService";

const CATEGORY_LABELS: Partial<Record<ResourceCategory, string>> = {
  software: "软件",
  firmware: "固件",
  driver: "驱动",
  manual: "说明书",
};

const CATEGORY_ICONS: Partial<Record<ResourceCategory, string>> = {
  software: "▣",
  firmware: "⌁",
  driver: "⚙",
  manual: "▤",
};

function formatDate(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function productName(item: ResourceItem): string {
  if (/V1PRO/i.test(item.title)) return "V1PRO";
  if (/佳点V1(?:_|\s)/i.test(item.title)) return "V1";
  return "佳点设备";
}

function versionName(item: ResourceItem): string {
  return item.title.match(/V\d+(?:\.\d+){1,3}/i)?.[0] || "";
}

export default function DownloadCenterPage() {
  const navigate = useNavigate();
  const { access } = useDeviceFeatureAccess();
  const featureEnabled = access?.enabled === true;
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "software" | "firmware" | "driver" | "manual">("all");

  useEffect(() => {
    let active = true;
    void fetchResources()
      .then((resources) => {
        if (!active) return;
        setItems(
          resources
            .filter((item) => item.category !== "gif")
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
        );
      })
      .catch((err: unknown) => {
        if (active) setError((err as Error)?.message || "资料加载失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleItems = useMemo(
    () => (filter === "all" ? items : items.filter((item) => item.category === filter)),
    [filter, items],
  );
  const latest = visibleItems[0] || null;
  const history = latest ? visibleItems.slice(1) : [];
  const availableCategories = useMemo(
    () => ["software", "firmware", "driver", "manual"].filter((category) => items.some((item) => item.category === category)) as Array<"software" | "firmware" | "driver" | "manual">,
    [items],
  );

  const handleDownload = async (item: ResourceItem) => {
    try {
      setDownloadingId(item.id);
      setError("");
      const result = await createDownloadUrl(item.id, item.download, { forDownload: true });
      if (!result.url) throw new Error("下载链接生成失败");
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      const message = (err as Error)?.message || "下载失败，请稍后重试";
      setError(message);
      if (message.includes("认证")) navigate("/auth", { replace: true });
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="site-page-shell resource-library-shell min-h-screen text-[#2b3245]">
      <ResourceLibraryHeader keyword="" onSearch={(value) => navigate(value ? `/?q=${encodeURIComponent(value)}` : "/")} />
      <main className="mx-auto max-w-[1120px] space-y-[14px] px-4 py-6 sm:px-6">
        <section className="overflow-hidden rounded-[18px] border border-[#e6e9f2] bg-white shadow-[0_10px_30px_rgba(43,50,69,.06)]">
          <div className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-5 py-6 sm:px-8">
            <div className="grid h-16 w-16 place-items-center rounded-[20px] bg-gradient-to-br from-[#ff8a5c] to-[#7c6cf0] text-3xl font-bold text-white shadow-[0_8px_20px_rgba(124,108,240,.24)]">▤</div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#ff8a5c]">Downloads & Documents</p>
              <h1 className="mt-1 text-2xl font-extrabold">资料中心</h1>
            </div>
            <div className="col-start-3 row-start-1 rounded-[16px] bg-[#fff7f2] px-4 py-3 text-center sm:row-span-2 sm:px-6">
              <p className="text-[11px] font-semibold text-[#8a93a8]">可用资料</p>
              <p className="mt-0.5 text-2xl font-extrabold text-[#ff8a5c]">{loading ? "—" : items.length}</p>
            </div>
            <p className="col-span-3 max-w-2xl text-[13px] leading-6 text-[#8a93a8] sm:col-span-1 sm:col-start-2">集中下载佳点 V1PRO、V1 的桌面软件、固件、驱动与使用说明。</p>
          </div>
        </section>

        <section className="rounded-[18px] border border-[#e6e9f2] bg-white p-4 shadow-[0_8px_24px_rgba(43,50,69,.04)] sm:px-6">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setFilter("all")} className={`rounded-full px-4 py-2 text-xs font-semibold transition ${filter === "all" ? "bg-gradient-to-br from-[#ff8a5c] to-[#ff6f9c] text-white" : "bg-[#f5f6fb] text-[#6f7890] hover:text-[#ff8a5c]"}`}>全部资料</button>
            {availableCategories.map((category) => (
              <button key={category} type="button" onClick={() => setFilter(category)} className={`rounded-full px-4 py-2 text-xs font-semibold transition ${filter === category ? "bg-gradient-to-br from-[#ff8a5c] to-[#ff6f9c] text-white" : "bg-[#f5f6fb] text-[#6f7890] hover:text-[#ff8a5c]"}`}>{CATEGORY_LABELS[category]}</button>
            ))}
          </div>
        </section>

        {error ? <div className="rounded-[14px] border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-600">{error}</div> : null}
        {loading ? <div className="rounded-[18px] border border-[#e6e9f2] bg-white p-12 text-center text-sm text-[#8a93a8]">正在加载资料…</div> : null}

        {!loading && latest ? (
          <section className="overflow-hidden rounded-[18px] border border-[#e6e9f2] bg-white shadow-[0_10px_30px_rgba(43,50,69,.05)]">
            <div className="bg-gradient-to-r from-[#ff8a5c] via-[#ff6f9c] to-[#7c6cf0] px-6 py-5 text-white sm:px-8">
              <p className="text-[11px] font-bold uppercase tracking-[.22em] text-white/80">最新发布</p>
              <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="break-all text-xl font-extrabold sm:text-2xl">{latest.title}</h2>
                  <p className="mt-2 text-[13px] text-white/90">{latest.description}</p>
                </div>
                <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur">{productName(latest)} {versionName(latest)}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 p-6 sm:px-8">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#fff3ed] text-2xl font-bold text-[#ff8a5c]">{CATEGORY_ICONS[latest.category] || "▤"}</div>
              <div className="min-w-0 flex-1 text-xs leading-6 text-[#8a93a8]">
                <p><span className="font-semibold text-[#4a5270]">资料类型：</span>{CATEGORY_LABELS[latest.category] || "其他资料"}</p>
                <p><span className="font-semibold text-[#4a5270]">文件大小：</span>{latest.size || "未知"} · <span className="font-semibold text-[#4a5270]">更新时间：</span>{formatDate(latest.updatedAt)}</p>
              </div>
              <button type="button" disabled={downloadingId === latest.id || !featureEnabled} title={featureEnabled ? "立即下载" : "请先到个人中心输入激活码"} onClick={() => void handleDownload(latest)} className="rounded-full bg-gradient-to-br from-[#ff8a5c] to-[#ff6f9c] px-6 py-3 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(255,138,92,.3)] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none disabled:opacity-100">{downloadingId === latest.id ? "正在生成链接…" : featureEnabled ? "↓ 立即下载" : "未激活"}</button>
            </div>
          </section>
        ) : null}

        {!loading && history.length > 0 ? (
          <>
            <div className="px-1 pt-2">
              <h2 className="text-lg font-extrabold">历史版本</h2>
              <p className="mt-1 text-xs text-[#8a93a8]">如无特殊需要，建议优先使用最新版本</p>
            </div>
            <section className="grid gap-4 md:grid-cols-2">
              {history.map((item) => (
                <article key={item.id} className="flex flex-col rounded-[16px] border border-[#e6e9f2] bg-white p-5 shadow-[0_8px_24px_rgba(43,50,69,.04)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(43,50,69,.08)]">
                  <div className="flex items-start gap-4">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-[#f0edff] text-xl font-bold text-[#7c6cf0]">{CATEGORY_ICONS[item.category] || "▤"}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-[#fff4e8] px-2.5 py-1 text-[10px] font-bold text-[#ff8a5c]">{productName(item)}</span>
                        {versionName(item) ? <span className="rounded-full bg-[#f0edff] px-2.5 py-1 text-[10px] font-bold text-[#7c6cf0]">{versionName(item)}</span> : null}
                      </div>
                      <h3 className="mt-2 break-all text-[14px] font-extrabold leading-6">{item.title}</h3>
                      <p className="mt-1 text-[12px] leading-5 text-[#8a93a8]">{item.description}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#eef0f6] pt-4">
                    <span className="text-[11px] text-[#8a93a8]">{item.size || "未知"} · {formatDate(item.updatedAt)}</span>
                    <button type="button" disabled={downloadingId === item.id || !featureEnabled} title={featureEnabled ? "下载" : "请先到个人中心输入激活码"} onClick={() => void handleDownload(item)} className="rounded-full border border-[#e6e9f2] bg-white px-4 py-2 text-xs font-semibold text-[#4a5270] transition hover:border-[#ff8a5c] hover:text-[#ff8a5c] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:opacity-100">{downloadingId === item.id ? "准备中…" : featureEnabled ? "下载" : "未激活"}</button>
                  </div>
                </article>
              ))}
            </section>
          </>
        ) : null}

        {!loading && visibleItems.length === 0 ? <div className="rounded-[18px] border border-[#e6e9f2] bg-white p-12 text-center text-sm text-[#8a93a8]">当前分类暂无资料</div> : null}
      </main>
      <SiteFooter />
    </div>
  );
}
