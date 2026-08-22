import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CreditLedgerPanel } from "../components/CreditLedgerPanel";
import { SitePageLayout } from "../components/SitePageLayout";
import {
  SiteAlert,
  SiteButton,
  SiteEmptyBlock,
  SiteLoadingBlock,
  SitePanel,
  SiteSectionTitle,
  SITE_CONTENT_MEDIUM,
} from "../components/SiteUi";
import { useThemeMode } from "../hooks/useThemeMode";
import { hasValidLocalAuth } from "../services/authService";
import { DEFAULT_AI_CREDITS } from "../services/profileService";
import { fetchShopCatalog, redeemShopItem } from "../services/shopService";
import type { CreditLedgerEntry } from "../types/credits";
import type { ShopItem } from "../types/shop";
import { formatCredits } from "../utils/formatCredits";

function rewardLabel(item: ShopItem): string {
  switch (item.effect.type) {
    case "grant_code":
      return "兑换码商品";
    case "reset_ai_share":
      return "次数权益";
    case "add_credits":
      return "积分权益";
    default:
      return "积分商品";
  }
}

export default function ShopPage() {
  const navigate = useNavigate();
  const { theme, setTheme } = useThemeMode();
  const [loading, setLoading] = useState(true);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [confirmItem, setConfirmItem] = useState<ShopItem | null>(null);
  const [credits, setCredits] = useState<number>(DEFAULT_AI_CREDITS);
  const [likeRewardCredits, setLikeRewardCredits] = useState(1);
  const [actorLikeRewardCredits, setActorLikeRewardCredits] = useState(0.5);
  const [actorLikeDailyCapCredits, setActorLikeDailyCapCredits] = useState(5);
  const [actorLikeDailyLimit, setActorLikeDailyLimit] = useState(10);
  const [downloadRewardCredits, setDownloadRewardCredits] = useState(0.5);
  const [downloadDailyCapCredits, setDownloadDailyCapCredits] = useState(20);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [creditLedger, setCreditLedger] = useState<CreditLedgerEntry[]>([]);
  const [notice, setNotice] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadCatalog = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setErrorMessage("");
    try {
      const payload = await fetchShopCatalog();
      setCredits(typeof payload.credits === "number" ? payload.credits : DEFAULT_AI_CREDITS);
      setLikeRewardCredits(typeof payload.likeRewardCredits === "number" ? payload.likeRewardCredits : 1);
      setActorLikeRewardCredits(
        typeof payload.actorLikeRewardCredits === "number" ? payload.actorLikeRewardCredits : 0.5,
      );
      setActorLikeDailyCapCredits(
        typeof payload.actorLikeDailyCapCredits === "number" ? payload.actorLikeDailyCapCredits : 5,
      );
      setActorLikeDailyLimit(
        typeof payload.actorLikeDailyLimit === "number" ? payload.actorLikeDailyLimit : 10,
      );
      setDownloadRewardCredits(
        typeof payload.downloadRewardCredits === "number" ? payload.downloadRewardCredits : 0.5,
      );
      setDownloadDailyCapCredits(
        typeof payload.downloadDailyCapCredits === "number" ? payload.downloadDailyCapCredits : 20,
      );
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setCreditLedger(Array.isArray(payload.creditLedger) ? payload.creditLedger : []);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "加载商城失败");
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    void loadCatalog();
  }, [navigate]);

  const handleRedeem = async (item: ShopItem) => {
    if (redeemingId) return;
    setRedeemingId(item.id);
    setNotice("");
    setRedeemCode("");
    setCopied(false);
    setErrorMessage("");
    try {
      const result = await redeemShopItem(item.id);
      if (typeof result.creditsRemaining === "number") setCredits(result.creditsRemaining);
      if (result.redeemCode) setRedeemCode(result.redeemCode);
      setNotice(result.message || `已兑换「${item.title}」`);
      setConfirmItem(null);
      await loadCatalog(false);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "兑换失败");
    } finally {
      setRedeemingId(null);
    }
  };

  const handleCopyCode = async () => {
    if (!redeemCode) return;
    try {
      await navigator.clipboard.writeText(redeemCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setErrorMessage("复制失败，请长按兑换码手动复制");
    }
  };

  return (
    <SitePageLayout
      subtitle="积分商城 · 用互动积分兑换专属权益"
      theme={theme}
      onSetTheme={setTheme}
      contentClassName={SITE_CONTENT_MEDIUM}
    >
      <SitePanel accent className="overflow-hidden">
        <div className="grid gap-6 md:grid-cols-[1.4fr_0.8fr] md:items-center">
          <div>
            <span className="inline-flex rounded-full bg-violet-600/10 px-3 py-1 text-xs font-semibold text-violet-700 dark:text-violet-200">佳点会员积分</span>
            <h1 className="mt-3 text-2xl font-bold text-slate-950 dark:text-white sm:text-3xl">积分商城</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600 dark:text-slate-300">
              分享优质素材、参与互动即可获得积分。兑换由服务器实时扣除积分，兑换成功后请及时保存权益信息。
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/share" className="rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500">上传素材赚积分</Link>
              <Link to="/" className="rounded-full border border-white/30 bg-white/60 px-4 py-2 text-sm text-slate-700 transition hover:bg-white/90 dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-100">去素材中心互动</Link>
            </div>
          </div>
          <div className="rounded-3xl border border-white/40 bg-white/70 p-5 text-center shadow-sm dark:border-white/10 dark:bg-slate-950/45">
            <p className="text-sm text-slate-500 dark:text-slate-400">当前可用积分</p>
            <div className="mt-2 text-4xl font-bold tracking-tight text-violet-700 dark:text-violet-200">{loading ? "—" : formatCredits(credits)}</div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">积分余额以服务器记录为准</p>
          </div>
        </div>
      </SitePanel>

      {notice ? <SiteAlert variant="success">{notice}</SiteAlert> : null}
      {errorMessage ? <SiteAlert variant="error">{errorMessage}</SiteAlert> : null}

      {redeemCode ? (
        <SitePanel className="border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-emerald-800 dark:text-emerald-200">兑换成功</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">兑换码仅在本次结果中展示，请立即复制保存。</p>
              <p className="mt-3 break-all rounded-2xl border border-emerald-200/80 bg-white/80 px-4 py-3 font-mono text-lg font-semibold tracking-wide text-emerald-800 dark:border-emerald-500/30 dark:bg-slate-950/40 dark:text-emerald-100">{redeemCode}</p>
            </div>
            <SiteButton type="button" variant="success" onClick={() => void handleCopyCode()}>{copied ? "已复制" : "复制兑换码"}</SiteButton>
          </div>
        </SitePanel>
      ) : null}

      <section aria-labelledby="shop-products-title">
        <SiteSectionTitle
          title="可兑换商品"
          description="选择商品后确认兑换，积分不足的商品会显示还差多少积分。"
          action={<span className="rounded-full bg-white/60 px-3 py-1.5 text-xs text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">共 {items.length} 件</span>}
        />
        <h2 id="shop-products-title" className="sr-only">积分商品列表</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {loading ? <div className="sm:col-span-2"><SiteLoadingBlock>加载商品中…</SiteLoadingBlock></div> : null}
          {!loading && items.length === 0 ? <div className="sm:col-span-2"><SiteEmptyBlock>暂无可兑换商品。</SiteEmptyBlock></div> : null}
          {!loading ? items.map((item) => {
            const affordable = credits >= item.cost;
            const missingCredits = Math.max(0, item.cost - credits);
            const progress = item.cost > 0 ? Math.min(100, (credits / item.cost) * 100) : 0;
            return (
              <SitePanel key={item.id} className="flex h-full flex-col transition hover:-translate-y-0.5 hover:shadow-lg">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-500 text-2xl text-white shadow-md shadow-violet-500/20" aria-hidden="true">🎁</div>
                  <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-200">{rewardLabel(item)}</span>
                </div>
                <div className="mt-4 flex-1">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{item.description}</p>
                </div>
                <div className="mt-5">
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">兑换进度</span>
                    <span className={affordable ? "font-medium text-emerald-600 dark:text-emerald-300" : "text-slate-500 dark:text-slate-400"}>{affordable ? "积分已满足" : `还差 ${formatCredits(missingCredits)} 积分`}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700/70">
                    <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-cyan-500 transition-all" style={{ width: `${progress}%` }} />
                  </div>
                </div>
                <div className="mt-5 flex items-center justify-between gap-3">
                  <div><span className="text-2xl font-bold text-violet-700 dark:text-violet-200">{formatCredits(item.cost)}</span><span className="ml-1 text-xs text-slate-500 dark:text-slate-400">积分</span></div>
                  <SiteButton type="button" disabled={!affordable || Boolean(redeemingId)} onClick={() => setConfirmItem(item)} className="px-5 py-2.5">{affordable ? "立即兑换" : "积分不足"}</SiteButton>
                </div>
              </SitePanel>
            );
          }) : null}
        </div>
      </section>

      <SitePanel>
        <SiteSectionTitle title="积分怎么获得" description="积分会自动计入当前设备账号，无需手动领取。" />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-violet-50/80 p-4 dark:bg-violet-500/10">
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">素材被点赞</div>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">每次有效点赞 +{formatCredits(likeRewardCredits)} 积分，不受点赞者每日次数限制。</p>
          </div>
          <div className="rounded-2xl bg-fuchsia-50/80 p-4 dark:bg-fuchsia-500/10">
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">点赞优质素材</div>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">每天前 {actorLikeDailyLimit} 次有效，每次 +{formatCredits(actorLikeRewardCredits)}，每日最高 {formatCredits(actorLikeDailyCapCredits)} 积分。</p>
          </div>
          <div className="rounded-2xl bg-cyan-50/80 p-4 dark:bg-cyan-500/10">
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">素材被下载</div>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">每次有效下载 +{formatCredits(downloadRewardCredits)} 积分，每日最高 {formatCredits(downloadDailyCapCredits)} 积分。</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">不能给自己点赞，也不能通过下载自己的素材获得积分。</p>
      </SitePanel>

      <SitePanel>
        <SiteSectionTitle title="积分记录" description="展示最近的积分收入和兑换支出。" />
        <CreditLedgerPanel entries={creditLedger} loading={loading} />
      </SitePanel>

      {confirmItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !redeemingId) setConfirmItem(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="redeem-confirm-title" className="w-full max-w-md rounded-3xl border border-white/30 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-slate-900">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-500 text-3xl text-white" aria-hidden="true">🎁</div>
            <h2 id="redeem-confirm-title" className="mt-4 text-xl font-bold text-slate-900 dark:text-white">确认兑换</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">确定使用 <strong className="text-violet-700 dark:text-violet-200">{formatCredits(confirmItem.cost)} 积分</strong>兑换“{confirmItem.title}”吗？兑换成功后积分将立即扣除。</p>
            <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-100/80 px-4 py-3 text-sm dark:bg-slate-950/60">
              <span className="text-slate-500 dark:text-slate-400">兑换后余额</span>
              <span className="font-semibold text-slate-800 dark:text-slate-100">{formatCredits(Math.max(0, credits - confirmItem.cost))} 积分</span>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <SiteButton type="button" variant="secondary" disabled={Boolean(redeemingId)} onClick={() => setConfirmItem(null)}>再想想</SiteButton>
              <SiteButton type="button" disabled={Boolean(redeemingId)} onClick={() => void handleRedeem(confirmItem)}>{redeemingId === confirmItem.id ? "兑换中…" : "确认兑换"}</SiteButton>
            </div>
          </div>
        </div>
      ) : null}
    </SitePageLayout>
  );
}
