import { translate as t, useI18n, formatDate } from "../i18n";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AdminLoginPanel } from "../components/AdminLoginPanel";
import { MallProductImage } from "../components/MallProductImage";
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
import { useAdminSession } from "../hooks/useAdminSession";
import { useThemeMode } from "../hooks/useThemeMode";
import { getAdminToken } from "../services/adminAuthService";
import {
  adminFetchPromoSubmissionDetail,
  adminFetchPromoSubmissions,
  adminReviewPromoSubmission,
  adminUploadPaymentProof,
} from "../services/promoService";
import type { PromoCampaignId, PromoSubmissionRecord } from "../types/promo";
import { PROMO_CAMPAIGN_LABEL, PROMO_STATUS_LABEL } from "../types/promo";

export default function ActivityPromoAdminPage() {
  useI18n();
  const { theme, setTheme } = useThemeMode();
  const { adminToken, authenticated, refreshSession, logout, handleUnauthorized } = useAdminSession();
  const [loading, setLoading] = useState(false);
  const [submissions, setSubmissions] = useState<PromoSubmissionRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<PromoSubmissionRecord | null>(null);
  const [campaignFilter, setCampaignFilter] = useState<PromoCampaignId | "">("");
  const [statusFilter, setStatusFilter] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [proofUploading, setProofUploading] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const loadList = useCallback(async (token: string) => {
    setLoading(true);
    setErrorMessage("");
    try {
      const items = await adminFetchPromoSubmissions(token, campaignFilter, statusFilter);
      setSubmissions(items);
      setNotice("数据已刷新");
    } catch (err) {
      const message = (err as Error)?.message || t("加载失败");
      if (message.includes("token") || message.includes("无效") || message.includes("未授权")) {
        handleUnauthorized();
      }
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  }, [campaignFilter, handleUnauthorized, statusFilter]);

  useEffect(() => {
    if (authenticated && adminToken) {
      void loadList(adminToken);
    }
  }, [adminToken, authenticated, loadList]);

  useEffect(() => {
    if (!detail) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDetail(null);
        setSelectedId("");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [detail]);

  const handleLoggedIn = () => {
    refreshSession();
    void loadList(getAdminToken());
  };

  const handleSelect = async (id: string) => {
    if (!adminToken) return;
    setSelectedId(id);
    try {
      const item = await adminFetchPromoSubmissionDetail(adminToken, id);
      setDetail(item);
      setAdminNote(item.adminNote || "");
    } catch (err) {
      setErrorMessage((err as Error)?.message || "加载详情失败");
    }
  };

  const handleReview = async (status: "approved" | "rejected") => {
    if (!adminToken || !selectedId) return;
    try {
      const updated = await adminReviewPromoSubmission(adminToken, selectedId, status, adminNote.trim());
      setDetail(updated);
      setNotice(status === "approved" ? "已通过该报名" : "已拒绝该报名");
      await loadList(adminToken);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "操作失败");
    }
  };

  const handlePaymentProofUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !adminToken || !selectedId) return;
    setProofUploading(true);
    try {
      const updated = await adminUploadPaymentProof(adminToken, selectedId, file);
      setDetail(updated);
      setNotice("打款凭证已上传");
      await loadList(adminToken);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "上传打款凭证失败");
    } finally {
      setProofUploading(false);
    }
  };

  return (
    <SitePageLayout
      subtitle={t("福利活动审核 · CNC复购 / 视频点赞免单")}
      theme={theme}
      onSetTheme={setTheme}
      contentClassName={SITE_CONTENT_MEDIUM}
    >
      {!authenticated ? (
        <AdminLoginPanel description={t("输入后台密码后可审核福利活动报名。")} onLoggedIn={handleLoggedIn} />
      ) : (
        <SitePanel>
          <SiteSectionTitle
            title={t("已登录管理后台")}
            action={
              <div className="flex flex-wrap gap-2">
                <Link to="/activities/admin">
                  <SiteButton type="button" variant="secondary">{t("抽奖管理")}{" "}</SiteButton>
                </Link>
                <Link to="/activities/promo">
                  <SiteButton type="button" variant="secondary">{t("用户报名页")}{" "}</SiteButton>
                </Link>
                <SiteButton type="button" variant="secondary" onClick={logout}>{t("退出登录")}{" "}</SiteButton>
              </div>
            }
          />
        </SitePanel>
      )}

      {notice ? <SiteAlert variant="success">{t(notice)}</SiteAlert> : null}
      {errorMessage ? <SiteAlert variant="error">{t(errorMessage)}</SiteAlert> : null}

      {authenticated && adminToken ? (
        <>
          <SitePanel>
            <SiteSectionTitle
              title={t("报名列表")}
              action={
                <SiteButton type="button" variant="secondary" onClick={() => void loadList(adminToken)}>{t("刷新")}{" "}</SiteButton>
              }
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <select
                className="rounded-xl border border-white/30 bg-white/70 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950/50"
                value={campaignFilter}
                onChange={(e) => setCampaignFilter(e.target.value as PromoCampaignId | "")}
              >
                <option value="">{t("全部活动")}</option>
                <option value="cnc-repurchase-bonus">{t("CNC复购加送")}</option>
                <option value="video-like-free-order">{t("视频点赞免单")}</option>
              </select>
              <select
                className="rounded-xl border border-white/30 bg-white/70 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950/50"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">{t("全部状态")}</option>
                <option value="pending">{t("待审核")}</option>
                <option value="approved">{t("已通过")}</option>
                <option value="rejected">{t("已拒绝")}</option>
              </select>
              <SiteButton type="button" onClick={() => void loadList(adminToken)}>{t("筛选")}{" "}</SiteButton>
            </div>
            {loading ? <SiteLoadingBlock>{t("加载中…")}</SiteLoadingBlock> : null}
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-white/20 text-slate-500 dark:text-slate-400">
                    <th className="px-2 py-2">{t("活动")}</th>
                    <th className="px-2 py-2">{t("设备 SN")}</th>
                    <th className="px-2 py-2">{t("订单号")}</th>
                    <th className="px-2 py-2">{t("状态")}</th>
                    <th className="px-2 py-2">{t("提交时间")}</th>
                    <th className="px-2 py-2">{t("操作")}</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((item) => (
                    <tr key={item.id} className="border-b border-white/10">
                      <td className="px-2 py-2">{t(PROMO_CAMPAIGN_LABEL[item.campaignId])}</td>
                      <td className="px-2 py-2 font-mono text-xs">{item.userSerial}</td>
                      <td className="px-2 py-2">{item.orderNo}</td>
                      <td className="px-2 py-2">{t(PROMO_STATUS_LABEL[item.status])}</td>
                      <td className="px-2 py-2">{formatDate(new Date(item.createdAt), { dateStyle: "medium", timeStyle: "short" })}</td>
                      <td className="px-2 py-2">
                        <SiteButton type="button" variant="secondary" onClick={() => void handleSelect(item.id)}>{t("查看")}{" "}</SiteButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && submissions.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">{t("暂无报名记录")}</p>
              ) : null}
            </div>
          </SitePanel>

          {detail
            ? createPortal(
                <div
                  className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm"
                  role="presentation"
                  onMouseDown={(event) => {
                    if (event.target === event.currentTarget) {
                      setDetail(null);
                      setSelectedId("");
                    }
                  }}
                >
                  <div
                    className="relative my-auto max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto rounded-3xl shadow-2xl"
                    role="dialog"
                    aria-modal="true"
                    aria-label={t("报名审核详情")}
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-slate-900/70 text-xl leading-none text-white transition hover:bg-slate-900"
                      aria-label={t("关闭审核详情")}
                      onClick={() => {
                        setDetail(null);
                        setSelectedId("");
                      }}
                    >
                      ×
                    </button>
                    <SitePanel>
              <SiteSectionTitle title={t("报名详情")} description={detail.id} />
              <div className="mt-3 grid gap-2 text-sm text-slate-700 dark:text-slate-300">
                <p>{t("活动：")}{t(PROMO_CAMPAIGN_LABEL[detail.campaignId])}</p>
                <p>{t("设备 SN：")}{detail.userSerial}</p>
                <p>{t("订单号：")}{detail.orderNo}</p>
                <p>{t("状态：")}{t(PROMO_STATUS_LABEL[detail.status])}</p>
                {detail.injectionColorNote ? <p>{t("颜色备注：")}{detail.injectionColorNote}</p> : null}
                {detail.shippingAddress ? <p>{t("收货地址：")}{detail.shippingAddress}</p> : null}
                {detail.videoLink ? (
                  <p>{t("视频链接：")}{" "}<a className="text-violet-600 underline dark:text-violet-300" href={detail.videoLink} target="_blank" rel="noreferrer">
                      {detail.videoLink}
                    </a>
                  </p>
                ) : null}
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-sm font-medium">{t("订单截图")}</p>
                  <MallProductImage
                    imageUrl={detail.orderScreenshotUrl}
                    title={t("订单截图")}
                    className="h-44 w-full max-w-xs"
                    adminToken={adminToken}
                  />
                </div>
                {detail.paymentQrUrl ? (
                  <div>
                    <p className="mb-2 text-sm font-medium">{t("收款码")}</p>
                    <MallProductImage
                      imageUrl={detail.paymentQrUrl}
                      title={t("收款码")}
                      className="h-44 w-full max-w-xs"
                      adminToken={adminToken}
                    />
                  </div>
                ) : null}
                {detail.status === "approved" ? (
                  <div>
                    <p className="mb-2 text-sm font-medium">打款凭证</p>
                    <MallProductImage
                      imageUrl={detail.paymentProofUrl}
                      title="打款凭证"
                      emptyText="尚未上传打款凭证"
                      className="h-44 w-full max-w-xs"
                      adminToken={adminToken}
                    />
                    <label className="mt-2 inline-flex cursor-pointer items-center rounded-xl border border-violet-300/70 bg-white/60 px-3 py-2 text-sm text-violet-700 transition hover:bg-white dark:border-violet-400/30 dark:bg-slate-900/50 dark:text-violet-200">
                      {proofUploading ? "上传中…" : detail.paymentProofUrl ? "更换凭证图片" : "上传打款凭证"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        disabled={proofUploading}
                        onChange={(event) => void handlePaymentProofUpload(event)}
                      />
                    </label>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">支持 JPG、PNG、WEBP，5MB 以内</p>
                  </div>
                ) : null}
              </div>
              <div className="mt-4 grid gap-3">
                <SiteInput
                  placeholder={t("审核备注（拒绝时建议填写原因）")}
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <SiteButton type="button" variant="success" onClick={() => void handleReview("approved")}>{t("通过")}{" "}</SiteButton>
                  <SiteButton type="button" variant="secondary" onClick={() => void handleReview("rejected")}>{t("拒绝")}{" "}</SiteButton>
                </div>
              </div>
                    </SitePanel>
                  </div>
                </div>,
                document.body,
              )
            : null}
        </>
      ) : null}
    </SitePageLayout>
  );
}
