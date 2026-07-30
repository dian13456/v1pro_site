import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
import { fetchPrizeInfoStatus, submitPrizeInfo } from "../services/activityService";
import type { PrizeInfoStatus } from "../types/activity";

const PHONE_PATTERN = /^1\d{10}$/;
const QQ_PATTERN = /^[1-9]\d{4,11}$/;

export default function ActivityPrizeInfoPage() {
  const navigate = useNavigate();
  const { theme, setTheme } = useThemeMode();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<PrizeInfoStatus | null>(null);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [wechat, setWechat] = useState("");
  const [qq, setQq] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");

  useEffect(() => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    void (async () => {
      setLoading(true);
      try {
        const data = await fetchPrizeInfoStatus();
        setStatus(data);
      } catch (err) {
        setErrorMessage((err as Error)?.message || "加载中奖信息失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate]);

  const handleSubmit = async () => {
    if (!status?.winnerId || submitting) return;
    if (!name.trim()) {
      setErrorMessage("请填写姓名");
      return;
    }
    if (!PHONE_PATTERN.test(phone.trim())) {
      setErrorMessage("手机号格式不正确");
      return;
    }
    if (!province.trim() || !city.trim() || !address.trim()) {
      setErrorMessage("请完整填写收货地址（省份、城市、详细地址）");
      return;
    }
    if (!QQ_PATTERN.test(qq.trim())) {
      setErrorMessage("请填写正确的 QQ 号");
      return;
    }
    setSubmitting(true);
    setErrorMessage("");
    setNotice("");
    try {
      const result = await submitPrizeInfo({
        winnerId: status.winnerId,
        name: name.trim(),
        phone: phone.trim(),
        wechat: wechat.trim(),
        qq: qq.trim(),
        province: province.trim(),
        city: city.trim(),
        address: address.trim(),
      });
      setNotice(result.message);
      setStatus((prev) => (prev ? { ...prev, hasSubmitted: true, contactStatus: "filled" } : prev));
    } catch (err) {
      setErrorMessage((err as Error)?.message || "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const submitted = status?.hasSubmitted || status?.contactStatus === "filled";

  return (
    <SitePageLayout
      subtitle="中奖信息填写 · 提交后不可修改"
      theme={theme}
      onSetTheme={setTheme}
      contentClassName={SITE_CONTENT_NARROW}
    >
      {loading ? <SiteLoadingBlock>加载中…</SiteLoadingBlock> : null}

      {!loading && status && !status.isWinner ? (
        <SitePanel>
          <SiteSectionTitle title="暂无中奖记录" description="你当前没有待填写的中奖信息。" />
          <Link to="/activities/lottery">
            <SiteButton type="button">返回抽奖活动</SiteButton>
          </Link>
        </SitePanel>
      ) : null}

      {!loading && status?.isWinner ? (
        <SitePanel>
          <SiteSectionTitle
            title="填写中奖信息"
            description={
              status.activityTitle
                ? `活动：${status.activityTitle}。请填写真实有效的收货地址与 QQ 号，提交后不可修改。`
                : "请填写真实有效的收货地址与 QQ 号，提交后不可修改。"
            }
          />

          {submitted ? (
            <SiteAlert variant="success">
              信息已提交。发货状态：{status.shippingStatus === "shipped" ? "已发货" : "待发货"}
            </SiteAlert>
          ) : (
            <div className="mt-4 space-y-3">
              <SiteInput value={name} onChange={(e) => setName(e.target.value)} placeholder="收货人姓名" disabled={submitting} />
              <SiteInput value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="手机号" disabled={submitting} />
              <SiteInput value={qq} onChange={(e) => setQq(e.target.value)} placeholder="QQ号（必填）" disabled={submitting} />
              <SiteInput value={wechat} onChange={(e) => setWechat(e.target.value)} placeholder="微信号（选填）" disabled={submitting} />
              <div className="grid gap-3 sm:grid-cols-2">
                <SiteInput value={province} onChange={(e) => setProvince(e.target.value)} placeholder="省份" disabled={submitting} />
                <SiteInput value={city} onChange={(e) => setCity(e.target.value)} placeholder="城市" disabled={submitting} />
              </div>
              <SiteTextarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="详细收货地址"
                rows={3}
                disabled={submitting}
              />
              <SiteButton type="button" disabled={submitting} onClick={() => void handleSubmit()}>
                {submitting ? "提交中…" : "确认提交"}
              </SiteButton>
            </div>
          )}
        </SitePanel>
      ) : null}

      {notice ? <SiteAlert variant="success">{notice}</SiteAlert> : null}
      {errorMessage ? <SiteAlert variant="error">{errorMessage}</SiteAlert> : null}

      <Link to="/activities/lottery">
        <SiteButton type="button" className="bg-transparent text-slate-700 ring-1 ring-slate-300 dark:text-slate-200 dark:ring-slate-600">
          返回抽奖活动
        </SiteButton>
      </Link>
    </SitePageLayout>
  );
}
