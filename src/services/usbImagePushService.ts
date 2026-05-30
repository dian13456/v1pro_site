import { DESKTOP_IMAGE_TRANSFER } from "../config/desktopTransfer";
import { createImageUrl } from "./imageService";
import { fetchImageToRgb565, prepareRgb565Payload, swapRgb565Bytes } from "./imageRgb565";
import { getAuthState, hasValidLocalAuth, verifyTokenRemote } from "./authService";
import { prepareUsbSession, pushStaticImagePayload, resolveAuthorizedDevice } from "./usbDeviceSession";

export interface PushImageProgress {
  phase: "prepare" | "convert" | "transfer" | "done";
  sent: number;
  total: number;
}

export async function pushResourceImageToDevice(
  resourceId: number,
  fallbackImageUrl: string | undefined,
  onProgress?: (progress: PushImageProgress) => void
): Promise<void> {
  if (!hasValidLocalAuth()) {
    throw new Error("认证状态无效，请重新验证设备");
  }

  const valid = await verifyTokenRemote();
  if (!valid) {
    throw new Error("认证已失效，请重新验证设备");
  }

  onProgress?.({ phase: "prepare", sent: 0, total: 0 });
  const signedUrl = await createImageUrl(resourceId, fallbackImageUrl);

  onProgress?.({ phase: "convert", sent: 0, total: 0 });
  let raw = await fetchImageToRgb565(signedUrl, {
    width: DESKTOP_IMAGE_TRANSFER.width,
    height: DESKTOP_IMAGE_TRANSFER.height,
    fitMode: DESKTOP_IMAGE_TRANSFER.fitMode,
    rotateDeg: DESKTOP_IMAGE_TRANSFER.rotateDeg,
  });
  if (DESKTOP_IMAGE_TRANSFER.swapRgb565) {
    raw = swapRgb565Bytes(raw);
  }
  const { payload, useRle } = prepareRgb565Payload(raw);

  const device = await resolveAuthorizedDevice();
  const session = await prepareUsbSession(device);

  onProgress?.({ phase: "transfer", sent: 0, total: payload.length });
  await pushStaticImagePayload(session, payload, useRle, {
    chunkSize: DESKTOP_IMAGE_TRANSFER.chunkSize,
    writeRetries: DESKTOP_IMAGE_TRANSFER.writeRetries,
    ackEach: DESKTOP_IMAGE_TRANSFER.ackEachWhenInAvailable,
    onProgress: (sent, total) => {
      onProgress?.({ phase: "transfer", sent, total });
    },
  });

  const auth = getAuthState();
  if (auth) {
    localStorage.setItem(
      "jiadian_hub_auth",
      JSON.stringify({
        ...auth,
        verifiedAt: Date.now(),
      })
    );
  }

  onProgress?.({ phase: "done", sent: payload.length, total: payload.length });
}
