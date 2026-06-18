import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { SitePageShell } from "../components/SitePageShell";
import { SitePageToolbar } from "../components/SitePageToolbar";
import { useThemeMode } from "../hooks/useThemeMode";
import { hasValidLocalAuth } from "../services/authService";
import { DEFAULT_AI_CREDITS } from "../services/profileService";
import { fetchShopCatalog, redeemShopItem } from "../services/shopService";
import type { ShopItem } from "../types/shop";

export default function ShopPage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useThemeMode();
  const [loading, setLoading] = useState(true);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [credits, setCredits] = useState<number>(DEFAULT_AI_CREDITS);
  const [likeRewardCredits, setLikeRewardCredits] = useState(1);
  const [items, setItems] = useState<ShopItem[]>([]);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadCatalog = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const payload = await fetchShopCatalog();
      setCredits(typeof payload.credits === "number" ? payload.credits : DEFAULT_AI_CREDITS);
      setLikeRewardCredits(typeof payload.likeRewardCredits === "number" ? payload.likeRewardCredits : 1);
      setItems(Array.isArray(payload.items) ? payload.items : []);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "加载商城失败");
    } finally {
      setLoading(false);
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
    setErrorMessage("");
    try {
      const result = await redeemShopItem(item.id);
      if (typeof result.creditsRemaining === "number") {
        setCredits(result.creditsRemaining);
      }
      setNotice(result.message || `已兑换「${item.title}」`);
      window.setTimeout(() => setNotice(""), 5000);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "兑换失败");
    } finally {
      setRedeemingId(null);
    }
  };

  return (
    <SitePageShell>
      <SiteHeader
        title="佳点电子资源中心"
        subtitle="积分商城 · 点赞得积分，积分换权益"
        rightSlot={<SitePageToolbar theme={theme} onToggleTheme={toggleTheme} />}
      />

      <section className="mx-auto w-full max-w-4xl space-y-5">
        <div className="rounded-3xl border border-white/25 bg-white/55 p-5 backdrop-blur dark:border-white/10 dark:bg-slate-900/45">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-sm text-slate-500 dark:text-slate-400">当前积分</div>
              <div className="text-3xl font-semibold text-violet-700 dark:text-violet-200">
                {loading ? "—" : credits}
              </div>
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-300">
              他人为你的上传素材点赞，你可获得 <strong>{likeRewardCredits}</strong> 积分/次（不能给自己点赞得分）。
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            通过 AI 生图页或上传工具分享素材时，系统会记录你的设备 SN。积分与 AI 生图共用同一余额。
          </p>
        </div>

        {notice ? (
          <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
            {notice}
          </div>
        ) : null}
        {errorMessage ? (
          <div className="rounded-2xl border border-rose-200/70 bg-rose-50/90 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          {loading ? (
            <div className="col-span-full text-sm text-slate-500 dark:text-slate-400">加载商品中…</div>
          ) : items.length === 0 ? (
            <div className="col-span-full rounded-2xl border border-white/25 bg-white/55 p-6 text-sm text-slate-500 dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-400">
              暂无可兑换商品。
            </div>
          ) : (
            items.map((item) => {
              const affordable = credits >= item.cost;
              return (
                <article
                  key={item.id}
                  className="flex h-full flex-col rounded-3xl border border-white/25 bg-white/55 p-5 backdrop-blur dark:border-white/10 dark:bg-slate-900/45"
                >
                  <div className="flex-1 space-y-2">
                    <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{item.title}</div>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{item.description}</p>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-violet-700 dark:text-violet-200">{item.cost} 积分</span>
                    <button
                      type="button"
                      disabled={!affordable || redeemingId === item.id}
                      onClick={() => void handleRedeem(item)}
                      className="rounded-full bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {redeemingId === item.id ? "兑换中…" : affordable ? "立即兑换" : "积分不足"}
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>

        <div className="text-center text-sm text-slate-500 dark:text-slate-400">
          <Link to="/profile" className="text-violet-600 hover:underline dark:text-violet-300">
            返回个人中心
          </Link>
        </div>
      </section>

      <SiteFooter />
    </SitePageShell>
  );
}
