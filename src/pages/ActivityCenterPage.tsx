import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ResourceLibraryHeader } from "../components/ResourceLibraryHeader";
import { SiteFooter } from "../components/SiteFooter";
import {
  ACTIVITIES,
  ACTIVITY_CATEGORY_LABELS,
  ACTIVITY_CENTER_INTRO,
  ACTIVITY_STATUS_LABELS,
  type ActivityItem,
  type ActivityStatus,
} from "../content/activityCenter";
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
  if (!item.startDate) return "长期有效";
  const start = formatActivityDate(item.startDate);
  if (item.endDate) {
    return `${start} — ${formatActivityDate(item.endDate)}`;
  }
  return `${start} 起`;
}

const STATUS_STYLES: Record<ActivityStatus, string> = {
  ongoing: "bg-[#e7fbf1] text-[#32b879]",
  upcoming: "bg-[#fff4e8] text-[#ff8a5c]",
  ended: "bg-[#f1f3f8] text-[#8a93a8]",
};

function ActivityBadge({ status }: { status: ActivityStatus }) {
  return (
    <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${STATUS_STYLES[status]}`}>
      {ACTIVITY_STATUS_LABELS[status]}
    </span>
  );
}

function ActivityCard({ item }: { item: ActivityItem }) {
  return (
    <article className="flex h-full flex-col rounded-[16px] border border-[#e6e9f2] bg-white p-5 shadow-[0_8px_24px_rgba(43,50,69,.04)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(43,50,69,.08)]">
      <div className="flex flex-wrap items-center gap-2">
        <ActivityBadge status={item.status} />
        <span className="rounded-full bg-[#f0edff] px-3 py-1 text-[11px] font-semibold text-[#7c6cf0]">
          {ACTIVITY_CATEGORY_LABELS[item.category]}
        </span>
      </div>

      <h3 className="mt-3 text-[17px] font-extrabold text-[#2b3245]">{item.title}</h3>
      <p className="mt-2 text-[13px] leading-6 text-[#6f7890]">{item.summary}</p>
      <p className="mt-3 flex-1 text-[12px] leading-6 text-[#8a93a8]">{item.body}</p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#eef0f6] pt-4">
        <p className="text-[11px] text-[#8a93a8]">{formatActivityRange(item)}</p>
        {item.linkTo && item.linkLabel ? (
          <div className="flex flex-wrap gap-2">
            <Link to={item.linkTo} className="rounded-full bg-gradient-to-br from-[#ff8a5c] to-[#ff6f9c] px-4 py-2 text-xs font-semibold text-white shadow-[0_4px_10px_rgba(255,138,92,.2)]">
              {item.linkLabel}
            </Link>
            {item.id === "device-lottery" ? (
              <Link to="/activities/winners" className="rounded-full border border-[#e6e9f2] bg-white px-4 py-2 text-xs font-semibold text-[#4a5270] hover:border-[#7c6cf0] hover:text-[#7c6cf0]">
                中奖名单
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default function ActivityCenterPage() {
  const navigate = useNavigate();

  const promoActivity = ACTIVITIES.find((item) => item.id === "promo-choice-2026");
  const lotteryActivity = ACTIVITIES.find((item) => item.id === "device-lottery");
  const others = ACTIVITIES.filter(
    (item) => item.id !== "promo-choice-2026" && item.id !== "device-lottery",
  );
  const ongoingCount = ACTIVITIES.filter((item) => item.status === "ongoing").length;

  useEffect(() => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
    }
  }, [navigate]);

  return (
    <div className="site-page-shell resource-library-shell min-h-screen text-[#2b3245]">
      <ResourceLibraryHeader keyword="" onSearch={(value) => navigate(value ? `/?q=${encodeURIComponent(value)}` : "/")} />
      <main className="mx-auto max-w-[1120px] space-y-[14px] px-4 py-6 sm:px-6">
        <section className="overflow-hidden rounded-[18px] border border-[#e6e9f2] bg-white shadow-[0_10px_30px_rgba(43,50,69,.06)]">
          <div className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 px-5 py-6 sm:px-8">
            <div className="grid h-16 w-16 place-items-center rounded-[20px] bg-gradient-to-br from-[#ff8a5c] to-[#7c6cf0] text-3xl text-white shadow-[0_8px_20px_rgba(124,108,240,.24)]">🎁</div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[.2em] text-[#ff8a5c]">Events & Rewards</p>
              <h1 className="mt-1 text-2xl font-extrabold">活动中心</h1>
            </div>
            <div className="col-start-3 row-start-1 rounded-[16px] bg-[#fff7f2] px-4 py-3 text-center sm:row-span-2 sm:px-6">
              <p className="text-[11px] font-semibold text-[#8a93a8]">正在进行</p>
              <p className="mt-0.5 text-2xl font-extrabold text-[#ff8a5c]">{ongoingCount}</p>
            </div>
            <p className="col-span-3 max-w-2xl text-[13px] leading-6 text-[#8a93a8] sm:col-span-1 sm:col-start-2">{ACTIVITY_CENTER_INTRO}</p>
          </div>
        </section>

      {promoActivity ? (
        <section className="overflow-hidden rounded-[18px] border border-[#e6e9f2] bg-white shadow-[0_10px_30px_rgba(43,50,69,.05)]">
          <div className="bg-gradient-to-r from-[#ff8a5c] via-[#ff6f9c] to-[#7c6cf0] px-6 py-5 text-white sm:px-8">
            <p className="text-[11px] font-bold uppercase tracking-[.22em] text-white/80">精选活动</p>
            <h2 className="mt-2 text-xl font-extrabold sm:text-2xl">{promoActivity.title}</h2>
            <p className="mt-2 max-w-3xl text-[13px] leading-6 text-white/90">{promoActivity.summary}</p>
          </div>
          <div className="space-y-4 p-6 sm:px-8">
            <div className="flex flex-wrap items-center gap-2">
              <ActivityBadge status={promoActivity.status} />
              <span className="rounded-full bg-[#f0edff] px-3 py-1 text-[11px] font-semibold text-[#7c6cf0]">
                {ACTIVITY_CATEGORY_LABELS[promoActivity.category]}
              </span>
              <span className="text-[11px] text-[#8a93a8]">{formatActivityRange(promoActivity)}</span>
            </div>
            <p className="text-[13px] leading-7 text-[#6f7890]">{promoActivity.body}</p>
            {promoActivity.linkTo && promoActivity.linkLabel ? (
              <Link to={promoActivity.linkTo} className="inline-flex rounded-full bg-gradient-to-br from-[#ff8a5c] to-[#ff6f9c] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(255,138,92,.25)]">
                {promoActivity.linkLabel}
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {lotteryActivity ? <ActivityCard item={lotteryActivity} /> : null}

      <div className="flex items-end justify-between gap-3 px-1 pt-2">
        <div>
          <h2 className="text-lg font-extrabold">全部活动</h2>
          <p className="mt-1 text-xs text-[#8a93a8]">浏览当前可参与的活动与平台更新</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {others.map((item) => (
          <ActivityCard key={item.id} item={item} />
        ))}
      </div>
      </main>
      <SiteFooter />
    </div>
  );
}
