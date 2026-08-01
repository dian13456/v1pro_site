import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SitePageLayout } from "../components/SitePageLayout";
import {
  SiteAlert,
  SiteButton,
  SiteLoadingBlock,
  SitePanel,
  SiteSectionTitle,
  SITE_CONTENT_MEDIUM,
} from "../components/SiteUi";
import { useThemeMode } from "../hooks/useThemeMode";
import { hasValidLocalAuth } from "../services/authService";
import { fetchPublicWinners } from "../services/activityService";
import type { PublicWinnersView } from "../types/activity";

function formatWinnerTime(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ActivityWinnerListPage() {
  const navigate = useNavigate();
  const { theme, setTheme } = useThemeMode();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PublicWinnersView | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    void (async () => {
      setLoading(true);
      setErrorMessage("");
      try {
        const view = await fetchPublicWinners();
        setData(view);
      } catch (err) {
        setErrorMessage((err as Error)?.message || "加载中奖名单失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate]);

  return (
    <SitePageLayout
      subtitle="中奖名单公示 · 公平透明"
      theme={theme}
      onSetTheme={setTheme}
      contentClassName={SITE_CONTENT_MEDIUM}
    >
      <SitePanel accent className="overflow-hidden p-0">
        <div className="bg-gradient-to-r from-amber-500/95 via-orange-500/90 to-rose-500/85 px-6 py-6 text-white">
          <p className="text-xs uppercase tracking-[0.28em] text-white/80">Winner List</p>
          <h1 className="mt-2 text-2xl font-semibold md:text-3xl">中奖名单公示</h1>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-white/90">
            {data?.activityTitle || "设备用户专属抽奖活动"} · 每日自动开奖后更新
          </p>
        </div>
      </SitePanel>

      <SiteAlert variant="info">
        为保护隐私，公示名单仅展示脱敏后的设备 SN、开奖期次与中奖时间；姓名、手机号、收货地址等个人信息不会公开。
      </SiteAlert>

      {loading ? <SiteLoadingBlock>加载中奖名单…</SiteLoadingBlock> : null}

      {!loading && data ? (
        <SitePanel>
          <SiteSectionTitle
            title="历史中奖记录"
            description={
              data.prizeTitle
                ? `当前奖品：${data.prizeTitle}。共 ${data.winners.length} 条记录。`
                : `共 ${data.winners.length} 条记录。`
            }
          />
          {data.winners.length === 0 ? (
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">暂无中奖记录，敬请期待首期开奖。</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-white/25 dark:border-white/10">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-white/60 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">开奖期次</th>
                    <th className="px-4 py-3 font-medium">中奖 SN（脱敏）</th>
                    <th className="px-4 py-3 font-medium">奖品</th>
                    <th className="px-4 py-3 font-medium">中奖时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/20 dark:divide-white/10">
                  {data.winners.map((winner, index) => (
                    <tr
                      key={`${winner.drawPeriod}-${winner.snMasked}-${winner.winnerTime}-${index}`}
                      className="bg-white/40 dark:bg-slate-900/30"
                    >
                      <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{winner.drawPeriod}</td>
                      <td className="px-4 py-3 font-mono text-violet-700 dark:text-violet-200">{winner.snMasked}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{winner.prizeTitle || data.prizeTitle}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{formatWinnerTime(winner.winnerTime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SitePanel>
      ) : null}

      {errorMessage ? <SiteAlert variant="error">{errorMessage}</SiteAlert> : null}

      <div className="flex flex-wrap gap-3">
        <Link to="/activities/lottery">
          <SiteButton type="button" className="bg-transparent text-slate-700 ring-1 ring-slate-300 dark:text-slate-200 dark:ring-slate-600">
            返回抽奖活动
          </SiteButton>
        </Link>
        <Link to="/activities">
          <SiteButton type="button" className="bg-transparent text-slate-700 ring-1 ring-slate-300 dark:text-slate-200 dark:ring-slate-600">
            活动中心
          </SiteButton>
        </Link>
      </div>
    </SitePageLayout>
  );
}
