import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SitePageLayout } from "../components/SitePageLayout";
import {
  SiteAlert,
  SiteButton,
  SiteInput,
  SiteLabel,
  SitePanel,
  SITE_PANEL_NESTED_CLASS,
} from "../components/SiteUi";
import { useThemeMode } from "../hooks/useThemeMode";
import { getAuthState, hasValidLocalAuth } from "../services/authService";
import {
  AI_CREDIT_COST,
  DEFAULT_AI_CREDITS,
  fetchProfile,
} from "../services/profileService";
import {
  MAX_DISPLAY_NAME_LENGTH,
  checkDisplayNameAvailable,
  getDefaultDisplayName,
  getDisplayName,
  saveDisplayName,
  syncDisplayNameFromServer,
} from "../services/welcomeService";

export default function ProfilePage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useThemeMode();
  const auth = getAuthState();
  const serial = auth?.serial || "";
  const [displayName, setDisplayName] = useState(() => getDisplayName(serial));
  const [nameInput, setNameInput] = useState(() => getDisplayName(serial));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [nameHint, setNameHint] = useState("");
  const [credits, setCredits] = useState<number | null>(null);
  const [likeRewardCredits, setLikeRewardCredits] = useState(1);

  useEffect(() => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    if (!serial) return;
    setLoading(true);
    void Promise.all([syncDisplayNameFromServer(serial), fetchProfile()])
      .then(([name, profile]) => {
        setDisplayName(name);
        setNameInput(name);
        if (typeof profile.credits === "number") {
          setCredits(profile.credits);
        } else {
          setCredits(DEFAULT_AI_CREDITS);
        }
        if (typeof profile.likeRewardCredits === "number") {
          setLikeRewardCredits(profile.likeRewardCredits);
        }
      })
      .catch(() => {
        setCredits(DEFAULT_AI_CREDITS);
      })
      .finally(() => setLoading(false));
  }, [navigate, serial]);

  const handleSave = async () => {
    if (!serial) return;
    setSaving(true);
    setErrorMessage("");
    setNameHint("");
    setNotice("");
    try {
      const available = await checkDisplayNameAvailable(serial, nameInput);
      if (!available) {
        setErrorMessage("该昵称已被使用，请换一个");
        return;
      }
      const saved = await saveDisplayName(serial, nameInput);
      setDisplayName(saved);
      setNameInput(saved);
      setNotice("昵称已保存，留言板将显示此名称");
      window.setTimeout(() => setNotice(""), 4000);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefault = async () => {
    if (!serial) return;
    const defaultName = getDefaultDisplayName(serial);
    setNameInput(defaultName);
    setSaving(true);
    setErrorMessage("");
    setNotice("");
    try {
      const saved = await saveDisplayName(serial, "");
      setDisplayName(saved);
      setNameInput(saved);
      setNotice("已恢复为默认昵称（SN 后十位）");
      window.setTimeout(() => setNotice(""), 4000);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "恢复失败");
    } finally {
      setSaving(false);
    }
  };

  const defaultName = serial ? getDefaultDisplayName(serial) : "—";
  const usingCustomName = Boolean(serial && displayName !== defaultName);

  return (
    <SitePageLayout
      subtitle="个人中心 · 昵称与 AI 积分"
      theme={theme}
      onToggleTheme={toggleTheme}
      contentClassName="mx-auto w-full max-w-3xl"
    >
        <SitePanel className="space-y-5">
          <div className="space-y-2">
            <SiteLabel>设备 SN 码</SiteLabel>
            <div className={`break-all px-4 py-3 font-mono text-sm text-slate-800 dark:text-slate-100 ${SITE_PANEL_NESTED_CLASS}`}>
              {serial || "—"}
            </div>
          </div>

          <div className="space-y-2">
            <SiteLabel>AI 生图积分</SiteLabel>
            <div className="rounded-2xl border border-violet-200/70 bg-violet-50/80 px-4 py-3 dark:border-violet-500/30 dark:bg-violet-500/10">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-2xl font-semibold text-violet-700 dark:text-violet-200">
                  {loading ? "—" : credits ?? DEFAULT_AI_CREDITS}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  默认 {DEFAULT_AI_CREDITS} · 每次生图消耗 {AI_CREDIT_COST} · 素材被点赞 +{likeRewardCredits}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                上传素材被他人点赞可获得积分，前往{" "}
                <Link to="/shop" className="text-violet-600 hover:underline dark:text-violet-300">
                  积分商城
                </Link>{" "}
                兑换权益。
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SiteLabel>网站昵称</SiteLabel>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                默认：SN 后十位（{defaultName}）
              </span>
            </div>
            <SiteInput
              value={nameInput}
              disabled={loading || saving}
              onChange={(event) => {
                setNameInput(event.target.value.slice(0, MAX_DISPLAY_NAME_LENGTH));
                setNameHint("");
                setErrorMessage("");
              }}
              onBlur={() => {
                if (!serial || !nameInput.trim() || nameInput.trim() === defaultName) {
                  setNameHint("");
                  return;
                }
                void checkDisplayNameAvailable(serial, nameInput).then((available) => {
                  setNameHint(available ? "" : "该昵称已被使用");
                });
              }}
              placeholder={defaultName}
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              留言板、欢迎语与 AI 分享作者名将显示此昵称。自定义昵称全站不可重复。当前显示：
              <span className="ml-1 font-medium text-violet-600 dark:text-violet-300">
                {loading ? "加载中…" : displayName}
              </span>
              {usingCustomName ? null : "（默认）"}
            </p>
            {nameHint ? (
              <p className="text-xs text-amber-600 dark:text-amber-300">{nameHint}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <SiteButton
              type="button"
              disabled={loading || saving || !nameInput.trim()}
              onClick={() => void handleSave()}
            >
              {saving ? "保存中…" : "保存昵称"}
            </SiteButton>
            <SiteButton
              type="button"
              variant="secondary"
              disabled={loading || saving || !usingCustomName}
              onClick={() => void handleResetDefault()}
            >
              恢复默认
            </SiteButton>
          </div>

          {notice ? <SiteAlert variant="success">{notice}</SiteAlert> : null}
          {errorMessage ? <SiteAlert variant="error">{errorMessage}</SiteAlert> : null}
        </SitePanel>
    </SitePageLayout>
  );
}
