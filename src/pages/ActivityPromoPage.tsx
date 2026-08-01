import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PromoImageUpload } from "../components/PromoImageUpload";
import { SitePageLayout } from "../components/SitePageLayout";
import {
  SiteAlert,
  SiteButton,
  SiteInput,
  SiteLoadingBlock,
  SitePanel,
  SiteSectionTitle,
  SiteTextarea,
  SITE_CONTENT_NARROW,
} from "../components/SiteUi";
import { useThemeMode } from "../hooks/useThemeMode";
import { hasValidLocalAuth } from "../services/authService";
import { fetchPromoOverview, submitPromoApplication } from "../services/promoService";
import type { PromoCampaignId, PromoOverview } from "../types/promo";
import { PROMO_CAMPAIGN_LABEL, PROMO_STATUS_LABEL } from "../types/promo";

export default function ActivityPromoPage() {
  const navigate = useNavigate();
  const { theme, setTheme } = useThemeMode();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [overview, setOverview] = useState<PromoOverview | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<PromoCampaignId | "">("");
  const [orderNo, setOrderNo] = useState("");
  const [orderScreenshotUrl, setOrderScreenshotUrl] = useState("");
  const [injectionColorNote, setInjectionColorNote] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [videoLink, setVideoLink] = useState("");
  const [paymentQrUrl, setPaymentQrUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const locked = Boolean(overview?.current);

  const selectedMeta = useMemo(
    () => overview?.campaigns.find((item) => item.id === selectedCampaign),
    [overview, selectedCampaign],
  );

  useEffect(() => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    void (async () => {
      setLoading(true);
      try {
        const data = await fetchPromoOverview();
        setOverview(data);
        if (data.current?.campaignId) {
          setSelectedCampaign(data.current.campaignId);
        } else {
          const available = data.campaigns.find((item) => !item.quotaFull);
          if (available) {
            setSelectedCampaign(available.id);
          } else if (data.campaigns[0]) {
            setSelectedCampaign(data.campaigns[0].id);
          }
        }
      } catch (err) {
        setErrorMessage((err as Error)?.message || "加载活动失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate]);

  const handleSubmit = async () => {
    if (!selectedCampaign || submitting || locked) return;
    if (selectedMeta?.quotaFull) {
      setErrorMessage("该活动报名人数已满（260份），请选择另一活动");
      return;
    }
    if (!orderScreenshotUrl.trim()) {
      setErrorMessage("请上传订单截图");
      return;
    }
    if (selectedCampaign !== "cnc-repurchase-bonus" && !orderNo.trim()) {
      setErrorMessage("请填写订单号");
      return;
    }
    if (selectedCampaign === "cnc-repurchase-bonus") {
      if (!injectionColorNote.trim()) {
        setErrorMessage("请填写注塑 V1PRO 颜色备注");
        return;
      }
      if (!shippingAddress.trim()) {
        setErrorMessage("请填写收货地址");
        return;
      }
    }
    if (selectedCampaign === "video-like-free-order") {
      if (!videoLink.trim()) {
        setErrorMessage("请填写视频链接");
        return;
      }
      if (!paymentQrUrl.trim()) {
        setErrorMessage("请上传收款码");
        return;
      }
    }

    setSubmitting(true);
    setErrorMessage("");
    setNotice("");
    try {
      const result = await submitPromoApplication({
        campaignId: selectedCampaign,
        orderNo: orderNo.trim(),
        orderScreenshotUrl: orderScreenshotUrl.trim(),
        injectionColorNote: injectionColorNote.trim(),
        shippingAddress: shippingAddress.trim(),
        videoLink: videoLink.trim(),
        paymentQrUrl: paymentQrUrl.trim(),
      });
      setNotice(result.message);
      const refreshed = await fetchPromoOverview();
      setOverview(refreshed);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SitePageLayout
      subtitle="限时福利 · 二选一参与"
      theme={theme}
      onSetTheme={setTheme}
      contentClassName={SITE_CONTENT_NARROW}
    >
      <SitePanel>
        <SiteSectionTitle
          title="新上活动（二选一）"
          description="以下两个活动只能选择一个参与，提交后不可更改，也不能同时报名另一个活动。"
          action={
            <Link to="/activities">
              <SiteButton type="button" variant="secondary">
                返回活动中心
              </SiteButton>
            </Link>
          }
        />
        {overview ? <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-300">{overview.rule}</p> : null}
      </SitePanel>

      {notice ? <SiteAlert variant="success">{notice}</SiteAlert> : null}
      {errorMessage ? <SiteAlert variant="error">{errorMessage}</SiteAlert> : null}
      {loading ? <SiteLoadingBlock>加载中…</SiteLoadingBlock> : null}

      {!loading && overview?.current ? (
        <SitePanel>
          <SiteSectionTitle title="你已提交报名" description="请耐心等待工作人员审核，审核结果将显示在下方。" />
          <div className="mt-3 grid gap-2 text-sm text-slate-700 dark:text-slate-300">
            <p>
              参与活动：<strong>{PROMO_CAMPAIGN_LABEL[overview.current.campaignId]}</strong>
            </p>
            <p>
              当前状态：<strong>{PROMO_STATUS_LABEL[overview.current.status]}</strong>
            </p>
            {overview.current.adminNote ? <p>审核备注：{overview.current.adminNote}</p> : null}
            <p className="text-xs text-slate-500 dark:text-slate-400">
              提交时间：{new Date(overview.current.createdAt).toLocaleString("zh-CN")}
            </p>
          </div>
        </SitePanel>
      ) : null}

      {!loading && overview && !overview.current && overview.campaigns.every((item) => item.quotaFull) ? (
        <SiteAlert variant="info">两个活动报名人数均已满（各 260 份），报名已截止。</SiteAlert>
      ) : null}

      {!loading && overview && !overview.current ? (
        <>
          <SitePanel>
            <SiteSectionTitle title="选择参与的活动" description="请先选择你要报名的活动，再填写对应资料。各活动限 260 份，报满即止。" />
            <div className="mt-4 grid gap-3">
              {overview.campaigns.map((campaign) => {
                const active = selectedCampaign === campaign.id;
                return (
                  <button
                    key={campaign.id}
                    type="button"
                    disabled={campaign.quotaFull}
                    className={`rounded-2xl border p-4 text-left transition ${
                      campaign.quotaFull
                        ? "cursor-not-allowed border-slate-200/80 bg-slate-100/70 opacity-75 dark:border-slate-600/40 dark:bg-slate-900/50"
                        : active
                          ? "border-violet-500 bg-violet-50/80 dark:border-violet-400 dark:bg-violet-500/10"
                          : "border-white/25 bg-white/40 hover:bg-white/60 dark:border-white/10 dark:bg-slate-950/30"
                    }`}
                    onClick={() => {
                      if (!campaign.quotaFull) {
                        setSelectedCampaign(campaign.id);
                      }
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{campaign.title}</p>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          campaign.quotaFull
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200"
                            : "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200"
                        }`}
                      >
                        已填报 {campaign.submittedCount} / {campaign.quotaLimit}
                        {campaign.quotaFull ? " · 已满" : ""}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{campaign.summary}</p>
                    <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-700 dark:text-slate-300">
                      {campaign.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </SitePanel>

          {selectedMeta ? (
            <SitePanel>
              <SiteSectionTitle
                title={`填写资料 · ${selectedMeta.title}`}
                description={
                  selectedMeta.quotaFull
                    ? "该活动报名人数已满（260份），请选择另一活动。"
                    : selectedCampaign === "cnc-repurchase-bonus"
                      ? "请填写 CNC 订单号（直购用户可留空并上传支付截图）、订单截图、颜色备注与收货地址。"
                      : "请确保信息真实有效，便于工作人员审核与退款。"
                }
              />
              {selectedMeta.quotaFull ? (
                <SiteAlert variant="info" className="mt-4">
                  已填报 {selectedMeta.submittedCount} / {selectedMeta.quotaLimit} 份，该活动已截止报名。
                </SiteAlert>
              ) : (
              <div className="mt-4 grid gap-4">
                <SiteInput
                  placeholder={
                    selectedCampaign === "cnc-repurchase-bonus"
                      ? "CNC 订单号（直购用户可留空）"
                      : "订单号"
                  }
                  value={orderNo}
                  onChange={(e) => setOrderNo(e.target.value)}
                />
                <PromoImageUpload
                  label={
                    selectedCampaign === "cnc-repurchase-bonus"
                      ? "订单截图（直购用户请上传支付截图）"
                      : "订单截图"
                  }
                  imageUrl={orderScreenshotUrl}
                  onChange={setOrderScreenshotUrl}
                />

                {selectedCampaign === "cnc-repurchase-bonus" ? (
                  <>
                    <SiteInput
                      placeholder="注塑 V1PRO 颜色备注（如：白色 / 透黑）"
                      value={injectionColorNote}
                      onChange={(e) => setInjectionColorNote(e.target.value)}
                    />
                    <SiteTextarea
                      placeholder="收货地址（含收件人、手机号、省市区与详细地址）"
                      value={shippingAddress}
                      onChange={(e) => setShippingAddress(e.target.value)}
                      rows={4}
                    />
                  </>
                ) : null}

                {selectedCampaign === "video-like-free-order" ? (
                  <>
                    <SiteInput
                      placeholder="视频链接（B站 / 抖音 / 小红书等）"
                      value={videoLink}
                      onChange={(e) => setVideoLink(e.target.value)}
                    />
                    <PromoImageUpload
                      label="收款码截图"
                      imageUrl={paymentQrUrl}
                      onChange={setPaymentQrUrl}
                    />
                  </>
                ) : null}

                <SiteButton
                  type="button"
                  disabled={submitting || selectedMeta.quotaFull}
                  onClick={() => void handleSubmit()}
                >
                  {submitting ? "提交中…" : "确认提交"}
                </SiteButton>
              </div>
              )}
            </SitePanel>
          ) : null}
        </>
      ) : null}
    </SitePageLayout>
  );
}
