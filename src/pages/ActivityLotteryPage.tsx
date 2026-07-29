import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SitePageLayout } from "../components/SitePageLayout";
import {
  SiteAlert,
  SiteButton,
  SiteInput,
  SiteLoadingBlock,
  SitePanel,
  SiteSectionTitle,
  SITE_CONTENT_MEDIUM,
} from "../components/SiteUi";
import { useThemeMode } from "../hooks/useThemeMode";
import { getAuthState, hasValidLocalAuth } from "../services/authService";
import { fetchCurrentLotteryActivity, joinLotteryActivity } from "../services/activityService";
import type { LotteryActivity } from "../types/activity";

function formatCountdown(targetMs: number): string {
  const diff = Math.max(0, targetMs - Date.now());
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDrawTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export default function ActivityLotteryPage() {
  const navigate = useNavigate();
  const { theme, setTheme } = useThemeMode();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activity, setActivity] = useState<LotteryActivity | null>(null);
  const [sn, setSn] = useState("");
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [countdown, setCountdown] = useState("");

  const loadActivity = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const payload = await fetchCurrentLotteryActivity();
      setActivity(payload);
      const auth = getAuthState();
      if (!sn && auth?.serial) {
        setSn(auth.serial);
      }
    } catch (err) {
      setErrorMessage((err as Error)?.message || "加载活动失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    void loadActivity();
  }, [navigate]);

  useEffect(() => {
    if (!activity?.nextDrawAt) return;
    const tick = () => setCountdown(formatCountdown(activity.nextDrawAt));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [activity?.nextDrawAt]);

  const handleJoin = async () => {
    if (!activity || submitting) return;
    setSubmitting(true);
    setNotice("");
    setErrorMessage("");
    try {
      const result = await joinLotteryActivity(sn, activity.id);
      setNotice(result.message || "报名成功，开奖后系统会自动通知");
      await loadActivity();
    } catch (err) {
      setErrorMessage((err as Error)?.message || "报名失败");
    } finally {
      setSubmitting(false);
    }
  };

  const prizeCard = useMemo(() => {
    if (!activity) return null;
    return (
      <div className="rounded-2xl border border-white/30 bg-white/60 p-4 dark:border-white/10 dark:bg-slate-950/40">
        <p className="text-xs uppercase tracking-[0.2em] text-violet-600 dark:text-violet-300">本期奖品</p>
        <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">{activity.prizeTitle}</p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{activity.prizeDescription}</p>
      </div>
    );
  }, [activity]);

  return (
    <SitePageLayout
      subtitle="抽奖活动 · SN 码参与，每日自动开奖"
      theme={theme}
      onSetTheme={setTheme}
      contentClassName={SITE_CONTENT_MEDIUM}
    >
      <SitePanel accent className="overflow-hidden p-0">
        <div className="bg-gradient-to-r from-violet-600/95 via-fuchsia-500/90 to-cyan-500/85 px-6 py-6 text-white">
          <p className="text-xs uppercase tracking-[0.28em] text-white/80">V1PRO Lottery</p>
          <h1 className="mt-2 text-2xl font-semibold md:text-3xl">{activity?.title || "设备用户专属抽奖活动"}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-white/90">
            {activity?.description || "购买设备即可使用 SN 码参与"} · 每天 {activity ? formatDrawTime(activity.drawHour, activity.drawMinute) : "20:00"} 自动开奖
          </p>
        </div>
        <div className="grid gap-4 p-6 md:grid-cols-3">
          <div className="rounded-2xl border border-white/25 bg-white/55 p-4 text-center dark:border-white/10 dark:bg-slate-900/45">
            <p className="text-xs text-slate-500 dark:text-slate-400">距离开奖</p>
            <p className="mt-2 font-mono text-2xl font-semibold text-violet-700 dark:text-violet-200">
              {loading ? "—" : countdown || "00:00:00"}
            </p>
          </div>
          <div className="rounded-2xl border border-white/25 bg-white/55 p-4 text-center dark:border-white/10 dark:bg-slate-900/45">
            <p className="text-xs text-slate-500 dark:text-slate-400">当前参与人数</p>
            <p className="mt-2 text-2xl font-semibold text-violet-700 dark:text-violet-200">
              {loading ? "—" : activity?.participantCount ?? 0}
            </p>
          </div>
          <div className="rounded-2xl border border-white/25 bg-white/55 p-4 text-center dark:border-white/10 dark:bg-slate-900/45">
            <p className="text-xs text-slate-500 dark:text-slate-400">我的状态</p>
            <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-100">
              {loading ? "—" : activity?.isWinner ? "已中奖" : activity?.hasJoined ? "已报名" : "未报名"}
            </p>
          </div>
        </div>
      </SitePanel>

      {loading ? <SiteLoadingBlock>加载活动中…</SiteLoadingBlock> : null}

      {!loading && activity ? (
        <>
          <SitePanel>
            <SiteSectionTitle title="活动规则" description={activity.rule} />
            {prizeCard}
          </SitePanel>

          {activity.isWinner && activity.contactStatus === "pending" ? (
            <SiteAlert variant="info">
              恭喜中奖！请尽快填写收货信息。
              <Link to="/activities/prize-info" className="ml-2 underline">
                去填写
              </Link>
            </SiteAlert>
          ) : null}

          <SitePanel>
            <SiteSectionTitle
              title="SN 码报名"
              description="输入设备 SN 编号参与本期抽奖。每个 SN 每 24 小时仅可参与一次。"
            />
            <div className="mt-4 space-y-3">
              <SiteInput
                value={sn}
                onChange={(e) => setSn(e.target.value)}
                placeholder="请输入设备 SN 编号"
                disabled={activity.hasJoined || submitting}
              />
              <SiteButton
                type="button"
                disabled={!sn.trim() || activity.hasJoined || submitting}
                onClick={() => void handleJoin()}
                className="w-full sm:w-auto"
              >
                {activity.hasJoined ? "今日已报名" : submitting ? "提交中…" : "立即报名"}
              </SiteButton>
              {activity.hasJoined && activity.joinedSn ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">已报名 SN：{activity.joinedSn}</p>
              ) : null}
            </div>
          </SitePanel>
        </>
      ) : null}

      {notice ? <SiteAlert variant="success">{notice}</SiteAlert> : null}
      {errorMessage ? <SiteAlert variant="error">{errorMessage}</SiteAlert> : null}

      <div className="flex flex-wrap gap-3">
        <Link to="/activities">
          <SiteButton type="button" className="bg-transparent text-slate-700 ring-1 ring-slate-300 dark:text-slate-200 dark:ring-slate-600">
            返回活动中心
          </SiteButton>
        </Link>
      </div>
    </SitePageLayout>
  );
}
