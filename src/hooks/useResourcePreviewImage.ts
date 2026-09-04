import { useCallback, useEffect, useRef, useState } from "react";
import { hasValidLocalAuth } from "../services/authService";
import { createImageUrl, invalidateImageUrl } from "../services/imageService";

const MAX_PREVIEW_RETRIES = 2;
// A local, non-sensitive fallback keeps a broken public cover from leaving a
// card empty.  Never fall back to the original/download URL here: those may be
// private or may require device authentication.
const PUBLIC_PREVIEW_PLACEHOLDER_URL = `${import.meta.env.BASE_URL}preview-placeholder.svg`;

/**
 * A public cover is intentionally usable before device authentication.  When
 * a CDN edge briefly returns an error, append a deterministic cache buster so
 * the browser can retry the same public object instead of reusing the failed
 * response.  Keep the original URL for the first attempt to preserve normal
 * CDN cache hits.
 */
function publicPreviewRetryUrl(url: string, retryVersion: number): string {
  if (retryVersion <= 0) return url;
  try {
    const parsed = new URL(url, window.location.href);
    parsed.searchParams.set("preview-retry", String(retryVersion));
    return parsed.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}preview-retry=${retryVersion}`;
  }
}

export function useResourcePreviewImage(
  resourceId: number,
  fallbackImageUrl?: string,
  publicPreviewUrl?: string,
): {
  previewUrl: string;
  previewFailed: boolean;
  handlePreviewLoad: () => void;
  handlePreviewError: () => void;
} {
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const placeholderActiveRef = useRef(false);

  useEffect(() => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    retryCountRef.current = 0;
    placeholderActiveRef.current = false;
    setRetryVersion(0);
    setPreviewFailed(false);
  }, [resourceId, fallbackImageUrl, publicPreviewUrl]);

  useEffect(() => {
    let active = true;
    placeholderActiveRef.current = false;
    setPreviewFailed(false);
    // Card covers are public display assets. Keep their loading path entirely
    // independent from device authentication: a logged-in browser must not
    // switch to the signed API merely because one CDN attempt failed.
    if (publicPreviewUrl) {
      setPreviewUrl(publicPreviewRetryUrl(publicPreviewUrl, retryVersion));
      return () => {
        active = false;
      };
    }
    if (!hasValidLocalAuth()) {
      placeholderActiveRef.current = true;
      setPreviewUrl(PUBLIC_PREVIEW_PLACEHOLDER_URL);
      setPreviewFailed(true);
      return () => {
        active = false;
      };
    }
    void createImageUrl(resourceId, fallbackImageUrl, {
      forceRefresh: retryVersion > 0,
    })
      .then((result) => {
        if (!active) return;
        if (result.url) {
          setPreviewUrl(result.url);
          return;
        }
        placeholderActiveRef.current = true;
        setPreviewUrl(PUBLIC_PREVIEW_PLACEHOLDER_URL);
        setPreviewFailed(true);
      })
      .catch(() => {
        if (!active) return;
        placeholderActiveRef.current = true;
        setPreviewUrl(PUBLIC_PREVIEW_PLACEHOLDER_URL);
        setPreviewFailed(true);
      });
    return () => {
      active = false;
    };
  }, [fallbackImageUrl, publicPreviewUrl, resourceId, retryVersion]);

  useEffect(() => () => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
    }
  }, []);

  const handlePreviewLoad = useCallback(() => {
    retryCountRef.current = 0;
    // Keep the failure badge when the local placeholder is the rendered
    // image; this distinguishes a healthy cover from a recoverable missing
    // public object without exposing a private source.
    if (!placeholderActiveRef.current) setPreviewFailed(false);
  }, []);

  const handlePreviewError = useCallback(() => {
    // The fallback is local and should never enter the CDN retry loop.
    if (placeholderActiveRef.current) return;
    invalidateImageUrl(resourceId, previewUrl);
    if (retryCountRef.current >= MAX_PREVIEW_RETRIES) {
      placeholderActiveRef.current = true;
      setPreviewUrl(PUBLIC_PREVIEW_PLACEHOLDER_URL);
      setPreviewFailed(true);
      return;
    }
    // Keep the gradient/placeholder already rendered by the card visible
    // while the bounded retry waits, instead of flashing an empty frame.
    retryCountRef.current += 1;
    const delay = retryCountRef.current * 500;
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      setRetryVersion((value) => value + 1);
    }, delay);
  }, [previewUrl, resourceId]);

  return { previewUrl, previewFailed, handlePreviewLoad, handlePreviewError };
}
