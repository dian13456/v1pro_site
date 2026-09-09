import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// Exercise the real identity/cache functions in static mode. No USB device is
// opened, claimed, reset or otherwise accessed by this regression test.
const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({
  absWorkingDir: root,
  stdin: {
    contents: 'export * from "./src/services/authService.ts"; export * from "./src/services/deviceHardwareService.ts";',
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  define: { "import.meta.env": "{}" },
});
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
globalThis.window = Object.assign(new EventTarget(), {
  localStorage,
  setTimeout,
  clearTimeout,
  isSecureContext: true,
});
Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const v1 = {
  vendorId: 0x0483, productId: 0x66ab, productName: "佳点V1",
  deviceVersionMajor: 4, deviceVersionMinor: 0, deviceVersionSubminor: 1,
  serialNumber: "V1-TEST-SERIAL",
  open() { throw new Error("Identity detection must not open USB"); },
};
const legacyV1Pro = { ...v1, productName: "佳点V1PRO", serialNumber: "V1PRO-TEST-SERIAL" };
assert.equal(api.identifyUsbHardware(v1), "V1");
for (const changed of [
  { productName: "佳点V1PRO" }, { productName: undefined },
  { productId: 0x66aa }, { vendorId: 0x2e3c },
  { deviceVersionMajor: 1 }, { deviceVersionMinor: 1 },
  { deviceVersionSubminor: 0 }, { deviceVersionMajor: undefined },
]) assert.equal(api.identifyUsbHardware({ ...v1, ...changed }), undefined);

let changes = 0;
window.addEventListener(api.AUTH_CHANGED_EVENT, () => { changes += 1; });
await api.authorizeUsbDevice(v1);
assert.equal(api.getAuthState().hardwareVariant, "V1");
assert.equal(changes, 1);

// Android Chromium/Edge may expose an authorized device with an empty
// USBDevice.serialNumber.  The standard string descriptor must still bind
// authentication to the MCU UID without changing the firmware protocol.
const descriptorSerial = "A1B2C3D4E5F60718293A4B5C";
const descriptorBytes = new Uint8Array(2 + descriptorSerial.length * 2);
descriptorBytes[0] = descriptorBytes.length;
descriptorBytes[1] = 0x03;
for (let index = 0; index < descriptorSerial.length; index += 1) {
  descriptorBytes[2 + index * 2] = descriptorSerial.charCodeAt(index);
}
const mobileEdgeDevice = {
  ...v1,
  serialNumber: "",
  opened: false,
  configuration: null,
  async open() { this.opened = true; },
  async close() { this.opened = false; },
  async selectConfiguration() { this.configuration = { interfaces: [] }; },
  async controlTransferIn(setup, length) {
    assert.deepEqual(setup, { requestType: "standard", recipient: "device", request: 6, value: 0x0303, index: 0x0409 });
    assert.equal(length, 255);
    return { status: "ok", data: new DataView(descriptorBytes.buffer) };
  },
};
await api.authorizeUsbDevice(mobileEdgeDevice);
assert.equal(api.getAuthState().serial, descriptorSerial);
assert.equal(api.matchesAuthenticatedUsbDevice(mobileEdgeDevice, descriptorSerial), true);
assert.equal(api.matchesAuthenticatedUsbDevice({ ...mobileEdgeDevice }, descriptorSerial), false,
  "An unverified USBDevice with the same VID/PID cannot inherit another device's SN");
assert.equal(mobileEdgeDevice.opened, true, "explicit authorization keeps its handle for the caller");
await mobileEdgeDevice.close();

api.rememberAuthenticatedUsbHardware({ ...legacyV1Pro, serialNumber: "OTHER-SERIAL" });
api.rememberAuthenticatedUsbHardware({ ...v1, productId: 0x66aa });
assert.equal(api.getAuthState().hardwareVariant, "V1", "Other devices cannot replace authenticated identity");
assert.equal(changes, 2);

const oldLogin = { ...api.getAuthState() };
delete oldLogin.hardwareVariant;
localStorage.setItem(api.AUTH_STORAGE_KEY, JSON.stringify(oldLogin));
api.rememberAuthenticatedUsbHardware(mobileEdgeDevice);
assert.equal(api.getAuthState().hardwareVariant, "V1", "Existing logins can gain descriptor evidence");
assert.equal(changes, 3);
api.rememberAuthenticatedUsbHardware(mobileEdgeDevice);
assert.equal(changes, 3, "Unchanged identity must not trigger a refresh loop");
api.rememberAuthenticatedUsbHardware({ ...mobileEdgeDevice, serialNumber: descriptorSerial, productName: "佳点V1PRO" });
assert.equal(api.getAuthState().hardwareVariant, undefined, "Conflicting descriptor clears cached identity");

await api.authorizeUsbDevice(v1);
await api.authorizeUsbDevice(legacyV1Pro);
assert.equal(api.getAuthState().hardwareVariant, undefined, "Switching to historical 66AB V1PRO restores normal materials");
const beforeLogout = changes;
api.clearAuthState();
assert.equal(api.getAuthState(), null);
assert.equal(changes, beforeLogout + 1, "Logout notifies mounted material pages");

const reenumerated = { ...mobileEdgeDevice, opened: false };
assert.equal(await api.resolveAuthenticatedUsbDevice([reenumerated], descriptorSerial), reenumerated);
assert.equal(reenumerated.opened, false, "Descriptor-only lookup releases the handle it opened");
assert.equal(api.getCachedUsbSerial(reenumerated), descriptorSerial);
const wrongSn = { ...mobileEdgeDevice, serialNumber: "OTHER-DEVICE" };
assert.equal(await api.resolveAuthenticatedUsbDevice([wrongSn], descriptorSerial), null,
  "A sole device with a different SN must not be selected");
const missingSnOtherDevice = { ...mobileEdgeDevice, opened: false };
assert.equal(await api.resolveAuthenticatedUsbDevice([missingSnOtherDevice], "OTHER-DEVICE"), null);
assert.equal(missingSnOtherDevice.opened, false);
const ownedHandle = { ...mobileEdgeDevice, opened: true };
assert.equal(await api.resolveAuthenticatedUsbDevice([ownedHandle], descriptorSerial), ownedHandle);
assert.equal(ownedHandle.opened, true, "Do not close a handle that another caller already owns");
const malformed = { ...mobileEdgeDevice, opened: false,
  async controlTransferIn() { return { status: "ok", data: new DataView(Uint8Array.of(50, 3, 65, 0).buffer) }; },
};
await assert.rejects(api.resolveAuthenticatedUsbDevice([malformed], descriptorSerial));
assert.equal(malformed.opened, false, "Malformed descriptor failure releases USB");
assert.equal(api.getCachedUsbSerial(malformed), "");
await assert.rejects(api.resolveAuthenticatedUsbDevice(
  [{ ...mobileEdgeDevice }, { ...mobileEdgeDevice }], descriptorSerial), /多台设备/);
console.log("USB identity regression passed: descriptor fallback, per-device binding, re-enumeration, mismatched SN, multiple devices and handle cleanup.");
