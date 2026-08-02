export interface CreditLedgerEntry {
  id: string;
  amount: number;
  source: string;
  label: string;
  refId?: string;
  createdAt: string;
}
