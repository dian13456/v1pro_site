import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CreditLedgerPanel } from "../components/CreditLedgerPanel";
import { ResourceLibraryHeader } from "../components/ResourceLibraryHeader";
import { SiteFooter } from "../components/SiteFooter";
import {
  SiteAlert,
  SiteInput,
  SiteTextarea,
} from "../components/SiteUi";
import { hasValidLocalAuth } from "../services/authService";
import { DEFAULT_AI_CREDITS } from "../services/profileService";
import { fetchShopCatalog, redeemShopItem } from "../services/shopService";
import { loadMallAddresses, saveMallAddress, toShippingInput } from "../services/mallAddressBook";
import type { CreditLedgerEntry } from "../types/credits";
import type { MallShippingInput } from "../types/mall";
import type { ShopItem } from "../types/shop";
import { formatCredits } from "../utils/formatCredits";

const PHONE_PATTERN = /^1\d{10}$/;
const QQ_PATTERN = /^[1-9]\d{4,11}$/;
type ShopCategory = "all" | "grant_code" | "reset_ai_share" | "add_credits" | "physical";
const EMPTY_SHIPPING: MallShippingInput = {
  name: "",
  phone: "",
  wechat: "",
  qq: "",
  province: "",
  city: "",
  address: "",
  remark: "",
};

function rewardLabel(item: ShopItem): string {
  switch (item.effect.type) {
    case "grant_code":
      return "兑换码商品";
    case "reset_ai_share":
      return "次数权益";
    case "add_credits":
      return "积分权益";
    case "physical":
      return "实物商品";
    default:
      return "积分商品";
  }
}

