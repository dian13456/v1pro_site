export type TransferFitMode = "fill" | "contain";
export type TransferMediaKind = "image" | "gif" | "video";

/** GIFs preserve their aspect ratio by default; still images and videos fill the panel. */
export function defaultTransferFitMode(kind: TransferMediaKind): TransferFitMode {
  return kind === "gif" ? "contain" : "fill";
}
