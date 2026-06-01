import { getAuthState, hasValidLocalAuth } from "./authService";
import { apiFetch } from "./httpClient";
import { isStaticMode } from "./runtimeMode";
import { getDisplayName } from "./welcomeService";
import type { BoardMessage, MessageBoardState } from "../types/messageBoard";

interface MessagesResponse {
  success?: boolean;
  messages?: BoardMessage[];
  total?: number;
  message?: string;
}

interface PostMessageResponse {
  success?: boolean;
  message?: BoardMessage;
}

const LOCAL_MESSAGES_KEY = "jiadian_hub_messages";
const MAX_MESSAGE_LENGTH = 500;

function readLocalMessages(): BoardMessage[] {
  try {
    const raw = localStorage.getItem(LOCAL_MESSAGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BoardMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalMessages(messages: BoardMessage[]): void {
  localStorage.setItem(LOCAL_MESSAGES_KEY, JSON.stringify(messages));
}

function normalizeMessage(raw: unknown): BoardMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const id = typeof item.id === "string" ? item.id : "";
  const username = typeof item.username === "string" ? item.username : "";
  const content = typeof item.content === "string" ? item.content : "";
  const createdAt = Number(item.createdAt);
  if (!id || !content || !Number.isFinite(createdAt)) return null;
  return { id, username, content, createdAt };
}

export async function fetchMessages(limit = 100): Promise<MessageBoardState> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  if (isStaticMode()) {
    const messages = readLocalMessages()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
    return { messages, total: readLocalMessages().length };
  }

  const auth = getAuthState();
  const payload = await apiFetch<MessagesResponse>(`/api/messages?limit=${limit}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${auth?.token || ""}`,
    },
  });

  const messages = (payload.messages || [])
    .map(normalizeMessage)
    .filter((item): item is BoardMessage => item !== null);

  return {
    messages,
    total: Math.max(0, Number(payload.total || messages.length)),
  };
}

export async function postMessage(content: string): Promise<BoardMessage> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("留言内容不能为空");
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`留言最多${MAX_MESSAGE_LENGTH}字`);
  }

  const auth = getAuthState();
  if (!auth?.serial) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  if (isStaticMode()) {
    const entry: BoardMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      username: getDisplayName(auth.serial),
      content: trimmed,
      createdAt: Date.now(),
    };
    const messages = readLocalMessages();
    messages.push(entry);
    writeLocalMessages(messages);
    return entry;
  }

  const payload = await apiFetch<PostMessageResponse>("/api/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify({
      content: trimmed,
      displayName: getDisplayName(auth.serial),
    }),
  });

  const message = normalizeMessage(payload.message);
  if (!message) {
    throw new Error("留言发布失败");
  }
  return message;
}

export { MAX_MESSAGE_LENGTH };
