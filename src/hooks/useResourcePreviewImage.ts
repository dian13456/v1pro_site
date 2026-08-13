import { useCallback, useEffect, useRef, useState } from "react";
import { createImageUrl, invalidateImageUrl } from "../services/imageService";

const MAX_PREVIEW_RETRIES = 2;

export function useResourcePreviewImage(
  resourceId: number,
  fallbackImageUrl?: string,
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

  useEffect(() => {
    retryCountRef.current = 0;
    setRetryVersion(0);
    setPreviewFailed(false);
  }, [resourceId, fallbackImageUrl]);

  useEffect(() => {
    let active = true;
    setPreviewFailed(false);
    void createImageUrl(resourceId, fallbackImageUrl, {
      forceRefresh: retryVersion > 0,
    })
      .then((result) => {
        if (active) setPreviewUrl(result.url || "");
      })
      .catch(() => {
        if (active) {
          setPreviewUrl("");
          setPreviewFailed(retryCountRef.current >= MAX_PREVIEW_RETRIES);
        }
      });
    return () => {
      active = false;
    };
  }, [fallbackImageUrl, resourceId, retryVersion]);

  useEffect(() => () => {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
    }
  }, []);

  const handlePreviewLoad = useCallback(() => {
    retryCountRef.current = 0;
    setPreviewFailed(false);
  }, []);

  const handlePreviewError = useCallback(() => {
    invalidateImageUrl(resourceId, previewUrl);
    setPreviewUrl("");
    if (retryCountRef.current >= MAX_PREVIEW_RETRIES) {
      setPreviewFailed(true);
      return;
    }
    retryCountRef.current += 1;
    const delay = retryCountRef.current * 500;
    retryTimerRef.current = window.setTimeout(() => {
      retryTimerRef.current = null;
      setRetryVersion((value) => value + 1);
    }, delay);
  }, [previewUrl, resourceId]);

  return { previewUrl, previewFailed, handlePreviewLoad, handlePreviewError };
}
