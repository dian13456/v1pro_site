import { useEffect, useState } from "react";
import { getAuthState } from "../services/authService";
import {
  dismissWelcome,
  hasDismissedWelcome,
} from "../services/firstVisitPromptService";
import {
  MAX_DISPLAY_NAME_LENGTH,
  fetchWelcomeMessage,
  getDefaultDisplayName,
  getDisplayName,
  saveDisplayName,
  syncDisplayNameFromServer,
} from "../services/welcomeService";
import type { WelcomePayload } from "../types/welcome";

export function WelcomeModal() {
  const auth = getAuthState();
  const serial = auth?.serial || "";
  const [welcome, setWelcome] = useState<WelcomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(() => Boolean(serial) && !hasDismissedWelcome(serial));
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [displayName, setDisplayNameState] = useState(() => getDisplayName(serial));
  const [nameError, setNameError] = useState("");

  const loadWelcome = async () => {
    setLoading(true);
    try {
      const payload = await fetchWelcomeMessage();
      setWelcome(payload);
      if (payload.username) {
        setDisplayNameState(payload.username);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!serial || !open) {
      setLoading(false);
      return;
    }
    void syncDisplayNameFromServer(serial).then((name) => {
      setDisplayNameState(name);
      void loadWelcome();
    });
  }, [serial, open]);

  if (!serial || !open) {
    return null;
  }

  const handleDismiss = () => {
    dismissWelcome(serial);
    setOpen(false);
  };

  const handleSaveName = async () => {
    setNameError("");
    try {
      const nextName = await saveDisplayName(serial, nameInput);
      setEditing(false);
      setNameInput(nextName);
      setDisplayNameState(nextName);
      await loadWelcome();
    } catch (err) {
      setNameError((err as Error)?.message || "昵称保存失败");
    }
  };

  const currentName = displayName || welcome?.username || getDisplayName(serial);
  const metaParts = [
    welcome?.localTime,
    welcome?.city ? `${welcome.city}${welcome.region ? ` · ${welcome.region}` : ""}` : "",
    welcome?.weatherText
      ? `${welcome.weatherText}${typeof welcome.temperature === "number" && welcome.temperature !== 0 ? ` ${welcome.temperature}℃` : ""}`
      : "",
  ].filter(Boolean);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-modal-title"
        className="relative w-full max-w-md overflow-hidden rounded-3xl border border-cyan-200/60 bg-gradient-to-b from-cyan-50 via-white to-sky-50 p-6 shadow-2xl dark:border-cyan-500/20 dark:from-cyan-950/80 dark:via-slate-900 dark:to-sky-950/60"
      >
        <button
          type="button"
          aria-label="关闭欢迎语"
          onClick={handleDismiss}
          className="absolute right-4 top-4 rounded-full px-2 py-1 text-lg leading-none text-slate-400 transition hover:bg-white/60 hover:text-slate-600 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
        >
          ×
        </button>

        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-600 dark:text-cyan-300">Welcome</p>
        <h2 id="welcome-modal-title" className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-50">
          专属欢迎
        </h2>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <input
                value={nameInput}
                onChange={(event) => {
                  setNameInput(event.target.value.slice(0, MAX_DISPLAY_NAME_LENGTH));
                  setNameError("");
                }}
                className="min-w-0 flex-1 rounded-xl border border-cyan-200 bg-white px-3 py-1.5 text-sm outline-none ring-cyan-400/40 focus:ring-2 dark:border-cyan-500/30 dark:bg-slate-950/60 dark:text-slate-100"
                placeholder={getDefaultDisplayName(serial)}
              />
              <button
                type="button"
                onClick={() => void handleSaveName()}
                className="rounded-full bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white"
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setNameInput(currentName);
                  setNameError("");
                }}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <span className="rounded-full bg-cyan-600/10 px-3 py-1 text-sm font-medium text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-200">
                {currentName}
              </span>
              <button
                type="button"
                onClick={() => {
                  setNameInput(currentName);
                  setEditing(true);
                }}
                className="text-xs text-cyan-700 underline-offset-2 hover:underline dark:text-cyan-300"
              >
                修改昵称
              </button>
              <span className="text-xs text-slate-500 dark:text-slate-400">默认 SN 后十位</span>
            </>
          )}
        </div>
        {nameError ? (
          <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{nameError}</p>
        ) : null}

        <div className="mt-5 min-h-[4.5rem] rounded-2xl border border-cyan-100/80 bg-white/70 p-4 dark:border-cyan-500/15 dark:bg-slate-950/40">
          {loading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">AI 正在根据你的位置与天气生成专属欢迎语…</p>
          ) : (
            <p className="text-sm leading-7 text-slate-700 dark:text-slate-200">{welcome?.message}</p>
          )}
        </div>

        {!loading && metaParts.length > 0 ? (
          <p className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">{metaParts.join("  ·  ")}</p>
        ) : null}

        <button
          type="button"
          onClick={handleDismiss}
          className="mt-5 w-full rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-cyan-500"
        >
          知道了
        </button>
      </div>
    </div>
  );
}
