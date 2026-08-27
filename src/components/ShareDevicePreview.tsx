import { DevicePreviewFrame } from "./DevicePreviewFrame";

export type SharePreviewMediaKind = "image" | "gif" | "video";
export type SharePreviewColorProfile = "normal" | "vivid" | "professional";

export const SHARE_DEVICE_PREVIEW_FILTER: Record<SharePreviewColorProfile, string> = {
  normal: "saturate(1.08) contrast(1.05) brightness(1.002)",
  vivid: "saturate(1.18) contrast(1.07) brightness(1.003)",
  professional: "saturate(1.04) contrast(1.05) brightness(1.002) sepia(.015)",
};

const COLOR_PROFILE_LABEL: Record<SharePreviewColorProfile, string> = {
  normal: "普通",
  vivid: "鲜艳",
  professional: "专业",
};

interface ShareDevicePreviewProps {
  previewUrl: string;
  mediaKind: SharePreviewMediaKind | null;
  fitMode: "fill" | "contain";
  rotationDeg: 0 | 90 | 180 | 270;
  colorProfile: SharePreviewColorProfile;
  videoFpsLabel: string;
  targetFrameOptions: number[];
}

export function ShareDevicePreview({
  previewUrl,
  mediaKind,
  fitMode,
  rotationDeg,
  colorProfile,
  videoFpsLabel,
  targetFrameOptions,
}: ShareDevicePreviewProps) {
  const sideways = rotationDeg === 90 || rotationDeg === 270;
  const mediaStyle = {
    width: sideways ? "53.125%" : "100%",
    height: sideways ? "188.235%" : "100%",
    objectFit: fitMode === "fill" ? "cover" : "contain",
    transform: `translate(-50%, -50%) rotate(${rotationDeg}deg)`,
    filter: SHARE_DEVICE_PREVIEW_FILTER[colorProfile],
  } as const;
  const capacityLabel = targetFrameOptions.length
    ? [...targetFrameOptions].sort((a, b) => a - b).map((frames) => `${frames}帧`).join(" / ")
    : "未选择容量";

  return (
    <section className="rounded-2xl border border-[#e6e9f2] bg-gradient-to-br from-[#f8f9fd] to-[#eef2fa] p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[12.5px] font-semibold text-[#4a5270]">1.9 英寸设备效果预览</p>
          <p className="mt-1 text-[11px] text-[#8a93a8]">V1PRO 横屏 · 320 × 170 像素</p>
        </div>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10.5px] font-semibold text-emerald-700">
          实时参数预览
        </span>
      </div>

      <DevicePreviewFrame className="mx-auto w-full max-w-[480px] rounded-[2rem] p-3 shadow-[0_18px_38px_rgba(15,23,42,.28),inset_0_0_0_1px_rgba(255,255,255,.1)]">
        <div className="relative h-full w-full overflow-hidden bg-black">
          {previewUrl && mediaKind ? (
            mediaKind === "video" ? (
              <video
                src={previewUrl}
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                aria-label="设备视频效果预览"
                className="absolute left-1/2 top-1/2 max-w-none bg-black"
                style={mediaStyle}
              />
            ) : (
              <img
                src={previewUrl}
                alt="设备素材效果预览"
                className="absolute left-1/2 top-1/2 max-w-none bg-black"
                style={mediaStyle}
              />
            )
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_35%,#26344d,#090d15_72%)] text-center text-white/70">
              <span className="text-3xl" aria-hidden="true">▣</span>
              <span className="mt-2 text-xs font-medium">选择素材后显示屏幕效果</span>
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/15" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/25" />
        </div>
      </DevicePreviewFrame>

      <div className="mt-3 flex flex-wrap justify-center gap-1.5 text-[10.5px] font-medium text-[#66708d]">
        <span className="rounded-full bg-white px-2.5 py-1 shadow-sm">{rotationDeg}°</span>
        <span className="rounded-full bg-white px-2.5 py-1 shadow-sm">{fitMode === "fill" ? "铺满全屏" : "适应屏幕"}</span>
        <span className="rounded-full bg-white px-2.5 py-1 shadow-sm">{COLOR_PROFILE_LABEL[colorProfile]}色彩</span>
        <span className="rounded-full bg-white px-2.5 py-1 shadow-sm">{videoFpsLabel}</span>
        <span className="rounded-full bg-white px-2.5 py-1 shadow-sm">{capacityLabel}</span>
      </div>
      <p className="mt-2 text-center text-[10.5px] leading-5 text-[#8a93a8]">
        预览会模拟旋转、裁切和色彩参数；实际观感会受设备屏幕亮度影响。
      </p>
    </section>
  );
}
