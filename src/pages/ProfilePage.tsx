import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { SitePageShell } from "../components/SitePageShell";
import { SitePageToolbar } from "../components/SitePageToolbar";
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
    <SitePageShell>
        <SiteHeader
          title="佳点电子资源中心"
          subtitle="个人中心 · 昵称与 AI 积分"
          rightSlot={<SitePageToolbar theme={theme} onToggleTheme={toggleTheme} />}
        />

        <section className="mx-auto w-full max-w-3xl space-y-5 rounded-3xl border border-white/25 bg-white/55 p-5 backdrop-blur dark:border-white/10 dark:bg-slate-900/45">
          <div className="space-y-2">
            <label className="text-sm text-slate-600 dark:text-slate-300">设备 SN 码</label>
            <div className="break-all rounded-2xl border border-white/30 bg-white/70 px-4 py-3 font-mono text-sm text-slate-800 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100">
              {serial || "—"}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm text-slate-600 dark:text-slate-300">AI 生图积分</label>
            <div className="rounded-2xl border border-violet-200/70 bg-violet-50/80 px-4 py-3 dark:border-violet-500/30 dark:bg-violet-500/10">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-2xl font-semibold text-violet-700 dark:text-violet-200">
                  {loading ? "—" : credits ?? DEFAULT_AI_CREDITS}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  默认 {DEFAULT_AI_CREDITS} · 每次生图消耗 {AI_CREDIT_COST}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-sm text-slate-600 dark:text-slate-300">网站昵称</label>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                默认：SN 后十位（{defaultName}）
              </span>
            </div>
            <input
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
              className="w-full rounded-2xl border border-white/30 bg-white/70 px-4 py-3 text-sm outline-none ring-violet-400/40 focus:ring-2 disabled:opacity-60 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100"
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
            <button
              type="button"
              disabled={loading || saving || !nameInput.trim()}
              onClick={() => void handleSave()}
              className="rounded-full bg-violet-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "保存中…" : "保存昵称"}
            </button>
            <button
              type="button"
              disabled={loading || saving || !usingCustomName}
              onClick={() => void handleResetDefault()}
              className="rounded-full border border-slate-200/80 bg-white px-5 py-2.5 text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100"
            >
              恢复默认
            </button>
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
        </section>

        <SiteFooter />
    </SitePageShell>
  );
}
