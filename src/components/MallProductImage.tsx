import { translate as t, useI18n } from "../i18n";
import { useEffect, useState } from "react";
import { fetchMallImageBlobUrl } from "../services/mallService";

interface MallProductImageProps {
  imageUrl?: string;
  title: string;
  className?: string;
  adminToken?: string;
  emptyText?: string;
  fit?: "cover" | "contain";
}

export function MallProductImage({
  imageUrl,
  title,
  className = "h-40 w-full",
  adminToken,
  emptyText = "暂无商品图",
  fit = "cover",
}: MallProductImageProps) {
  useI18n();
  const rawImageUrl = (imageUrl || "").trim();
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [triedFallback, setTriedFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setFailed(false);
    setTriedFallback(false);
    setSrc("");
    if (!rawImageUrl) {
      setSrc("");
      setLoading(false);
      return;
    }

    setLoading(true);
    void fetchMallImageBlobUrl(rawImageUrl, adminToken)
      .then((resolved) => {
        if (cancelled) {
          if (resolved.startsWith("blob:")) {
            URL.revokeObjectURL(resolved);
          }
          return;
        }
        objectUrl = resolved;
        setTriedFallback(false);
        setSrc(resolved);
      })
      .catch(() => {
        if (!cancelled) {
          setTriedFallback(true);
          setSrc(rawImageUrl);
          setFailed(false);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      if (objectUrl.startsWith("blob:")) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [rawImageUrl, adminToken]);

  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl border border-dashed border-white/30 bg-white/40 text-sm text-slate-500 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-400 ${className}`}
      >
        {loading ? t("加载中…") : t(emptyText)}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={title}
      className={`rounded-xl ${fit === "contain" ? "object-contain" : "object-cover"} ${className}`}
      loading="lazy"
      onError={() => {
        if (!triedFallback && src.startsWith("blob:")) {
          setTriedFallback(true);
          setSrc(rawImageUrl);
          return;
        }
        setFailed(true);
      }}
    />
  );
}
