import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SiteFooter } from "../components/SiteFooter";
import { SiteHeader } from "../components/SiteHeader";
import { SiteNav } from "../components/SiteNav";
import { ThemeToggle } from "../components/ThemeToggle";
import { useThemeMode } from "../hooks/useThemeMode";
import { clearAuthState, getAuthState, hasValidLocalAuth } from "../services/authService";
import {
  MAX_DISPLAY_NAME_LENGTH,
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

  useEffect(() => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    if (!serial) return;
    setLoading(true);
    void syncDisplayNameFromServer(serial)
      .then((name) => {
        setDisplayName(name);
        setNameInput(name);
      })
      .finally(() => setLoading(false));
  }, [navigate, serial]);

  const handleLogout = () => {
    clearAuthState();
    navigate("/auth", { replace: true });
  };

  const handleSave = async () => {
    if (!serial) return;
    setSaving(true);
    setErrorMessage("");
    setNotice("");
    try {
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_8%_14%,rgba(125,211,252,0.22),transparent_42%),radial-gradient(circle_at_90%_10%,rgba(147,197,253,0.2),transparent_38%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] text-slate-900 dark:bg-[radial-gradient(circle_at_8%_14%,rgba(14,116,144,0.25),transparent_42%),radial-gradient(circle_at_90%_10%,rgba(30,64,175,0.24),transparent_38%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] dark:text-slate-100">
      <div className="mx-auto max-w-[720px] px-4 py-6 sm:px-6 lg:px-8">
        <SiteHeader
          title="个人中心"
          rightSlot={
            <div className="flex flex-wrap items-center gap-2">
              <SiteNav />
              <ThemeToggle dark={theme === "dark"} onToggle={toggleTheme} />
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full border border-white/30 bg-white/50 px-4 py-2 text-sm text-slate-700 backdrop-blur dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-100"
              >
                退出认证
              </button>
            </div>
          }
        />

        <section className="space-y-5 rounded-3xl border border-white/25 bg-white/55 p-5 backdrop-blur dark:border-white/10 dark:bg-slate-900/45">
          <div className="space-y-2">
            <label className="text-sm text-slate-600 dark:text-slate-300">设备 SN 码</label>
            <div className="break-all rounded-2xl border border-white/30 bg-white/70 px-4 py-3 font-mono text-sm text-slate-800 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100">
              {serial || "—"}
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
              onChange={(event) => setNameInput(event.target.value.slice(0, MAX_DISPLAY_NAME_LENGTH))}
              placeholder={defaultName}
              className="w-full rounded-2xl border border-white/30 bg-white/70 px-4 py-3 text-sm outline-none ring-violet-400/40 focus:ring-2 disabled:opacity-60 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100"
            />
            <p className="text-xs text-slate-500 dark:text-slate-400">
              留言板、欢迎语与 AI 分享作者名将显示此昵称。当前显示：
              <span className="ml-1 font-medium text-violet-600 dark:text-violet-300">
                {loading ? "加载中…" : displayName}
              </span>
              {usingCustomName ? null : "（默认）"}
            </p>
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
      </div>
    </div>
  );
}