export default function ShopPage() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<ShopCategory>("all");
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
  const [redeemOrderId, setRedeemOrderId] = useState("");
  const [shipping, setShipping] = useState<MallShippingInput>(EMPTY_SHIPPING);
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
    if (item.effect.type === "physical") {
      if (!shipping.name.trim() || !shipping.phone.trim() || !shipping.qq.trim() || !shipping.province.trim() || !shipping.city.trim() || !shipping.address.trim()) {
        setErrorMessage("请完整填写收货人、手机、QQ、省市和详细地址");
        return;
      }
      if (!PHONE_PATTERN.test(shipping.phone.trim())) {
        setErrorMessage("手机号格式不正确");
        return;
      }
      if (!QQ_PATTERN.test(shipping.qq.trim())) {
        setErrorMessage("QQ 号格式不正确");
        return;
      }
    }
    setRedeemingId(item.id);
    setNotice("");
    setRedeemCode("");
    setRedeemOrderId("");
    setCopied(false);
    setErrorMessage("");
    try {
      const result = await redeemShopItem(item.id, item.effect.type === "physical" ? shipping : undefined);
      if (typeof result.creditsRemaining === "number") setCredits(result.creditsRemaining);
      if (result.redeemCode) setRedeemCode(result.redeemCode);
      if (result.orderId) {
        setRedeemOrderId(result.orderId);
        try {
          saveMallAddress(shipping);
        } catch {
          // 订单成功优先，地址簿已满不影响兑换结果。
        }
      }
      setNotice(result.message || `已兑换「${item.title}」`);
      setConfirmItem(null);
      await loadCatalog(false);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "兑换失败");
    } finally {
      setRedeemingId(null);
    }
  };

  const openRedeemConfirm = (item: ShopItem) => {
    setErrorMessage("");
    if (item.effect.type === "physical") {
      const saved = loadMallAddresses()[0];
      if (saved) setShipping(toShippingInput(saved));
    }
    setConfirmItem(item);
  };

  const updateShipping = (field: keyof MallShippingInput, value: string) => {
    setShipping((current) => ({ ...current, [field]: value }));
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

  const normalizedKeyword = keyword.trim().toLowerCase();
  const visibleItems = items.filter((item) => {
    const matchesCategory = category === "all" || item.effect.type === category;
    const matchesKeyword = !normalizedKeyword
      || `${item.title} ${item.description} ${rewardLabel(item)}`.toLowerCase().includes(normalizedKeyword);
    return matchesCategory && matchesKeyword;
  });

  const categoryOptions: Array<{ value: ShopCategory; label: string; icon: string }> = [
    { value: "all", label: "全部商品", icon: "▰" },
    { value: "grant_code", label: "兑换码商品", icon: "⌘" },
    { value: "reset_ai_share", label: "次数权益", icon: "↻" },
    { value: "add_credits", label: "积分权益", icon: "✦" },
    { value: "physical", label: "实物商品", icon: "⬡" },
  ];

  const categoryCount = (value: ShopCategory) => value === "all"
    ? items.length
    : items.filter((item) => item.effect.type === value).length;

  return (
    <div className="site-page-shell resource-library-shell min-h-screen text-[#2b3245]">
      <ResourceLibraryHeader keyword={keyword} onSearch={setKeyword} searchPlaceholder="搜索积分商品…" />
      <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">
        <div className="grid gap-5 lg:grid-cols-[218px_minmax(0,1fr)]">
          <aside className="space-y-[14px]">
            <section className="overflow-hidden rounded-[14px] border border-[#e6e9f2] bg-white dark:border-slate-800 dark:bg-slate-900">
              <h2 className="px-[18px] pb-2.5 pt-[18px] text-xs font-normal tracking-[1px] text-[#8a93a8] dark:text-slate-400">商品分类</h2>
              <div className="pb-3.5">
                {categoryOptions.map((option) => {
                  const active = category === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setCategory(option.value)}
                      className={`relative flex w-full items-center gap-[9px] px-[18px] py-2 text-left text-[13.5px] transition ${active ? "font-bold text-[#ff8a5c]" : "text-[#4a5270] hover:bg-[#f6f7fd] hover:text-[#ff8a5c] dark:text-slate-300 dark:hover:bg-slate-800"}`}
                    >
                      {active ? <span className="absolute inset-y-0 left-0 w-[3px] rounded-r bg-gradient-to-b from-[#ff8a5c] to-[#7c6cf0]" /> : null}
                      <span className="w-5 text-center text-[15px]">{option.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      <span className="text-[11px] font-normal text-[#c2c8da] dark:text-slate-500">{categoryCount(option.value)}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-[14px] border border-[#e6e9f2] bg-white p-[18px] dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs tracking-[1px] text-[#8a93a8] dark:text-slate-400">积分账户</p>
              <div className="mt-3 rounded-xl bg-gradient-to-br from-[#fff3eb] to-[#fff0f5] p-4 dark:from-orange-500/10 dark:to-pink-500/10">
                <p className="text-xs text-[#697086] dark:text-slate-400">当前可用积分</p>
                <p className="mt-1 text-[28px] font-extrabold tracking-tight text-[#ff7448]">{loading ? "—" : formatCredits(credits)}</p>
                <p className="mt-1 text-[11px] text-[#9aa2b5] dark:text-slate-500">以服务器余额为准</p>
              </div>
              <Link to="/leaderboard" className="mt-3 flex items-center justify-between rounded-lg px-1 py-1.5 text-[13px] text-[#4a5270] transition hover:text-[#ff8a5c] dark:text-slate-300">
                <span>🏆 查看积分榜</span><span>›</span>
              </Link>
            </section>

            <section className="rounded-[14px] border border-[#e6e9f2] bg-white p-[18px] dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs tracking-[1px] text-[#8a93a8] dark:text-slate-400">快捷入口</p>
              <div className="mt-3 space-y-1">
                <Link to="/share" className="block rounded-lg px-2 py-2 text-[13px] text-[#4a5270] transition hover:bg-[#f6f7fd] hover:text-[#ff8a5c] dark:text-slate-300 dark:hover:bg-slate-800">⬆ 上传素材赚积分</Link>
                <Link to="/" className="block rounded-lg px-2 py-2 text-[13px] text-[#4a5270] transition hover:bg-[#f6f7fd] hover:text-[#ff8a5c] dark:text-slate-300 dark:hover:bg-slate-800">♡ 去素材中心互动</Link>
                <Link to="/mall" className="block rounded-lg px-2 py-2 text-[13px] text-[#4a5270] transition hover:bg-[#f6f7fd] hover:text-[#ff8a5c] dark:text-slate-300 dark:hover:bg-slate-800">▦ 查看实物订单</Link>
              </div>
            </section>
          </aside>

          <div className="min-w-0 space-y-5">
            <section className="relative overflow-hidden rounded-2xl border border-[#e6e9f2] bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7">
              <div className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-gradient-to-br from-[#ffb083]/30 to-[#ff78a5]/25 blur-2xl" />
              <div className="relative grid gap-5 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
                <div>
                  <span className="inline-flex rounded-full bg-[#fff1eb] px-3 py-1 text-xs font-semibold text-[#ff7448] dark:bg-orange-500/10">佳点会员积分</span>
                  <h1 className="mt-3 text-2xl font-extrabold tracking-tight text-[#2b3245] dark:text-white sm:text-3xl">积分商城</h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-[#697086] dark:text-slate-300">分享优质素材、参与互动即可获得积分。兑换由服务器实时扣除积分，成功后请及时保存权益信息。</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link to="/share" className="rounded-full bg-gradient-to-br from-[#ff8a5c] to-[#ff6f9c] px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(255,138,92,.28)] transition hover:-translate-y-0.5">上传素材赚积分</Link>
                    <Link to="/" className="rounded-full border border-[#e6e9f2] bg-white px-4 py-2 text-sm font-medium text-[#4a5270] transition hover:border-[#ff8a5c] hover:text-[#ff8a5c] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">返回素材主页</Link>
                  </div>
                </div>
                <div className="rounded-2xl border border-[#edf0f6] bg-[#fafbfe] p-5 text-center dark:border-slate-700 dark:bg-slate-950/50">
                  <p className="text-xs text-[#8a93a8] dark:text-slate-400">当前可用积分</p>
                  <p className="mt-1 text-4xl font-extrabold tracking-tight text-[#ff7448]">{loading ? "—" : formatCredits(credits)}</p>
                  <p className="mt-2 text-[11px] text-[#9aa2b5] dark:text-slate-500">兑换时实时校验余额</p>
                </div>
              </div>
            </section>

            {notice ? <SiteAlert variant="success">{notice}</SiteAlert> : null}
            {errorMessage ? <SiteAlert variant="error">{errorMessage}</SiteAlert> : null}

            {redeemCode ? (
              <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-emerald-800 dark:text-emerald-200">兑换成功</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">兑换码仅在本次结果中展示，请立即复制保存。</p>
                    <p className="mt-3 break-all rounded-xl border border-emerald-200 bg-white px-4 py-3 font-mono text-lg font-semibold tracking-wide text-emerald-800 dark:border-emerald-500/30 dark:bg-slate-950/40 dark:text-emerald-100">{redeemCode}</p>
                  </div>
                  <button type="button" onClick={() => void handleCopyCode()} className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500">{copied ? "已复制" : "复制兑换码"}</button>
                </div>
              </section>
            ) : null}

            {redeemOrderId ? (
              <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                <p className="font-semibold text-emerald-800 dark:text-emerald-200">实物兑换成功，等待发货</p>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">订单号：<span className="select-all font-mono font-semibold">{redeemOrderId}</span></p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link to="/mall" className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500">查看实物商城订单</Link>
                  <span className="self-center text-xs text-slate-500 dark:text-slate-400">进入后点击“我的订单”查看物流单号。</span>
                </div>
              </section>
            ) : null}

            <section aria-labelledby="shop-products-title">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="shop-products-title" className="text-lg font-extrabold text-[#2b3245] dark:text-white">可兑换商品</h2>
                  <p className="mt-1 text-xs text-[#8a93a8] dark:text-slate-400">选择商品后确认兑换，积分不足会显示所差积分。</p>
                </div>
                <span className="rounded-full border border-[#e6e9f2] bg-white px-3 py-1.5 text-xs text-[#697086] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">共 {visibleItems.length} 件</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {loading ? <div className="col-span-full rounded-2xl border border-[#e6e9f2] bg-white py-16 text-center text-sm text-[#8a93a8] dark:border-slate-800 dark:bg-slate-900">加载商品中…</div> : null}
                {!loading && visibleItems.length === 0 ? <div className="col-span-full rounded-2xl border border-dashed border-[#cfd5ea] bg-white py-16 text-center text-sm text-[#8a93a8] dark:border-slate-700 dark:bg-slate-900">没有找到符合条件的商品。</div> : null}
                {!loading ? visibleItems.map((item, itemIndex) => {
            const affordable = credits >= item.cost;
            const soldOut = item.effect.type === "physical" && typeof item.stock === "number" && item.stock <= 0;
            const missingCredits = Math.max(0, item.cost - credits);
            const progress = item.cost > 0 ? Math.min(100, (credits / item.cost) * 100) : 0;
            const cardGradients = [
              "from-[#ffd1bd] via-[#ffb5ad] to-[#f6a8cf]",
              "from-[#c9f59c] via-[#aeeeb2] to-[#9ddfd4]",
              "from-[#bcdcf6] via-[#b8c9f7] to-[#d1b9ef]",
              "from-[#ffe0a9] via-[#ffc39f] to-[#ffa9b8]",
            ];
            return (
              <article key={item.id} className="group flex min-h-full flex-col overflow-hidden rounded-2xl border border-[#e6e9f2] bg-white shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-xl dark:border-slate-800 dark:bg-slate-900">
                <div className={`relative grid aspect-[1.618] place-items-center bg-gradient-to-br ${cardGradients[itemIndex % cardGradients.length]}`}>
                  <span className="absolute left-3 top-3 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-bold text-[#ff7448] shadow-sm backdrop-blur dark:bg-slate-900/75">{rewardLabel(item)}</span>
                  <span className="text-5xl drop-shadow-md transition duration-300 group-hover:scale-110" aria-hidden="true">🎁</span>
                  {item.effect.type === "physical" && typeof item.stock === "number" ? <span className="absolute bottom-3 right-3 rounded-full bg-slate-900/55 px-2.5 py-1 text-[11px] font-medium text-white">库存 {Math.max(0, item.stock)}</span> : null}
                </div>
                <div className="flex flex-1 flex-col p-3.5">
                  <h3 className="line-clamp-1 text-[15px] font-extrabold text-[#2b3245] dark:text-slate-100">{item.title}</h3>
                  <p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-[#697086] dark:text-slate-400">{item.description}</p>
                  {item.effect.type === "physical" && typeof item.stock === "number" ? (
                    <p className={`mt-2 text-xs font-medium ${soldOut ? "text-rose-600 dark:text-rose-300" : "text-emerald-600 dark:text-emerald-300"}`}>
                      {soldOut ? "当前库存不足" : `剩余库存 ${item.stock} 件`}
                    </p>
                  ) : null}
                  <div className="mt-auto pt-4">
                    <div className="mb-2 flex items-center justify-between text-[11px]">
                      <span className="text-[#9aa2b5] dark:text-slate-500">兑换进度</span>
                      <span className={affordable ? "font-medium text-emerald-600 dark:text-emerald-300" : "text-[#8a93a8] dark:text-slate-400"}>{affordable ? "积分已满足" : `还差 ${formatCredits(missingCredits)} 积分`}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#edf0f6] dark:bg-slate-700">
                      <div className="h-full rounded-full bg-gradient-to-r from-[#ff8a5c] to-[#ff6f9c] transition-all" style={{ width: `${progress}%` }} />
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-[#edf0f6] pt-3 dark:border-slate-800">
                      <div><span className="text-xl font-extrabold text-[#ff7448]">{formatCredits(item.cost)}</span><span className="ml-1 text-[11px] text-[#8a93a8] dark:text-slate-400">积分</span></div>
                      <button
                        type="button"
                        disabled={!affordable || soldOut || Boolean(redeemingId)}
                        onClick={() => openRedeemConfirm(item)}
                        className="rounded-full bg-gradient-to-br from-[#ff8a5c] to-[#ff6f9c] px-4 py-2 text-xs font-bold text-white shadow-[0_3px_10px_rgba(255,116,72,.24)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none dark:disabled:from-slate-700 dark:disabled:to-slate-700"
                      >
                        {soldOut ? "库存不足" : affordable ? "立即兑换" : "积分不足"}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          }) : null}
              </div>
            </section>

            <section className="rounded-2xl border border-[#e6e9f2] bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
              <div className="mb-4">
                <h2 className="text-lg font-extrabold text-[#2b3245] dark:text-white">积分怎么获得</h2>
                <p className="mt-1 text-xs text-[#8a93a8] dark:text-slate-400">积分自动计入当前设备账号，无需手动领取。</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-[#fff3eb] p-4 dark:bg-orange-500/10">
                  <div className="text-sm font-bold text-[#2b3245] dark:text-slate-100">素材被点赞</div>
                  <p className="mt-1 text-xs leading-5 text-[#697086] dark:text-slate-400">每次有效点赞 +{formatCredits(likeRewardCredits)} 积分，不受点赞者每日次数限制。</p>
                </div>
                <div className="rounded-xl bg-[#fff0f5] p-4 dark:bg-pink-500/10">
                  <div className="text-sm font-bold text-[#2b3245] dark:text-slate-100">点赞优质素材</div>
                  <p className="mt-1 text-xs leading-5 text-[#697086] dark:text-slate-400">每天前 {actorLikeDailyLimit} 次有效，每次 +{formatCredits(actorLikeRewardCredits)}，每日最高 {formatCredits(actorLikeDailyCapCredits)} 积分。</p>
                </div>
                <div className="rounded-xl bg-[#eef9f8] p-4 dark:bg-cyan-500/10">
                  <div className="text-sm font-bold text-[#2b3245] dark:text-slate-100">素材被下载</div>
                  <p className="mt-1 text-xs leading-5 text-[#697086] dark:text-slate-400">每次有效下载 +{formatCredits(downloadRewardCredits)} 积分，每日最高 {formatCredits(downloadDailyCapCredits)} 积分。</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-[#8a93a8] dark:text-slate-400">不能给自己点赞，也不能通过下载自己的素材获得积分。</p>
            </section>

            <section className="rounded-2xl border border-[#e6e9f2] bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
              <h2 className="text-lg font-extrabold text-[#2b3245] dark:text-white">积分记录</h2>
              <p className="mt-1 text-xs text-[#8a93a8] dark:text-slate-400">最近的积分收入和兑换支出。</p>
              <CreditLedgerPanel entries={creditLedger} loading={loading} />
            </section>
          </div>
        </div>
        <SiteFooter />
      </main>

      {confirmItem ? (
        <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[rgba(30,35,55,.48)] p-4 backdrop-blur-[3px] sm:items-center" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !redeemingId) setConfirmItem(null); }}>
          <div role="dialog" aria-modal="true" aria-labelledby="redeem-confirm-title" className="my-auto w-full max-w-2xl rounded-[18px] border border-[#e6e9f2] bg-white p-6 shadow-[0_24px_60px_rgba(35,40,60,.28)] dark:border-slate-700 dark:bg-slate-900">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#ff8a5c] to-[#ff6f9c] text-3xl text-white" aria-hidden="true">🎁</div>
            <h2 id="redeem-confirm-title" className="mt-4 text-xl font-bold text-slate-900 dark:text-white">确认兑换</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">确定使用 <strong className="text-[#ff7448]">{formatCredits(confirmItem.cost)} 积分</strong>兑换“{confirmItem.title}”吗？兑换成功后积分将立即扣除。</p>
            {confirmItem.effect.type === "physical" ? (
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-950/50">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">收货信息</h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">地址仅用于本次发货，并会加密保存在服务器。</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <SiteInput placeholder="收货人姓名 *" value={shipping.name} onChange={(event) => updateShipping("name", event.target.value)} />
                  <SiteInput inputMode="tel" placeholder="手机号 *" value={shipping.phone} onChange={(event) => updateShipping("phone", event.target.value)} />
                  <SiteInput inputMode="numeric" placeholder="QQ 号 *" value={shipping.qq} onChange={(event) => updateShipping("qq", event.target.value)} />
                  <SiteInput placeholder="微信号（选填）" value={shipping.wechat || ""} onChange={(event) => updateShipping("wechat", event.target.value)} />
                  <SiteInput placeholder="省份 *" value={shipping.province} onChange={(event) => updateShipping("province", event.target.value)} />
                  <SiteInput placeholder="城市 *" value={shipping.city} onChange={(event) => updateShipping("city", event.target.value)} />
                </div>
                <SiteTextarea className="mt-3" rows={2} placeholder="详细收货地址 *" value={shipping.address} onChange={(event) => updateShipping("address", event.target.value)} />
                <SiteTextarea className="mt-3" rows={2} placeholder="订单备注（选填）" value={shipping.remark || ""} onChange={(event) => updateShipping("remark", event.target.value)} />
              </div>
            ) : null}
            <div className="mt-4 flex items-center justify-between rounded-2xl bg-slate-100/80 px-4 py-3 text-sm dark:bg-slate-950/60">
              <span className="text-slate-500 dark:text-slate-400">兑换后余额</span>
              <span className="font-semibold text-slate-800 dark:text-slate-100">{formatCredits(Math.max(0, credits - confirmItem.cost))} 积分</span>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" disabled={Boolean(redeemingId)} onClick={() => setConfirmItem(null)} className="rounded-full border border-[#e6e9f2] bg-white px-5 py-2.5 text-sm font-semibold text-[#4a5270] transition hover:border-[#ff8a5c] hover:text-[#ff8a5c] disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">再想想</button>
              <button type="button" disabled={Boolean(redeemingId)} onClick={() => void handleRedeem(confirmItem)} className="rounded-full bg-gradient-to-br from-[#ff8a5c] to-[#ff6f9c] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(255,138,92,.28)] transition hover:-translate-y-0.5 disabled:opacity-50">{redeemingId === confirmItem.id ? "兑换中…" : "确认兑换"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
