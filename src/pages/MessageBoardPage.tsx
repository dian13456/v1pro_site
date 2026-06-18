import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SitePageLayout } from "../components/SitePageLayout";
import {
  SiteAlert,
  SiteButton,
  SiteEmptyBlock,
  SiteLoadingBlock,
  SitePanel,
  SiteTextarea,
} from "../components/SiteUi";
import { useThemeMode } from "../hooks/useThemeMode";
import { getAuthState, hasValidLocalAuth } from "../services/authService";
import {
  MAX_MESSAGE_LENGTH,
  fetchMessages,
  postMessage,
} from "../services/messageBoardService";
import type { BoardMessage } from "../types/messageBoard";
import { getDisplayName } from "../services/welcomeService";

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
  const myUsername = auth?.serial ? getDisplayName(auth.serial) : "";

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
    <SitePageLayout
      subtitle="用户留言板 · 分享使用体验、素材建议或问题反馈"
      theme={theme}
      onToggleTheme={toggleTheme}
      contentClassName="mx-auto w-full max-w-3xl space-y-5"
    >
        <SitePanel>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              当前昵称：<span className="font-medium text-violet-600 dark:text-violet-300">{myUsername || "—"}</span>
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">最多 {MAX_MESSAGE_LENGTH} 字</p>
          </div>
          <SiteTextarea
            value={content}
            onChange={(event) => setContent(event.target.value.slice(0, MAX_MESSAGE_LENGTH))}
            rows={4}
            placeholder="写下你的留言..."
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {content.trim().length}/{MAX_MESSAGE_LENGTH}
            </span>
            <SiteButton type="button" disabled={submitting || !content.trim()} onClick={() => void handleSubmit()}>
              {submitting ? "发布中..." : "发布留言"}
            </SiteButton>
          </div>
        </SitePanel>

        {errorMessage ? <SiteAlert variant="error">{errorMessage}</SiteAlert> : null}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">全部留言</h2>
            <span className="text-sm text-slate-500 dark:text-slate-400">共 {total} 条</span>
          </div>

          {loading ? <SiteLoadingBlock>正在加载留言...</SiteLoadingBlock> : null}
          {!loading && messages.length === 0 ? (
            <SiteEmptyBlock>还没有留言，来做第一个吧。</SiteEmptyBlock>
          ) : null}
          {!loading && messages.length > 0
            ? messages.map((item) => (
              <article key={item.id} className="rounded-2xl border border-white/25 bg-white/55 p-4 backdrop-blur dark:border-white/10 dark:bg-slate-900/45">
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
            : null}
        </section>
    </SitePageLayout>
  );
}
