import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ResourceLibraryHeader } from "../components/ResourceLibraryHeader";
import { SiteFooter } from "../components/SiteFooter";
import {
  fetchCreditLeaderboard,
  type CreditLeaderboardEntry,
} from "../services/creditLeaderboardService";
import { formatClientError } from "../services/httpClient";

const rankMeta = [
  { medal: "🥇", label: "冠军", gradient: "from-[#fff2bd] via-[#fffaf0] to-[#ffe4a2]", color: "text-[#b7791f]" },
  { medal: "🥈", label: "亚军", gradient: "from-[#edf1f8] via-white to-[#dce3ef]", color: "text-[#64748b]" },
  { medal: "🥉", label: "季军", gradient: "from-[#ffe1cf] via-[#fff8f2] to-[#ffc8aa]", color: "text-[#b65f35]" },
];

function formatCredits(value: number): string {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Math.max(0, value || 0));
}

function Avatar({ entry, large = false }: { entry: CreditLeaderboardEntry; large?: boolean }) {
  const size = large ? "h-20 w-20 text-3xl" : "h-11 w-11 text-lg";
  if (entry.avatarUrl) {
    return <img src={entry.avatarUrl} alt={`${entry.displayName}的头像`} className={`${size} rounded-full border-4 border-white object-cover shadow-md`} />;
  }
  return (
    <div className={`${size} grid shrink-0 place-items-center rounded-full border-4 border-white bg-gradient-to-br from-[#ff9d72] to-[#7c6cf0] font-extrabold text-white shadow-md`}>
      {entry.displayName.trim().slice(0, 1) || "佳"}
    </div>
  );
}

function CreatorNameLink({ entry, className = "" }: { entry: CreditLeaderboardEntry; className?: string }) {
  const creatorName = entry.creatorName?.trim();
  if (!creatorName) return <span className={className}>{entry.displayName}</span>;
  return (
    <Link
      to={`/creator/${encodeURIComponent(creatorName)}`}
      className={`${className} transition hover:text-[#7c6cf0] hover:underline`}
      title={`查看 ${entry.displayName} 上传的素材`}
    >
      {entry.displayName}
    </Link>
  );
}

