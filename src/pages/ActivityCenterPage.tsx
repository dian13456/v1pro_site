import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SitePageLayout } from "../components/SitePageLayout";
import {
  SiteButton,
  SiteCard,
  SitePanel,
  SiteSectionTitle,
  SITE_CONTENT_MEDIUM,
} from "../components/SiteUi";
import {
  ACTIVITIES,
  ACTIVITY_CATEGORY_LABELS,
  ACTIVITY_CENTER_INTRO,
  ACTIVITY_STATUS_LABELS,
  type ActivityItem,
  type ActivityStatus,
} from "../content/activityCenter";
import { useThemeMode } from "../hooks/useThemeMode";
import { hasValidLocalAuth } from "../services/authService";

function formatActivityDate(raw: string): string {
  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatActivityRange(item: ActivityItem): string {
  const start = formatActivityDate(item.startDate);
  if (item.endDate) {
    return `${start} — ${formatActivityDate(item.endDate)}`;
  }
  return `${start} 起`;
}

const STATUS_STYLES: Record<ActivityStatus, string> = {
  ongoing:
    "border-emerald-200/70 bg-emerald-50/90 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
  upcoming:
    "border-amber-200/70 bg-amber-50/90 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
  ended:
    "border-slate-200/70 bg-slate-100/90 text-slate-600 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-300",
};

function ActivityBadge({ status }: { status: ActivityStatus }) {
  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {ACTIVITY_STATUS_LABELS[status]}
    </span>
  );
}

function ActivityCard({ item }: { item: ActivityItem }) {
  return (
    <SiteCard className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2">
        <ActivityBadge status={item.status} />
        <span className="rounded-full border border-violet-200/70 bg-violet-50/80 px-3 py-1 text-xs text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200">
          {ACTIVITY_CATEGORY_LABELS[item.category]}
        </span>
      </div>

      <h3 className="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">{item.title}</h3>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{item.summary}</p>
      <p className="mt-3 flex-1 text-sm leading-7 text-slate-700 dark:text-slate-300">{item.body}</p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/25 pt-4 dark:border-white/10">
        <p className="text-xs text-slate-500 dark:text-slate-400">{formatActivityRange(item)}</p>
        {item.linkTo && item.linkLabel ? (
          <Link to={item.linkTo}>
            <SiteButton type="button">{item.linkLabel}</SiteButton>
          </Link>
        ) : null}
      </div>
    </SiteCard>
  );
}

export default function ActivityCenterPage() {
  const navigate = useNavigate();
  const { theme, setTheme } = useThemeMode();

  const featured = ACTIVITIES.find((item) => item.featured);
  const others = ACTIVITIES.filter((item) => !item.featured);
  const ongoingCount = ACTIVITIES.filter((item) => item.status === "ongoing").length;

  useEffect(() => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
    }
  }, [navigate]);

  return (
    <SitePageLayout
      subtitle="活动中心 · 公告与积分福利"
      theme={theme}
      onSetTheme={setTheme}
      contentClassName={SITE_CONTENT_MEDIUM}
    >
      <SitePanel accent>
        <SiteSectionTitle
          title="活动中心"
          description={ACTIVITY_CENTER_INTRO}
          action={
            <div className="rounded-2xl border border-white/30 bg-white/60 px-4 py-2 text-center dark:border-white/10 dark:bg-slate-950/40">
              <p className="text-xs text-slate-500 dark:text-slate-400">进行中</p>
              <p className="text-2xl font-semibold text-violet-700 dark:text-violet-200">{ongoingCount}</p>
            </div>
          }
        />
      </SitePanel>

      {featured ? (
        <SitePanel className="overflow-hidden p-0">
          <div className="bg-gradient-to-r from-violet-600/90 via-fuchsia-500/85 to-cyan-500/80 px-6 py-5 text-white">
            <p className="text-xs uppercase tracking-[0.24em] text-white/80">Featured</p>
            <h2 className="mt-2 text-2xl font-semibold">{featured.title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-white/90">{featured.summary}</p>
          </div>
          <div className="space-y-4 p-6">
            <div className="flex flex-wrap items-center gap-2">
              <ActivityBadge status={featured.status} />
              <span className="rounded-full border border-violet-200/70 bg-violet-50/80 px-3 py-1 text-xs text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200">
                {ACTIVITY_CATEGORY_LABELS[featured.category]}
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400">{formatActivityRange(featured)}</span>
            </div>
            <p className="text-sm leading-7 text-slate-700 dark:text-slate-300">{featured.body}</p>
            {featured.linkTo && featured.linkLabel ? (
              <Link to={featured.linkTo}>
                <SiteButton type="button">{featured.linkLabel}</SiteButton>
              </Link>
            ) : null}
          </div>
        </SitePanel>
      ) : null}

      <SiteSectionTitle title="全部活动" description="浏览当前可参与的活动与平台更新。" />

      <div className="grid gap-4 md:grid-cols-2">
        {others.map((item) => (
          <ActivityCard key={item.id} item={item} />
        ))}
      </div>
    </SitePageLayout>
  );
}
