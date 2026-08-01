import { useEffect, useRef, useState } from "react";
import { MallProductImage } from "./MallProductImage";
import { SiteButton } from "./SiteUi";
import { uploadPromoImage } from "../services/promoService";

interface PromoImageUploadProps {
  label: string;
  imageUrl: string;
  onChange: (url: string) => void;
  disabled?: boolean;
}

export function PromoImageUpload({ label, imageUrl, onChange, disabled }: PromoImageUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [previewUrl, setPreviewUrl] = useState(imageUrl);

  useEffect(() => {
    setPreviewUrl(imageUrl);
  }, [imageUrl]);

  const handleFile = async (file: File | null) => {
    if (!file || disabled || uploading) return;
    setUploading(true);
    setErrorMessage("");
    try {
      const url = await uploadPromoImage(file);
      onChange(url);
      setPreviewUrl(url);
    } catch (err) {
      setErrorMessage((err as Error)?.message || "上传失败");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</p>
      {previewUrl ? (
        <div className="max-w-xs">
          <MallProductImage imageUrl={previewUrl} title={label} className="h-40 w-full" />
        </div>
      ) : (
        <div className="flex h-40 max-w-xs items-center justify-center rounded-xl border border-dashed border-white/30 bg-white/40 text-sm text-slate-500 dark:border-white/10 dark:bg-slate-950/40">
          尚未上传
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        disabled={disabled || uploading}
        onChange={(e) => void handleFile(e.target.files?.[0] || null)}
      />
      <div className="flex flex-wrap gap-2">
        <SiteButton
          type="button"
          variant="secondary"
          disabled={disabled || uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? "上传中…" : previewUrl ? "重新上传" : "上传图片"}
        </SiteButton>
        {previewUrl ? (
          <SiteButton
            type="button"
            variant="secondary"
            disabled={disabled || uploading}
            onClick={() => {
              onChange("");
              setPreviewUrl("");
            }}
          >
            清除
          </SiteButton>
        ) : null}
      </div>
      {errorMessage ? <p className="text-sm text-rose-600 dark:text-rose-300">{errorMessage}</p> : null}
    </div>
  );
}
