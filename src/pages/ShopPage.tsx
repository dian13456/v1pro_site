import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SitePageLayout } from "../components/SitePageLayout";
import {
  SiteAlert,
  SiteButton,
  SitePanel,
  SiteSectionTitle,
} from "../components/SiteUi";
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
  const [redeemCode, setRedeemCode] = useState("");
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
    setRedeemCode("");
    setErrorMessage("");
    try {
      const result = await redeemShopItem(item.id);
      if (typeof result.creditsRemaining === "number") {
        setCredits(result.creditsRemaining);
      }
      if (result.redeemCode) {
        setRedeemCode(result.redeemCode);
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
    <SitePageLayout
      subtitle="积分商城 · 点赞得积分，积分换权益"
      theme={theme}
      onToggleTheme={toggleTheme}
      contentClassName="mx-auto w-full max-w-4xl space-y-5"
    >
        <SitePanel>
          <SiteSectionTitle
            title="我的积分"
            description={`他人为你的上传素材点赞，你可获得 ${likeRewardCredits} 积分/次（不能给自己点赞得分）。`}
            action={
              <div className="text-3xl font-semibold text-violet-700 dark:text-violet-200">
                {loading ? "—" : credits}
              </div>
            }
          />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            通过 AI 生图、GIF 上传或素材被点赞获得积分。当前商城仅兑换 V1PRO CNC 喵喵壳子 77 帧兑换码。
          </p>
        </SitePanel>

        {notice ? <SiteAlert variant="success">{notice}</SiteAlert> : null}
        {redeemCode ? (
          <SitePanel>
            <p className="text-sm text-slate-600 dark:text-slate-300">你的兑换码</p>
            <p className="mt-2 break-all rounded-2xl border border-violet-200/70 bg-violet-50/80 px-4 py-3 font-mono text-lg font-semibold text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-100">
              {redeemCode}
            </p>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">请截图或复制保存，兑换码仅在本页展示一次。</p>
          </SitePanel>
        ) : null}
        {errorMessage ? <SiteAlert variant="error">{errorMessage}</SiteAlert> : null}

        <div className="grid gap-4">
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
                <article key={item.id} className="flex h-full flex-col rounded-3xl border border-white/25 bg-white/55 p-5 backdrop-blur dark:border-white/10 dark:bg-slate-900/45">
                  <div className="flex-1 space-y-2">
                    <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{item.title}</div>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{item.description}</p>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-violet-700 dark:text-violet-200">{item.cost} 积分</span>
                    <SiteButton
                      type="button"
                      disabled={!affordable || redeemingId === item.id}
                      onClick={() => void handleRedeem(item)}
                      className="px-4 py-2"
                    >
                      {redeemingId === item.id ? "兑换中…" : affordable ? "立即兑换" : "积分不足"}
                    </SiteButton>
                  </div>
                </article>
              );
            })
          )}
        </div>
    </SitePageLayout>
  );
}
