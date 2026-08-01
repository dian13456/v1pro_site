import { useEffect, useState } from "react";
import { fetchMallImageBlobUrl } from "../services/mallService";

interface MallProductImageProps {
  imageUrl?: string;
  title: string;
  className?: string;
  adminToken?: string;
}

export function MallProductImage({
  imageUrl,
  title,
  className = "h-40 w-full",
  adminToken,
}: MallProductImageProps) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setFailed(false);
    const raw = (imageUrl || "").trim();
    if (!raw) {
      setSrc("");
      setLoading(false);
      return;
    }

    setLoading(true);
    void fetchMallImageBlobUrl(raw, adminToken)
      .then((resolved) => {
        if (cancelled) {
          if (resolved.startsWith("blob:")) {
            URL.revokeObjectURL(resolved);
          }
          return;
        }
        objectUrl = resolved;
        setSrc(resolved);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setSrc("");
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
  }, [imageUrl, adminToken]);

  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl border border-dashed border-white/30 bg-white/40 text-sm text-slate-500 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-400 ${className}`}
      >
        {loading ? "加载中…" : "暂无商品图"}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={title}
      className={`rounded-xl object-cover ${className}`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
