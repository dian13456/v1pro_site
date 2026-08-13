import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ResourceLibraryHeader } from "../components/ResourceLibraryHeader";
import { SiteFooter } from "../components/SiteFooter";
import { SiteAlert } from "../components/SiteUi";
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
import { CreditLedgerPanel } from "../components/CreditLedgerPanel";
import { MyUploadsPanel } from "../components/MyUploadsPanel";
import type { CreditLedgerEntry } from "../types/credits";
import { formatCredits } from "../utils/formatCredits";
import { removeProfileAvatar, uploadProfileAvatar } from "../services/avatarService";
import { ThemeSelector } from "../components/ThemeSelector";
import { useThemeMode } from "../hooks/useThemeMode";
import {
  downloadDefaultThemePackage,
  getInstalledThemePackage,
  installThemePackage,
  readThemePackageFile,
  removeInstalledThemePackage,
  type V1ProThemePackage,
} from "../services/themePackageService";

export default function ProfilePage() {
  const navigate = useNavigate();
  const { theme, setTheme } = useThemeMode();
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
  const [actorLikeRewardCredits, setActorLikeRewardCredits] = useState(0.5);
  const [downloadRewardCredits, setDownloadRewardCredits] = useState(0.5);
  const [creditLedger, setCreditLedger] = useState<CreditLedgerEntry[]>([]);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [installedTheme, setInstalledTheme] = useState<V1ProThemePackage | null>(() => getInstalledThemePackage());
  const [themeNotice, setThemeNotice] = useState("");
  const [themeError, setThemeError] = useState("");
  const [themeImporting, setThemeImporting] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const themeInputRef = useRef<HTMLInputElement>(null);

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
        setAvatarUrl(profile.avatarUrl || "");
        if (typeof profile.credits === "number") {
          setCredits(profile.credits);
        } else {
          setCredits(DEFAULT_AI_CREDITS);
        }
        if (typeof profile.likeRewardCredits === "number") {
          setLikeRewardCredits(profile.likeRewardCredits);
        }
        if (typeof profile.actorLikeRewardCredits === "number") {
          setActorLikeRewardCredits(profile.actorLikeRewardCredits);
        }
        if (typeof profile.downloadRewardCredits === "number") {
          setDownloadRewardCredits(profile.downloadRewardCredits);
        }
        setCreditLedger(Array.isArray(profile.creditLedger) ? profile.creditLedger : []);
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

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setAvatarSaving(true);
    setErrorMessage("");
    setNotice("");
    try {
      const nextAvatarUrl = await uploadProfileAvatar(file);
      setAvatarUrl(nextAvatarUrl);
      setNotice("头像已上传到 COS 并保存");
      window.setTimeout(() => setNotice(""), 4000);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "头像上传失败");
    } finally {
      setAvatarSaving(false);
    }
  };

  const handleAvatarRemove = async () => {
    setAvatarSaving(true);
    setErrorMessage("");
    try {
      await removeProfileAvatar();
      setAvatarUrl("");
      setNotice("头像已恢复为默认样式");
      window.setTimeout(() => setNotice(""), 4000);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "头像删除失败");
    } finally {
      setAvatarSaving(false);
    }
  };

  const handleThemeImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setThemeImporting(true);
    setThemeError("");
    setThemeNotice("");
    try {
      const imported = await readThemePackageFile(file);
      installThemePackage(imported);
      setInstalledTheme(imported);
      setTheme("custom");
      setThemeNotice(`主题“${imported.name}”已导入并启用`);
    } catch (err) {
      setThemeError((err as Error)?.message || "主题包导入失败");
    } finally {
      setThemeImporting(false);
    }
  };

  const handleThemeRemove = () => {
    removeInstalledThemePackage();
    setInstalledTheme(null);
    if (theme === "custom") setTheme("light");
    setThemeError("");
    setThemeNotice("已移除导入主题并恢复浅色主题");
  };

  const defaultName = serial ? getDefaultDisplayName(serial) : "—";
  const usingCustomName = Boolean(serial && displayName !== defaultName);

  return (
    <div className="site-page-shell resource-library-shell min-h-screen text-[#2b3245]">
      <ResourceLibraryHeader keyword="" onSearch={(value) => navigate(value ? `/?q=${encodeURIComponent(value)}` : "/")} />
      <main className="mx-auto max-w-[980px] space-y-[14px] px-4 py-6 sm:px-6">
        <section className="overflow-hidden rounded-[18px] border border-[#e6e9f2] bg-white shadow-[0_10px_30px_rgba(43,50,69,.06)]">
          <header className="flex flex-wrap items-center gap-4 border-b border-[#e6e9f2] px-6 py-5">
            <button
              type="button"
              disabled={loading || avatarSaving}
              onClick={() => avatarInputRef.current?.click()}
              className="group relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-[#ff8a5c] to-[#7c6cf0] text-2xl text-white shadow-[0_6px_16px_rgba(124,108,240,.25)] disabled:opacity-60"
              title="上传或更换头像"
            >
              {avatarUrl ? <img src={avatarUrl} alt="个人头像" className="h-full w-full object-cover" /> : "👤"}
              <span className="absolute inset-x-0 bottom-0 bg-black/55 py-0.5 text-center text-[9px] font-semibold opacity-0 transition group-hover:opacity-100">更换</span>
            </button>
            <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => void handleAvatarChange(event)} />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-xl font-extrabold">{loading ? "个人中心" : displayName}</h1>
              <p className="mt-1 break-all font-mono text-xs text-[#8a93a8]">SN: {serial || "—"}</p>
            </div>
            <div className="rounded-2xl bg-[#fff7f2] px-5 py-3 text-right">
              <div className="text-[11px] font-semibold text-[#8a93a8]">当前积分</div>
              <div className="mt-0.5 text-2xl font-extrabold text-[#ff8a5c]">{loading ? "—" : formatCredits(credits ?? DEFAULT_AI_CREDITS)}</div>
            </div>
            <div className="flex flex-col gap-1 text-[11px]">
              <button type="button" disabled={loading || avatarSaving} onClick={() => avatarInputRef.current?.click()} className="font-semibold text-[#7c6cf0] disabled:opacity-50">{avatarSaving ? "处理中…" : avatarUrl ? "更换头像" : "上传头像"}</button>
              {avatarUrl ? <button type="button" disabled={avatarSaving} onClick={() => void handleAvatarRemove()} className="text-[#8a93a8] disabled:opacity-50">删除头像</button> : null}
            </div>
          </header>

          <div className="grid gap-5 p-6 md:grid-cols-[1fr_1.25fr]">
            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <label className="text-[12.5px] font-semibold text-[#4a5270]">网站昵称</label>
                <span className="text-[11px] text-[#8a93a8]">默认：SN 后十位（{defaultName}）</span>
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
                  void checkDisplayNameAvailable(serial, nameInput).then((available) => setNameHint(available ? "" : "该昵称已被使用"));
                }}
                placeholder={defaultName}
                className="w-full rounded-[10px] border border-[#e6e9f2] bg-[#fafbfe] px-3 py-[9px] text-[13px] outline-none transition focus:border-[#ff8a5c] disabled:opacity-50"
              />
              <p className="mt-2 text-xs leading-relaxed text-[#8a93a8]">
                留言板、欢迎语与分享作者名将显示此昵称。当前显示：<span className="font-semibold text-[#7c6cf0]">{loading ? "加载中…" : displayName}</span>{usingCustomName ? null : "（默认）"}
              </p>
              {nameHint ? <p className="mt-2 text-xs text-amber-600">{nameHint}</p> : null}
              <div className="mt-4 flex flex-wrap gap-2.5">
                <button type="button" disabled={loading || saving || !nameInput.trim()} onClick={() => void handleSave()} className="rounded-[10px] bg-gradient-to-br from-[#ff8a5c] to-[#ff6f9c] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_4px_12px_rgba(255,138,92,.25)] disabled:opacity-50">{saving ? "保存中…" : "保存昵称"}</button>
                <button type="button" disabled={loading || saving || !usingCustomName} onClick={() => void handleResetDefault()} className="rounded-[10px] bg-[#f1f3f8] px-5 py-2.5 text-[13px] font-semibold text-[#4a5270] disabled:opacity-50">恢复默认</button>
              </div>
              {notice ? <SiteAlert variant="success" className="mt-4">{notice}</SiteAlert> : null}
              {errorMessage ? <SiteAlert variant="error" className="mt-4">{errorMessage}</SiteAlert> : null}
            </section>

            <section className="rounded-[14px] border border-[#e6e9f2] bg-[#fafbfe] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-[13px] font-bold">积分与奖励</h2>
                  <p className="mt-1 text-[11px] text-[#8a93a8]">默认 {DEFAULT_AI_CREDITS} · 生图消耗 {AI_CREDIT_COST}</p>
                </div>
                <Link to="/shop" className="rounded-full border border-[#e6e9f2] bg-white px-3 py-1.5 text-xs font-semibold text-[#7c6cf0] hover:border-[#7c6cf0]">积分商城</Link>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[#8a93a8]">被点赞 +{formatCredits(likeRewardCredits)} · 点赞他人 +{formatCredits(actorLikeRewardCredits)} · 被下载 +{formatCredits(downloadRewardCredits)}</p>
              <CreditLedgerPanel entries={creditLedger} loading={loading} />
            </section>
          </div>
        </section>

        <section className="overflow-hidden rounded-[18px] border border-[#e6e9f2] bg-white shadow-[0_10px_30px_rgba(43,50,69,.06)] dark:border-slate-800 dark:bg-slate-900">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6e9f2] px-6 py-4 dark:border-slate-800">
            <div>
              <h2 className="text-[15px] font-extrabold dark:text-white">网站主题包</h2>
              <p className="mt-1 text-xs text-[#8a93a8] dark:text-slate-400">主题仅保存在当前浏览器，不上传服务器，也不会修改网站功能。</p>
            </div>
            <ThemeSelector theme={theme} onChange={setTheme} />
          </header>
          <div className="grid gap-4 p-6 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              {installedTheme ? (
                <div className="rounded-[14px] border border-[#e6e9f2] bg-[#fafbfe] px-4 py-3 dark:border-slate-700 dark:bg-slate-800/70">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm dark:text-white">{installedTheme.name}</strong>
                    <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">v{installedTheme.version}</span>
                    <span className="rounded-full bg-cyan-50 px-2 py-1 text-[10px] font-bold text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300">{installedTheme.appearance === "dark" ? "深色" : "浅色"}</span>
                  </div>
                  <p className="mt-1.5 text-xs text-[#8a93a8] dark:text-slate-400">作者：{installedTheme.author}{installedTheme.description ? ` · ${installedTheme.description}` : ""}</p>
                </div>
              ) : (
                <div className="rounded-[14px] border border-dashed border-[#dfe3ee] px-4 py-5 text-center text-xs text-[#8a93a8] dark:border-slate-700 dark:text-slate-400">尚未导入自定义主题</div>
              )}
              {themeNotice ? <SiteAlert variant="success" className="mt-3">{themeNotice}</SiteAlert> : null}
              {themeError ? <SiteAlert variant="error" className="mt-3">{themeError}</SiteAlert> : null}
            </div>
            <div className="flex flex-wrap gap-2 md:max-w-[310px] md:justify-end">
              <input ref={themeInputRef} type="file" accept=".v1theme,.json,application/json" className="hidden" onChange={(event) => void handleThemeImport(event)} />
              <button type="button" disabled={themeImporting} onClick={() => themeInputRef.current?.click()} className="rounded-[10px] bg-gradient-to-br from-[#7c6cf0] to-[#5d8cff] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{themeImporting ? "校验中…" : installedTheme ? "替换主题包" : "导入主题包"}</button>
              {installedTheme && theme !== "custom" ? <button type="button" onClick={() => setTheme("custom")} className="rounded-[10px] bg-[#eef0ff] px-4 py-2.5 text-xs font-semibold text-[#6557db] dark:bg-violet-500/10 dark:text-violet-300">启用主题</button> : null}
              {installedTheme ? <button type="button" onClick={handleThemeRemove} className="rounded-[10px] bg-[#fff1ef] px-4 py-2.5 text-xs font-semibold text-[#df6259] dark:bg-rose-500/10 dark:text-rose-300">移除</button> : null}
              <button type="button" onClick={downloadDefaultThemePackage} className="rounded-[10px] border border-[#e6e9f2] bg-white px-4 py-2.5 text-xs font-semibold text-[#4a5270] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">下载示例包</button>
            </div>
          </div>
        </section>

        <MyUploadsPanel />
      </main>
      <SiteFooter />
    </div>
  );
}
