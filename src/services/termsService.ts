import { TERMS_VERSION } from "../content/termsOfUse";

const TERMS_STORAGE_KEY = "jiadian_hub_terms_accepted";

interface TermsAcceptanceRecord {
  version: string;
  acceptedAt: number;
}

function serialTermsKey(serial: string): string {
  return `${TERMS_STORAGE_KEY}_${serial}`;
}

function readTermsRecord(key: string): TermsAcceptanceRecord | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TermsAcceptanceRecord;
    if (parsed.version !== TERMS_VERSION || !Number.isFinite(parsed.acceptedAt)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function hasAcceptedTerms(serial?: string): boolean {
  if (readTermsRecord(TERMS_STORAGE_KEY)) {
    return true;
  }
  const normalizedSerial = serial?.trim();
  if (normalizedSerial && readTermsRecord(serialTermsKey(normalizedSerial))) {
    return true;
  }
  return false;
}

export function acceptTerms(serial?: string): void {
  const record: TermsAcceptanceRecord = {
    version: TERMS_VERSION,
    acceptedAt: Date.now(),
  };
  localStorage.setItem(TERMS_STORAGE_KEY, JSON.stringify(record));
  const normalizedSerial = serial?.trim();
  if (normalizedSerial) {
    localStorage.setItem(serialTermsKey(normalizedSerial), JSON.stringify(record));
  }
}

export function clearTermsAcceptance(): void {
  localStorage.removeItem(TERMS_STORAGE_KEY);
}
