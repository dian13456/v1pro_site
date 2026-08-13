import { useEffect, useState } from "react";
import { fetchCreatorProfile } from "../services/avatarService";

const avatarCache = new Map<string, string>();
const avatarRequests = new Map<string, Promise<string>>();

function cacheKey(author: string): string {
  return author.trim().toLocaleLowerCase("zh-CN");
}

function requestCreatorAvatar(author: string): Promise<string> {
  const key = cacheKey(author);
  if (!key) return Promise.resolve("");
  if (avatarCache.has(key)) return Promise.resolve(avatarCache.get(key) || "");

  const pending = avatarRequests.get(key);
  if (pending) return pending;

  const request = fetchCreatorProfile(author)
    .then((profile) => {
      const avatarUrl = profile.avatarUrl || "";
      avatarCache.set(key, avatarUrl);
      return avatarUrl;
    })
    .catch(() => {
      avatarCache.set(key, "");
      return "";
    })
    .finally(() => avatarRequests.delete(key));
  avatarRequests.set(key, request);
  return request;
}

export function useCreatorAvatar(author?: string): string {
  const normalizedAuthor = (author || "").trim();
  const key = cacheKey(normalizedAuthor);
  const [avatarUrl, setAvatarUrl] = useState(() => avatarCache.get(key) || "");

  useEffect(() => {
    let active = true;
    setAvatarUrl(avatarCache.get(key) || "");
    if (normalizedAuthor) {
      void requestCreatorAvatar(normalizedAuthor).then((url) => {
        if (active) setAvatarUrl(url);
      });
    }
    return () => {
      active = false;
    };
  }, [key, normalizedAuthor]);

  return avatarUrl;
}
