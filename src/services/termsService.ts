import { TERMS_VERSION } from "../content/termsOfUse";

const TERMS_STORAGE_KEY = "jiadian_hub_terms_accepted";

interface TermsAcceptanceRecord {
  version: string;
  acceptedAt: number;
}

export function hasAcceptedTerms(): boolean {
  try {
    const raw = localStorage.getItem(TERMS_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as TermsAcceptanceRecord;
    return parsed.version === TERMS_VERSION && Number.isFinite(parsed.acceptedAt);
  } catch {
    return false;
  }
}

export function acceptTerms(): void {
  const record: TermsAcceptanceRecord = {
    version: TERMS_VERSION,
    acceptedAt: Date.now(),
  };
  localStorage.setItem(TERMS_STORAGE_KEY, JSON.stringify(record));
}

export function clearTermsAcceptance(): void {
  localStorage.removeItem(TERMS_STORAGE_KEY);
}