export default function CreditLeaderboardPage() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<CreditLeaderboardEntry[]>([]);
  const [current, setCurrent] = useState<CreditLeaderboardEntry | null>(null);
  const [totalUsers, setTotalUsers] = useState(0);
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchCreditLeaderboard();
      setEntries(Array.isArray(payload.entries) ? payload.entries : []);
      setCurrent(payload.current || null);
      setTotalUsers(typeof payload.totalUsers === "number" ? payload.totalUsers : 0);
      setUpdatedAt(typeof payload.updatedAt === "string" ? payload.updatedAt : "");
    } catch (err) {
      setError(formatClientError(err, "积分榜加载失败，请稍后重试"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const topThree = useMemo(() => entries.slice(0, 3), [entries]);
  const podiumEntries = useMemo(
    () => [topThree[1], topThree[0], topThree[2]].filter((entry): entry is CreditLeaderboardEntry => Boolean(entry)),
    [topThree],
  );
  const remaining = useMemo(() => entries.slice(3), [entries]);
  const currentInList = Boolean(current && entries.some((entry) => entry.isCurrent));

  return (
    <div className="site-page-shell resource-library-shell min-h-screen text-[#2b3245]">
      <ResourceLibraryHeader keyword="" onSearch={(value) => navigate(value ? `/?q=${encodeURIComponent(value)}` : "/")} />
      <main className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6">
        <section className="relative overflow-hidden rounded-[22px] border border-[#e6e9f2] bg-white px-5 py-6 shadow-[0_12px_36px_rgba(43,50,69,.07)] sm:px-8">
          <div className="pointer-events-none absolute -right-12 -top-20 h-56 w-56 rounded-full bg-[#ff8a5c]/10 blur-2xl" />
          <div className="pointer-events-none absolute right-28 top-2 h-40 w-40 rounded-full bg-[#7c6cf0]/10 blur-2xl" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-[20px] bg-gradient-to-br from-[#ff8a5c] to-[#7c6cf0] text-3xl text-white shadow-[0_8px_22px_rgba(124,108,240,.25)]">🏆</div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#ff8a5c]">Credits Ranking</p>
                <h1 className="mt-1 text-2xl font-extrabold sm:text-[28px]">积分排行榜</h1>
                <p className="mt-1 text-sm text-[#8a93a8]">积分越多，排名越靠前 · 同积分共享名次</p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="min-w-[104px] rounded-[16px] bg-[#fff7f2] px-4 py-3 text-center">
                <p className="text-[11px] font-semibold text-[#8a93a8]">参与用户</p>
                <p className="mt-0.5 text-2xl font-extrabold text-[#ff8a5c]">{loading ? "—" : totalUsers}</p>
              </div>
              <button type="button" onClick={() => void load()} disabled={loading} className="rounded-[16px] border border-[#e6e9f2] bg-white px-4 text-sm font-semibold text-[#596178] transition hover:border-[#ff8a5c] hover:text-[#ff8a5c] disabled:cursor-wait disabled:opacity-60">
                {loading ? "刷新中…" : "刷新榜单"}
              </button>
            </div>
          </div>
        </section>

        {current ? (
          <section className="mt-[14px] flex flex-col gap-3 rounded-[18px] bg-gradient-to-r from-[#7468ee] to-[#598bff] px-5 py-4 text-white shadow-[0_10px_26px_rgba(89,139,255,.2)] sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div>
              <p className="text-xs font-semibold text-white/70">我的当前排名</p>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-3xl font-extrabold">第 {current.rank} 名</span>
                {!currentInList ? <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs">未进入前 50 名</span> : null}
              </div>
            </div>
            <div className="flex items-center gap-3 sm:text-right">
              <div>
                <p className="text-sm font-bold">{current.displayName}</p>
                <p className="mt-0.5 text-lg font-extrabold">{formatCredits(current.credits)} <span className="text-xs font-semibold text-white/75">积分</span></p>
              </div>
              <Avatar entry={current} />
            </div>
          </section>
        ) : null}

        {error ? (
          <section className="mt-[14px] rounded-[18px] border border-[#ffd7d1] bg-[#fff7f5] px-6 py-10 text-center">
            <p className="font-semibold text-[#d85d54]">{error}</p>
            <button type="button" onClick={() => void load()} className="mt-4 rounded-full bg-[#ff7d67] px-5 py-2 text-sm font-bold text-white">重新加载</button>
          </section>
        ) : loading ? (
          <section className="mt-[14px] grid min-h-[340px] place-items-center rounded-[18px] border border-[#e6e9f2] bg-white">
            <div className="text-center"><div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-[#f0eefe] border-t-[#7c6cf0]" /><p className="mt-3 text-sm text-[#8a93a8]">正在统计积分排名…</p></div>
          </section>
        ) : entries.length === 0 ? (
          <section className="mt-[14px] rounded-[18px] border border-[#e6e9f2] bg-white px-6 py-16 text-center text-[#8a93a8]">暂时还没有积分排名数据</section>
        ) : (
          <>
            <section className="mt-[14px] grid gap-[14px] md:grid-cols-3">
              {podiumEntries.map((entry) => {
                const index = topThree.indexOf(entry);
                const meta = rankMeta[index];
                return (
                  <article key={`${entry.rank}-${entry.displayName}-${index}`} className={`relative overflow-hidden rounded-[20px] border border-white bg-gradient-to-br ${meta.gradient} px-5 py-7 text-center shadow-[0_10px_28px_rgba(43,50,69,.08)] ${index === 0 ? "md:-translate-y-3 md:pb-9 md:pt-8" : ""} ${entry.isCurrent ? "ring-2 ring-[#7c6cf0] ring-offset-2" : ""}`}>
                    <span className="absolute left-4 top-4 rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-bold text-[#697086]">第 {entry.rank} 名</span>
                    {entry.isCurrent ? <span className="absolute right-4 top-4 rounded-full bg-[#7c6cf0] px-2.5 py-1 text-[11px] font-bold text-white">我</span> : null}
                    <div className="text-4xl">{meta.medal}</div>
                    <div className="mt-3 flex justify-center"><Avatar entry={entry} large /></div>
                    <h2 className="mt-3 truncate text-lg font-extrabold"><CreatorNameLink entry={entry} /></h2>
                    <p className={`mt-1 text-[11px] font-bold uppercase tracking-[.18em] ${meta.color}`}>{meta.label}</p>
                    <div className="mt-4 rounded-[14px] bg-white/65 px-3 py-2.5">
                      <strong className="text-2xl">{formatCredits(entry.credits)}</strong><span className="ml-1 text-xs font-semibold text-[#8a93a8]">积分</span>
                    </div>
                  </article>
                );
              })}
            </section>

            {remaining.length > 0 ? (
              <section className="mt-[14px] overflow-hidden rounded-[18px] border border-[#e6e9f2] bg-white shadow-[0_10px_28px_rgba(43,50,69,.05)]">
                <div className="flex items-center justify-between border-b border-[#eef0f6] px-5 py-4 sm:px-7">
                  <div><h2 className="font-extrabold">排行榜</h2><p className="mt-0.5 text-xs text-[#8a93a8]">展示积分排名前 50 名</p></div>
                  {updatedAt ? <span className="text-[11px] text-[#a0a7b8]">更新于 {new Date(updatedAt).toLocaleString("zh-CN")}</span> : null}
                </div>
                <div className="divide-y divide-[#f0f1f6]">
                  {remaining.map((entry, index) => (
                    <div key={`${entry.rank}-${entry.displayName}-${index + 3}`} className={`grid grid-cols-[46px_44px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3.5 sm:px-7 ${entry.isCurrent ? "bg-[#f3f1ff]" : "transition hover:bg-[#fafbfe]"}`}>
                      <span className={`text-center text-sm font-extrabold ${entry.isCurrent ? "text-[#7c6cf0]" : "text-[#8a93a8]"}`}>{entry.rank}</span>
                      <Avatar entry={entry} />
                      <div className="min-w-0"><p className="truncate text-sm font-bold"><CreatorNameLink entry={entry} /></p>{entry.isCurrent ? <p className="mt-0.5 text-[11px] font-semibold text-[#7c6cf0]">我的排名</p> : null}</div>
                      <div className="text-right"><strong className="text-base text-[#ff7d67] sm:text-lg">{formatCredits(entry.credits)}</strong><span className="ml-1 text-[11px] text-[#8a93a8]">积分</span></div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
        <SiteFooter />
      </main>
    </div>
  );
}
