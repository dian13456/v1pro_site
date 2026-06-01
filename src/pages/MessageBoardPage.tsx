import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SiteHeader } from "../components/SiteHeader";
import { SiteNav } from "../components/SiteNav";
import { ThemeToggle } from "../components/ThemeToggle";
import { useThemeMode } from "../hooks/useThemeMode";
import { clearAuthState, getAuthState, hasValidLocalAuth } from "../services/authService";
import {
  MAX_MESSAGE_LENGTH,
  fetchMessages,
  postMessage,
} from "../services/messageBoardService";
import type { BoardMessage } from "../types/messageBoard";
import { displayUsernameFromSerial } from "../utils/displayUsername";

function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function MessageBoardPage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useThemeMode();
  const [messages, setMessages] = useState<BoardMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const auth = getAuthState();
  const myUsername = auth?.serial ? displayUsernameFromSerial(auth.serial) : "";

  const loadMessages = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const result = await fetchMessages();
      setMessages(result.messages);
      setTotal(result.total);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "加载留言失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasValidLocalAuth()) {
      navigate("/auth", { replace: true });
      return;
    }
    void loadMessages();
  }, [navigate]);

  const handleLogout = () => {
    clearAuthState();
    navigate("/auth", { replace: true });
  };

  const handleSubmit = async () => {
    if (!content.trim()) {
      setErrorMessage("请输入留言内容");
      return;
    }
    try {
      setSubmitting(true);
      setErrorMessage("");
      const entry = await postMessage(content);
      setMessages((prev) => [entry, ...prev]);
      setTotal((prev) => prev + 1);
      setContent("");
    } catch (err) {
      const message = (err as Error)?.message || "发布留言失败";
      setErrorMessage(message);
      if (message.includes("认证")) {
        navigate("/auth", { replace: true });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_8%_14%,rgba(125,211,252,0.22),transparent_42%),radial-gradient(circle_at_90%_10%,rgba(147,197,253,0.2),transparent_38%),linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] text-slate-900 dark:bg-[radial-gradient(circle_at_8%_14%,rgba(14,116,144,0.25),transparent_42%),radial-gradient(circle_at_90%_10%,rgba(30,64,175,0.24),transparent_38%),linear-gradient(180deg,#020617_0%,#0f172a_100%)] dark:text-slate-100">
      <div className="mx-auto max-w-[960px] px-4 py-6 sm:px-6 lg:px-8">
        <SiteHeader
          title="用户留言板"
          subtitle="分享使用体验、素材建议或问题反馈。用户名显示为设备 SN 码后十位。"
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

        <section className="mb-6 rounded-3xl border border-white/25 bg-white/55 p-5 backdrop-blur dark:border-white/10 dark:bg-slate-900/45">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              当前身份：<span className="font-medium text-violet-600 dark:text-violet-300">{myUsername || "—"}</span>
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">最多 {MAX_MESSAGE_LENGTH} 字</p>
          </div>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
            rows={4}
            placeholder="写下你的留言..."
            className="w-full resize-y rounded-2xl border border-white/30 bg-white/70 px-4 py-3 text-sm text-slate-800 outline-none ring-violet-400/40 focus:ring-2 dark:border-white/10 dark:bg-slate-950/50 dark:text-slate-100"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {content.trim().length}/{MAX_MESSAGE_LENGTH}
            </span>
            <button
              type="button"
              disabled={submitting || !content.trim()}
              onClick={() => void handleSubmit()}
              className="rounded-full bg-violet-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "发布中..." : "发布留言"}
            </button>
          </div>
        </section>

        {errorMessage ? (
          <div className="mb-4 rounded-2xl border border-rose-200/70 bg-rose-50/90 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            {errorMessage}
          </div>
        ) : null}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">全部留言</h2>
            <span className="text-sm text-slate-500 dark:text-slate-400">共 {total} 条</span>
          </div>

          {loading ? (
            <div className="rounded-2xl border border-white/25 bg-white/55 px-4 py-8 text-center text-sm text-slate-500 dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-300">
              正在加载留言...
            </div>
          ) : messages.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/30 bg-white/40 px-4 py-10 text-center text-sm text-slate-500 dark:border-white/10 dark:bg-slate-900/30 dark:text-slate-400">
              还没有留言，来做第一个吧。
            </div>
          ) : (
            messages.map((item) => (
              <article
                key={item.id}
                className="rounded-2xl border border-white/25 bg-white/55 p-4 backdrop-blur dark:border-white/10 dark:bg-slate-900/45"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-full bg-violet-500/15 px-3 py-1 text-sm font-medium text-violet-700 dark:text-violet-200">
                    {item.username}
                  </span>
                  <time className="text-xs text-slate-500 dark:text-slate-400">
                    {formatMessageTime(item.createdAt)}
                  </time>
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 dark:text-slate-200">
                  {item.content}
                </p>
              </article>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
