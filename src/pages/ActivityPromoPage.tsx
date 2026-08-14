import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  fetchMyPromoSubmission,
  fetchPromoOverview,
  submitPromoApplication,
  updatePromoApplication,
} from "../services/promoService";
import type { PromoCampaignId, PromoOverview, PromoSubmissionRecord } from "../types/promo";
import { PROMO_CAMPAIGN_LABEL, PROMO_STATUS_LABEL } from "../types/promo";

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-slate-200/70 py-3 last:border-0 dark:border-white/10 sm:grid-cols-[120px_1fr]">
      <dt className="text-sm text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="break-words whitespace-pre-wrap text-sm font-medium text-slate-800 dark:text-slate-100">
        {children || "未填写"}
      </dd>
    </div>
  );
}

export default function ActivityPromoPage() {
  const navigate = useNavigate();
  const { theme, setTheme } = useThemeMode();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [overview, setOverview] = useState<PromoOverview | null>(null);
  const [submission, setSubmission] = useState<PromoSubmissionRecord | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<PromoCampaignId | "">("");
  const [orderNo, setOrderNo] = useState("");
  const [orderScreenshotUrl, setOrderScreenshotUrl] = useState("");
  const [injectionColorNote, setInjectionColorNote] = useState("");
  const [shippingAddress, setShippingAddress] = useState("");
  const [videoLink, setVideoLink] = useState("");
  const [paymentQrUrl, setPaymentQrUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const selectedMeta = useMemo(
    () => overview?.campaigns.find((item) => item.id === selectedCampaign),
    [overview, selectedCampaign],
  );
  const canEdit = Boolean(
    overview?.current &&
      (overview.current.status === "pending" || overview.current.status === "rejected") &&
      selectedMeta &&
      Date.now() >= selectedMeta.startTime &&
      Date.now() <= selectedMeta.endTime,
  );

  const loadData = useCallback(async () => {
    const data = await fetchPromoOverview();
    setOverview(data);
    if (data.current?.campaignId) {
      setSelectedCampaign(data.current.campaignId);
      const detail = await fetchMyPromoSubmission();
      setSubmission(detail);
      return;
    }
    setSubmission(null);
    const available = data.campaigns.find((item) => !item.quotaFull) || data.campaigns[0];
    setSelectedCampaign(available?.id || "");
  }, []);

  useEffect(() => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    void (async () => {
      setLoading(true);
      try {
        await loadData();
      } catch (err) {
        setErrorMessage((err as Error)?.message || "加载活动失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadData, navigate]);

  const fillForm = (detail: PromoSubmissionRecord) => {
    setSelectedCampaign(detail.campaignId);
    setOrderNo(detail.orderNo || "");
    setOrderScreenshotUrl(detail.orderScreenshotUrl || "");
    setInjectionColorNote(detail.injectionColorNote || "");
    setShippingAddress(detail.shippingAddress || "");
    setVideoLink(detail.videoLink || "");
    setPaymentQrUrl(detail.paymentQrUrl || "");
  };

  const beginEdit = () => {
    if (!submission || !canEdit) return;
    fillForm(submission);
    setEditing(true);
    setShowDetails(true);
    setNotice("");
    setErrorMessage("");
  };

  const handleSubmit = async () => {
    const isUpdate = Boolean(overview?.current);
    if (!selectedCampaign || submitting || (isUpdate && !editing)) return;
    if (!isUpdate && selectedMeta?.quotaFull) {
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

    const input = {
      campaignId: selectedCampaign,
      orderNo: orderNo.trim(),
      orderScreenshotUrl: orderScreenshotUrl.trim(),
      injectionColorNote: injectionColorNote.trim(),
      shippingAddress: shippingAddress.trim(),
      videoLink: videoLink.trim(),
      paymentQrUrl: paymentQrUrl.trim(),
    };
    setSubmitting(true);
    setErrorMessage("");
    setNotice("");
    try {
      const result = isUpdate
        ? await updatePromoApplication(input)
        : await submitPromoApplication(input);
      setNotice(result.message);
      setEditing(false);
      setShowDetails(true);
      await loadData();
    } catch (err) {
      setErrorMessage((err as Error)?.message || (isUpdate ? "修改资料失败" : "提交失败"));
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
          title="上新活动（二选一）"
          description="选择一个活动报名。提交后可以查看资料；审核前或被驳回后可以修改，审核通过后资料将锁定。"
          action={
            <Link to="/activities">
              <SiteButton type="button" variant="secondary">返回活动中心</SiteButton>
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
          <SiteSectionTitle
            title="我的提交"
            description={
              overview.current.status === "approved"
                ? "审核已通过，报名资料已锁定。"
                : overview.current.status === "rejected"
                  ? "审核未通过，请根据审核备注修改资料后重新提交。"
                  : "资料正在等待审核，发现填写错误时仍可修改。"
            }
            action={
              <div className="flex flex-wrap gap-2">
                <SiteButton type="button" variant="secondary" onClick={() => setShowDetails((value) => !value)}>
                  {showDetails ? "收起填写信息" : "查看填写信息"}
                </SiteButton>
                {canEdit ? <SiteButton type="button" onClick={beginEdit}>修改信息</SiteButton> : null}
              </div>
            }
          />
          <div className="grid gap-2 rounded-2xl border border-white/30 bg-white/35 p-4 text-sm text-slate-700 dark:border-white/10 dark:bg-slate-950/25 dark:text-slate-300 sm:grid-cols-2">
            <p>参与活动：<strong>{PROMO_CAMPAIGN_LABEL[overview.current.campaignId]}</strong></p>
            <p>当前状态：<strong>{PROMO_STATUS_LABEL[overview.current.status]}</strong></p>
            <p>提交时间：{new Date(overview.current.createdAt).toLocaleString("zh-CN")}</p>
            <p>最后更新：{new Date(overview.current.updatedAt).toLocaleString("zh-CN")}</p>
          </div>
          {overview.current.adminNote ? (
            <SiteAlert variant={overview.current.status === "rejected" ? "error" : "info"} className="mt-4">
              审核备注：{overview.current.adminNote}
            </SiteAlert>
          ) : null}
          {showDetails && submission ? (
            <dl className="mt-4 rounded-2xl border border-slate-200/70 bg-white/45 px-4 dark:border-white/10 dark:bg-slate-950/30">
              <DetailRow label="订单号">{submission.orderNo}</DetailRow>
              <DetailRow label="订单截图">
                <a className="text-violet-600 underline dark:text-violet-300" href={submission.orderScreenshotUrl} target="_blank" rel="noreferrer">查看订单截图</a>
              </DetailRow>
              {submission.campaignId === "cnc-repurchase-bonus" ? (
                <>
                  <DetailRow label="颜色备注">{submission.injectionColorNote}</DetailRow>
                  <DetailRow label="收货地址">{submission.shippingAddress}</DetailRow>
                </>
              ) : (
                <>
                  <DetailRow label="视频链接">
                    <a className="text-violet-600 underline dark:text-violet-300" href={submission.videoLink} target="_blank" rel="noreferrer">{submission.videoLink}</a>
                  </DetailRow>
                  <DetailRow label="收款码">
                    <a className="text-violet-600 underline dark:text-violet-300" href={submission.paymentQrUrl} target="_blank" rel="noreferrer">查看收款码</a>
                  </DetailRow>
                </>
              )}
            </dl>
          ) : null}
        </SitePanel>
      ) : null}

      {!loading && overview && !overview.current && overview.campaigns.every((item) => item.quotaFull) ? (
        <SiteAlert variant="info">两个活动报名人数均已满（各 260 份），报名已截止。</SiteAlert>
      ) : null}

      {!loading && overview && !overview.current ? (
        <SitePanel>
          <SiteSectionTitle title="选择参与的活动" description="活动提交后不可更换，但审核前可以修改该活动内的填写资料。" />
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
                  onClick={() => !campaign.quotaFull && setSelectedCampaign(campaign.id)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{campaign.title}</p>
                    <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">
                      已填报 {campaign.submittedCount} / {campaign.quotaLimit}{campaign.quotaFull ? " · 已满" : ""}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{campaign.summary}</p>
                  <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-700 dark:text-slate-300">{campaign.description}</p>
                </button>
              );
            })}
          </div>
        </SitePanel>
      ) : null}

      {!loading && overview && selectedMeta && (!overview.current || editing) ? (
        <SitePanel>
          <SiteSectionTitle
            title={`${editing ? "修改提交资料" : "填写资料"} · ${selectedMeta.title}`}
            description={
              editing
                ? "保存后将重新进入待审核状态，请确认所有信息无误。"
                : selectedCampaign === "cnc-repurchase-bonus"
                  ? "填写 CNC 订单信息、颜色备注与收货地址。"
                  : "请确保订单、视频和收款信息真实有效。"
            }
          />
          <div className="mt-4 grid gap-4">
            <SiteInput
              placeholder={selectedCampaign === "cnc-repurchase-bonus" ? "CNC 订单号（直购用户可留空）" : "订单号"}
              value={orderNo}
              onChange={(event) => setOrderNo(event.target.value)}
            />
            <PromoImageUpload label="订单截图" imageUrl={orderScreenshotUrl} onChange={setOrderScreenshotUrl} />
            {selectedCampaign === "cnc-repurchase-bonus" ? (
              <>
                <SiteInput placeholder="注塑 V1PRO 颜色备注（如：白色 / 透黑）" value={injectionColorNote} onChange={(event) => setInjectionColorNote(event.target.value)} />
                <SiteTextarea placeholder="收货地址（含收件人、手机号、省市区与详细地址）" value={shippingAddress} onChange={(event) => setShippingAddress(event.target.value)} rows={4} />
              </>
            ) : (
              <>
                <SiteInput placeholder="视频链接（B站 / 抖音 / 小红书等）" value={videoLink} onChange={(event) => setVideoLink(event.target.value)} />
                <PromoImageUpload label="收款码截图" imageUrl={paymentQrUrl} onChange={setPaymentQrUrl} />
              </>
            )}
            <div className="flex flex-wrap gap-2">
              <SiteButton type="button" disabled={submitting || (!editing && selectedMeta.quotaFull)} onClick={() => void handleSubmit()}>
                {submitting ? "保存中…" : editing ? "保存并重新提交审核" : "确认提交"}
              </SiteButton>
              {editing ? (
                <SiteButton type="button" variant="secondary" disabled={submitting} onClick={() => setEditing(false)}>取消修改</SiteButton>
              ) : null}
            </div>
          </div>
        </SitePanel>
      ) : null}
    </SitePageLayout>
  );
}
