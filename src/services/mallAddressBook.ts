import { getAuthState } from "./authService";
import {
  MALL_MAX_SAVED_ADDRESSES,
  type MallSavedAddress,
  type MallShippingInput,
} from "../types/mall";

const STORAGE_PREFIX = "jiadian_mall_addresses_v1";

function storageKey(): string {
  const serial = getAuthState()?.serial?.trim();
  return serial ? `${STORAGE_PREFIX}_${serial}` : STORAGE_PREFIX;
}

function normalizePart(value: string | undefined): string {
  return (value || "").trim();
}

function addressFingerprint(input: MallShippingInput): string {
  return [
    normalizePart(input.name),
    normalizePart(input.phone),
    normalizePart(input.qq),
    normalizePart(input.province),
    normalizePart(input.city),
    normalizePart(input.address),
  ].join("|");
}

function createId(): string {
  return `addr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function loadMallAddresses(): MallSavedAddress[] {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MallSavedAddress[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string")
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, MALL_MAX_SAVED_ADDRESSES);
  } catch {
    return [];
  }
}

function persistMallAddresses(addresses: MallSavedAddress[]): void {
  localStorage.setItem(storageKey(), JSON.stringify(addresses.slice(0, MALL_MAX_SAVED_ADDRESSES)));
}

export function saveMallAddress(
  input: MallShippingInput,
  existingId?: string,
): { address: MallSavedAddress; addresses: MallSavedAddress[] } {
  const now = Date.now();
  const fingerprint = addressFingerprint(input);
  const current = loadMallAddresses();
  const duplicateIndex = current.findIndex((item) => addressFingerprint(item) === fingerprint);

  if (existingId) {
    const index = current.findIndex((item) => item.id === existingId);
    if (index >= 0) {
      const updated: MallSavedAddress = {
        ...current[index],
        ...input,
        id: existingId,
        updatedAt: now,
      };
      const next = [...current];
      next[index] = updated;
      next.sort((a, b) => b.updatedAt - a.updatedAt);
      persistMallAddresses(next);
      return { address: updated, addresses: next };
    }
  }

  if (duplicateIndex >= 0) {
    const updated: MallSavedAddress = {
      ...current[duplicateIndex],
      ...input,
      updatedAt: now,
    };
    const next = [...current];
    next[duplicateIndex] = updated;
    next.sort((a, b) => b.updatedAt - a.updatedAt);
    persistMallAddresses(next);
    return { address: updated, addresses: next };
  }

  if (current.length >= MALL_MAX_SAVED_ADDRESSES) {
    throw new Error(`最多保存 ${MALL_MAX_SAVED_ADDRESSES} 条地址，请先删除一条再保存`);
  }

  const created: MallSavedAddress = {
    id: createId(),
    name: normalizePart(input.name),
    phone: normalizePart(input.phone),
    wechat: normalizePart(input.wechat),
    qq: normalizePart(input.qq),
    province: normalizePart(input.province),
    city: normalizePart(input.city),
    address: normalizePart(input.address),
    updatedAt: now,
  };
  const next = [created, ...current].slice(0, MALL_MAX_SAVED_ADDRESSES);
  persistMallAddresses(next);
  return { address: created, addresses: next };
}

export function deleteMallAddress(id: string): MallSavedAddress[] {
  const next = loadMallAddresses().filter((item) => item.id !== id);
  persistMallAddresses(next);
  return next;
}

export function toShippingInput(address: MallSavedAddress): MallShippingInput {
  return {
    name: address.name,
    phone: address.phone,
    wechat: address.wechat,
    qq: address.qq,
    province: address.province,
    city: address.city,
    address: address.address,
  };
}
