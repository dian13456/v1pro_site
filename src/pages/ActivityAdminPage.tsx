import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AdminLoginPanel } from "../components/AdminLoginPanel";
import { SitePageLayout } from "../components/SitePageLayout";
import {
  SiteAlert,
  SiteButton,
  SiteLoadingBlock,
  SitePanel,
  SiteSectionTitle,
  SITE_CONTENT_MEDIUM,
} from "../components/SiteUi";
import { useAdminSession } from "../hooks/useAdminSession";
import { useThemeMode } from "../hooks/useThemeMode";
import { getAdminToken } from "../services/adminAuthService";
import {
  adminFetchActivities,
  adminFetchJoins,
  adminFetchWinnerContact,
  adminFetchWinners,
  adminSaveActivity,
  adminTriggerDraw,
  adminUpdateShipping,
} from "../services/activityService";
import type { ActivityAdminItem, ActivityJoinRecord, ActivityWinnerRecord, WinnerContactInfo } from "../types/activity";

export default function ActivityAdminPage() {
  const { theme, setTheme } = useThemeMode();
  const { adminToken, authenticated, refreshSession, logout, handleUnauthorized } = useAdminSession();
  const [loading, setLoading] = useState(false);
  const [activities, setActivities] = useState<ActivityAdminItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [joins, setJoins] = useState<ActivityJoinRecord[]>([]);
  const [winners, setWinners] = useState<ActivityWinnerRecord[]>([]);
  const [contact, setContact] = useState<WinnerContactInfo | null>(null);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadAll = async (token: string) => {
    setLoading(true);
    setErrorMessage("");
    try {
      const items = await adminFetchActivities(token);
      setActivities(items);
      const active = items.find((item) => item.status === "active") || items[0];
      if (active) {
        setSelectedId(active.id);
        const [joinList, winnerList] = await Promise.all([
          adminFetchJoins(token, active.id),
          adminFetchWinners(token, active.id),
        ]);
        setJoins(joinList);
        setWinners(winnerList);
      }
      setNotice("数据已刷新");
    } catch (err) {
      const message = (err as Error)?.message || "加载失败，请重新登录";
      if (message.includes("token") || message.includes("无效") || message.includes("未授权")) {
        handleUnauthorized();
      }
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authenticated && adminToken) {
      void loadAll(adminToken);
    }
  }, []);

  const handleLoggedIn = () => {
    refreshSession();
    void loadAll(getAdminToken());
  };

  const handleSelectActivity = async (id: string) => {
    setSelectedId(id);
    if (!adminToken) return;
    try {
      const [joinList, winnerList] = await Promise.all([
        adminFetchJoins(adminToken, id),
        adminFetchWinners(adminToken, id),
      ]);
      setJoins(joinList);
      setWinners(winnerList);
      setContact(null);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "加载活动数据失败");
    }
  };

  const handleCreateDefault = async () => {
    if (!adminToken) return;
    try {
      const now = Date.now();
      await adminSaveActivity(adminToken, {
        title: "设备用户专属抽奖活动",
        description: "购买设备即可使用 SN 码参与",
        rule: "每天 0:00 起开放报名，原报名信息清零；每天 15:00 自动开奖。",
        startTime: now - 86400000,
        endTime: now + 86400000 * 365,
        status: "active",
        prizeTitle: "V1PRO 限定周边礼包",
        prizeDescription: "含定制壳子、贴纸与品牌周边",
        drawHour: 15,
        drawMinute: 0,
        winnersPerDraw: 1,
        shippingDays: 7,
      });
      await loadAll(adminToken);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "创建活动失败");
    }
  };

  const handleDraw = async () => {
    if (!adminToken || !selectedId) return;
    try {
      await adminTriggerDraw(adminToken, selectedId, "", true);
      await handleSelectActivity(selectedId);
      setNotice("手动开奖完成");
    } catch (err) {
      setErrorMessage((err as Error)?.message || "开奖失败");
    }
  };

  const handleViewContact = async (winnerId: string) => {
    if (!adminToken) return;
    try {
      const info = await adminFetchWinnerContact(adminToken, winnerId);
      setContact(info);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "读取联系方式失败");
    }
  };

  const handleMarkShipped = async (winnerId: string) => {
    if (!adminToken) return;
    try {
      await adminUpdateShipping(adminToken, winnerId, "shipped");
      await handleSelectActivity(selectedId);
      setNotice("已标记为已发货");
    } catch (err) {
      setErrorMessage((err as Error)?.message || "更新发货状态失败");
    }
  };

  const exportJoinsCsv = () => {
    const header = "id,sn,userSerial,joinTime,drawPeriod,status\n";
    const rows = joins
      .map((item) => `${item.id},${item.sn},${item.userSerial},${item.joinTime},${item.drawPeriod},${item.status}`)
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activity-joins-${selectedId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <SitePageLayout
      subtitle="活动管理后台 · 需管理员密码"
      theme={theme}
      onSetTheme={setTheme}
      contentClassName={SITE_CONTENT_MEDIUM}
    >
      {!authenticated ? (
        <AdminLoginPanel
          description="输入后台密码后可管理抽奖活动、开奖与发货。"
          onLoggedIn={handleLoggedIn}
        />
      ) : (
        <SitePanel>
          <SiteSectionTitle
            title="已登录管理后台"
            description="当前会话有效，可进行操作。"
            action={
              <div className="flex flex-wrap gap-2">
                <Link to="/activities/promo-admin">
                  <SiteButton type="button" variant="secondary">
                    福利活动审核
                  </SiteButton>
                </Link>
                <SiteButton type="button" variant="secondary" onClick={logout}>
                  退出登录
                </SiteButton>
              </div>
            }
          />
        </SitePanel>
      )}

      {loading ? <SiteLoadingBlock>加载中…</SiteLoadingBlock> : null}
      {notice ? <SiteAlert variant="success">{notice}</SiteAlert> : null}
      {errorMessage ? <SiteAlert variant="error">{errorMessage}</SiteAlert> : null}

      {authenticated && adminToken ? (
        <>
          <SitePanel>
            <SiteSectionTitle
              title="活动列表"
              action={
                <div className="flex flex-wrap gap-2">
                  <SiteButton type="button" onClick={() => void loadAll(adminToken)}>
                    刷新
                  </SiteButton>
                  <SiteButton type="button" onClick={() => void handleCreateDefault()}>
                    创建默认活动
                  </SiteButton>
                  <SiteButton type="button" onClick={() => void handleDraw()} disabled={!selectedId}>
                    手动开奖
                  </SiteButton>
                </div>
              }
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {activities.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void handleSelectActivity(item.id)}
                  className={`rounded-full px-4 py-2 text-sm ${
                    selectedId === item.id
                      ? "bg-violet-600 text-white"
                      : "border border-white/25 bg-white/55 text-slate-700 dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-200"
                  }`}
                >
                  {item.title}
                </button>
              ))}
            </div>
          </SitePanel>

          <div className="grid gap-4 lg:grid-cols-2">
            <SitePanel>
              <SiteSectionTitle
                title={`报名记录 (${joins.length})`}
                action={
                  <SiteButton type="button" onClick={exportJoinsCsv} disabled={joins.length === 0}>
                    导出 CSV
                  </SiteButton>
                }
              />
              <div className="mt-3 max-h-80 space-y-2 overflow-auto text-xs">
                {joins.map((item) => (
                  <div key={item.id} className="rounded-xl border border-white/20 bg-white/50 p-2 dark:border-white/10 dark:bg-slate-950/40">
                    <p>SN: {item.sn}</p>
                    <p>用户: {item.userSerial}</p>
                    <p>周期: {item.drawPeriod} · {item.status}</p>
                  </div>
                ))}
              </div>
            </SitePanel>

            <SitePanel>
              <SiteSectionTitle title={`中奖名单 (${winners.length})`} />
              <div className="mt-3 max-h-80 space-y-2 overflow-auto text-xs">
                {winners.map((item) => (
                  <div key={item.id} className="rounded-xl border border-white/20 bg-white/50 p-2 dark:border-white/10 dark:bg-slate-950/40">
                    <p>SN: {item.sn}</p>
                    <p>联系: {item.contactStatus} · 发货: {item.shippingStatus}</p>
                    <div className="mt-2 flex gap-2">
                      <SiteButton type="button" className="px-3 py-1 text-xs" onClick={() => void handleViewContact(item.id)}>
                        查看联系方式
                      </SiteButton>
                      {item.shippingStatus !== "shipped" ? (
                        <SiteButton type="button" className="px-3 py-1 text-xs" onClick={() => void handleMarkShipped(item.id)}>
                          标记已发货
                        </SiteButton>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              {contact ? (
                <div className="mt-3 rounded-xl border border-emerald-200/60 bg-emerald-50/70 p-3 text-sm dark:border-emerald-500/20 dark:bg-emerald-500/10">
                  <p>姓名: {contact.name}</p>
                  <p>手机: {contact.phone}</p>
                  <p>QQ: {contact.qq || "—"}</p>
                  <p>微信: {contact.wechat || "—"}</p>
                  <p>地址: {contact.province} {contact.city} {contact.address}</p>
                </div>
              ) : null}
            </SitePanel>
          </div>
        </>
      ) : null}

      <Link to="/activities">
        <SiteButton type="button" className="bg-transparent text-slate-700 ring-1 ring-slate-300 dark:text-slate-200 dark:ring-slate-600">
          返回活动中心
        </SiteButton>
      </Link>
    </SitePageLayout>
  );
}
