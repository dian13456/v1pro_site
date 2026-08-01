import { useEffect, useMemo, useState } from "react";
import { MallProductImage } from "./MallProductImage";
import { fetchMallImageBlobUrl } from "../services/mallService";

interface MallProductGalleryProps {
  imageUrls: string[];
  title: string;
  className?: string;
  adminToken?: string;
}

export function MallProductGallery({
  imageUrls,
  title,
  className = "h-44 w-full",
  adminToken,
}: MallProductGalleryProps) {
  const images = useMemo(
    () => imageUrls.map((item) => item.trim()).filter(Boolean),
    [imageUrls],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState("");

  useEffect(() => {
    setActiveIndex(0);
  }, [images.join("|")]);

  const active = images[Math.min(activeIndex, images.length - 1)];

  useEffect(() => {
    if (!lightboxOpen || !active) {
      setLightboxSrc("");
      return;
    }
    let cancelled = false;
    let objectUrl = "";
    void fetchMallImageBlobUrl(active, adminToken)
      .then((resolved) => {
        if (cancelled) {
          if (resolved.startsWith("blob:")) {
            URL.revokeObjectURL(resolved);
          }
          return;
        }
        objectUrl = resolved;
        setLightboxSrc(resolved);
      })
      .catch(() => {
        if (!cancelled) {
          setLightboxSrc("");
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl.startsWith("blob:")) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [lightboxOpen, active, adminToken]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightboxOpen(false);
      } else if (event.key === "ArrowLeft" && images.length > 1) {
        setActiveIndex((prev) => (prev - 1 + images.length) % images.length);
      } else if (event.key === "ArrowRight" && images.length > 1) {
        setActiveIndex((prev) => (prev + 1) % images.length);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxOpen, images.length]);

  if (images.length === 0) {
    return <MallProductImage title={title} className={className} adminToken={adminToken} />;
  }

  return (
    <>
      <div>
        <button
          type="button"
          className={`block w-full overflow-hidden rounded-xl ${images.length > 0 ? "cursor-zoom-in" : ""}`}
          onClick={() => setLightboxOpen(true)}
          aria-label={`查看 ${title} 大图`}
        >
          <MallProductImage imageUrl={active} title={title} className={className} adminToken={adminToken} />
        </button>
        {images.length > 1 ? (
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {images.map((url, index) => (
              <button
                key={`${url}-${index}`}
                type="button"
                className={`shrink-0 overflow-hidden rounded-lg border-2 transition ${
                  index === activeIndex
                    ? "border-violet-500"
                    : "border-transparent opacity-80 hover:opacity-100"
                }`}
                onClick={() => setActiveIndex(index)}
                aria-label={`查看第 ${index + 1} 张图`}
              >
                <MallProductImage imageUrl={url} title={title} className="h-14 w-14" adminToken={adminToken} />
              </button>
            ))}
          </div>
        ) : null}
        {images.length > 1 ? (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">点击图片可放大，共 {images.length} 张</p>
        ) : (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">点击图片可放大</p>
        )}
      </div>

      {lightboxOpen ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`${title} 图片预览`}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/15 px-3 py-1 text-sm text-white hover:bg-white/25"
            onClick={() => setLightboxOpen(false)}
          >
            关闭
          </button>
          {images.length > 1 ? (
            <>
              <button
                type="button"
                className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/15 px-3 py-2 text-white hover:bg-white/25"
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveIndex((prev) => (prev - 1 + images.length) % images.length);
                }}
              >
                上一张
              </button>
              <button
                type="button"
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/15 px-3 py-2 text-white hover:bg-white/25"
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveIndex((prev) => (prev + 1) % images.length);
                }}
              >
                下一张
              </button>
            </>
          ) : null}
          <div className="max-h-[85vh] max-w-5xl" onClick={(event) => event.stopPropagation()}>
            <img src={lightboxSrc || active} alt={title} className="max-h-[85vh] max-w-full rounded-xl object-contain" />
            {images.length > 1 ? (
              <p className="mt-3 text-center text-sm text-white/80">
                {activeIndex + 1} / {images.length}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
