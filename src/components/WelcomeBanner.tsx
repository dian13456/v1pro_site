import { useEffect, useState } from "react";
import { getAuthState } from "../services/authService";
import {
  MAX_DISPLAY_NAME_LENGTH,
  fetchWelcomeMessage,
  getDefaultDisplayName,
  getDisplayName,
  setDisplayName,
} from "../services/welcomeService";
import type { WelcomePayload } from "../types/welcome";

const DISMISS_KEY = "jiadian_hub_welcome_dismissed";

interface WelcomeBannerProps {
  className?: string;
}

export function WelcomeBanner({ className = "" }: WelcomeBannerProps) {
  const auth = getAuthState();
  const serial = auth?.serial || "";
  const [welcome, setWelcome] = useState<WelcomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === "1");
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");

  const loadWelcome = async () => {
    setLoading(true);
    try {
      const payload = await fetchWelcomeMessage();
      setWelcome(payload);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!serial || dismissed) {
      setLoading(false);
      return;
    }
    void loadWelcome();
  }, [serial, dismissed]);

  if (!serial || dismissed) {
    return null;
  }

  const handleSaveName = async () => {
    const nextName = setDisplayName(serial, nameInput);
    setEditing(false);
    setNameInput(nextName);
    await loadWelcome();
  };

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  const currentName = welcome?.username || getDisplayName(serial);
  const metaParts = [
    welcome?.localTime,
    welcome?.city ? `${welcome.city}${welcome.region ? ` · ${welcome.region}` : ""}` : "",
    welcome?.weatherText
      ? `${welcome.weatherText}${typeof welcome.temperature === "number" ? ` ${welcome.temperature}℃` : ""}`
      : "",
  ].filter(Boolean);

  return (
    <section
      className={`relative overflow-hidden rounded-3xl border border-cyan-200/60 bg-gradient-to-r from-cyan-50/95 via-white/90 to-sky-50/95 p-5 shadow-[0_12px_32px_-18px_rgba(14,116,144,0.45)] backdrop-blur dark:border-cyan-500/20 dark:from-cyan-950/40 dark:via-slate-900/70 dark:to-sky-950/30 ${className}`}
    >
      <button
        type="button"
        aria-label="关闭欢迎语"
        onClick={handleDismiss}
        className="absolute right-3 top-3 rounded-full px-2 py-1 text-sm text-slate-400 transition hover:bg-white/60 hover:text-slate-600 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
      >
        ×
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4 pr-8">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-600 dark:text-cyan-300">
            Welcome
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <input
                  value={nameInput}
                  onChange={(event) => setNameInput(event.target.value.slice(0, MAX_DISPLAY_NAME_LENGTH))}
                  className="rounded-xl border border-cyan-200 bg-white px-3 py-1.5 text-sm outline-none ring-cyan-400/40 focus:ring-2 dark:border-cyan-500/30 dark:bg-slate-950/60 dark:text-slate-100"
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

          {loading ? (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">AI 正在根据你的位置与天气生成专属欢迎语…</p>
          ) : (
            <p className="mt-3 text-sm leading-7 text-slate-700 dark:text-slate-200">{welcome?.message}</p>
          )}

          {!loading && metaParts.length > 0 ? (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{metaParts.join("  ·  ")}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
