// Data model. Everything lives inside one encrypted vault document.

export type OpType =
  | 'card'
  | 'card_fee'
  | 'cash_withdrawal'
  | 'transfer_in'
  | 'transfer_out'
  | 'standing_order'
  | 'instant_transfer_out'
  | 'direct_debit'
  | 'cheque'
  | 'bank_fee'
  | 'card_refund'
  | 'interest'
  | 'manual'
  | 'other';

export const OP_LABELS: Record<OpType, string> = {
  card: 'Card payment',
  card_fee: 'Card fee abroad',
  cash_withdrawal: 'Cash withdrawal',
  transfer_in: 'Transfer received',
  transfer_out: 'Transfer sent',
  standing_order: 'Standing order',
  instant_transfer_out: 'Instant transfer sent',
  direct_debit: 'Direct debit',
  cheque: 'Cheque',
  bank_fee: 'Bank fee',
  card_refund: 'Card refund',
  interest: 'Interest',
  manual: 'Added by hand',
  other: 'Other',
};

export type CatSource = 'user' | 'rule' | 'memory' | 'starter' | 'bank' | 'auto';

export interface ForeignInfo {
  amount: number; // cents in the foreign currency
  currency: string;
  country?: string;
  rate?: number;
}

export interface Transaction {
  id: string;
  accountId: string;
  date: string; // booking date, ISO
  opDate?: string; // purchase date for card lines, ISO
  label: string; // short bank label
  detail: string; // full bank detail
  amount: number; // cents, negative for money out
  currency: string;
  opType: OpType;
  counterparty: string; // display name of merchant, payer or payee
  merchantKey: string; // normalized key used for grouping
  online?: boolean;
  foreign?: ForeignInfo;
  creditorId?: string;
  motif?: string;
  channel?: string;
  categoryId: string | null;
  catSource?: CatSource; // how the category was chosen
  bankCategory?: string; // category given by the bank (Hello bank exports have one)
  place?: string;
  recurringId?: string; // confirmed regular payment this operation belongs to
  note?: string;
  tags: string[];
  source: 'import' | 'manual' | 'voice' | 'demo';
  importId?: string;
  fp: string; // duplicate fingerprint
  transferId?: string | null; // set when linked to the other side of an internal transfer
  notTransfer?: boolean; // you said this is not a transfer between your accounts
  ownTransferHint?: boolean; // counterparty matches one of your names
  mergedFromManual?: boolean; // added by hand first, then confirmed by the bank file
  mirrorOf?: string; // recorded by hand as the other side of this operation (another of your accounts)
  createdAt: string;
}

export type BankId = 'sg' | 'hellobank' | 'other' | 'cash';

export const BANK_NAMES: Record<BankId, string> = {
  sg: 'Société Générale',
  hellobank: 'Hello bank',
  other: 'Other bank',
  cash: 'Cash',
};

export interface Account {
  id: string;
  name: string;
  bank: BankId;
  type: 'checking' | 'savings' | 'card' | 'cash';
  currency: string;
  last4?: string;
  idHash?: string; // salted hash of the full account number, never the number itself
  color?: number; // palette slot 1 to 8, used to color code operations
  interestRate?: number; // yearly percent, for savings accounts
  interestPaid?: 'yearly' | 'monthly';
  interestTax?: number; // percent taken from interest (0 for Livret A, LDDS, LEP)
  pdfKey?: string; // salted hash of the account number printed on PDF statements, to recognize them
  createdAt: string;
}

export const ACCOUNT_COLORS = 8;

/** First palette slot not used by another account. */
export function nextAccountColor(accounts: Account[]): number {
  const used = new Set(accounts.map((a) => a.color));
  for (let i = 1; i <= ACCOUNT_COLORS; i++) if (!used.has(i)) return i;
  return (accounts.length % ACCOUNT_COLORS) + 1;
}

export interface ImportBatch {
  id: string;
  accountId: string;
  bank: BankId;
  fileHash: string;
  fileName?: string;
  periodStart?: string;
  periodEnd?: string;
  rowsRead: number;
  announcedCount?: number;
  newCount: number;
  duplicateCount: number;
  importedAt: string;
}

export interface BalanceSnapshot {
  accountId: string;
  date: string;
  amount: number;
  source: 'import' | 'manual';
  setAt?: string; // when a balance was set by hand
}

export type CategoryKind = 'expense' | 'income' | 'transfer' | 'savings';

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  essential?: boolean;
}

export interface Settings {
  holderNames: string[]; // your own names, to recognize transfers to yourself
  autoLockMinutes: number;
  lastBackupAt?: string;
  lastManualAccountId?: string;
  lastPdfAccountId?: string;
}

export interface Rule {
  id: string;
  pattern: string; // words to find in the merchant name or bank text
  categoryId: string;
  createdAt: string;
}

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'bimonthly' | 'quarterly' | 'semiannual' | 'yearly';

export const CADENCE_DAYS: Record<Cadence, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30.44,
  bimonthly: 60.9,
  quarterly: 91.3,
  semiannual: 182.6,
  yearly: 365.25,
};

export const CADENCE_LABELS: Record<Cadence, string> = {
  weekly: 'Every week',
  biweekly: 'Every two weeks',
  monthly: 'Every month',
  bimonthly: 'Every two months',
  quarterly: 'Every three months',
  semiannual: 'Twice a year',
  yearly: 'Every year',
};

export interface RecurringSeries {
  id: string;
  key: string; // merchantKey plus direction
  name: string;
  status: 'confirmed' | 'dismissed';
  cadence: Cadence;
  amount: number; // typical amount, signed cents
  minAmount: number;
  maxAmount: number;
  categoryId: string | null;
  createdAt: string;
}

export interface AuditEntry {
  at: string;
  action: string;
  detail?: string;
}

export interface VaultData {
  version: 1;
  salt: string; // random, used to hash account numbers
  accounts: Account[];
  transactions: Transaction[];
  imports: ImportBatch[];
  balances: BalanceSnapshot[];
  categories: Category[];
  rules: Rule[];
  merchantMemory: Record<string, string>; // merchantKey to categoryId, learned from your choices
  recurring: RecurringSeries[];
  settings: Settings;
  audit: AuditEntry[];
}

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'housing', name: 'Housing', kind: 'expense', essential: true },
  { id: 'utilities', name: 'Utilities and telecom', kind: 'expense', essential: true },
  { id: 'groceries', name: 'Groceries', kind: 'expense', essential: true },
  { id: 'eating_out', name: 'Restaurants and bars', kind: 'expense' },
  { id: 'transport', name: 'Transport', kind: 'expense', essential: true },
  { id: 'health', name: 'Health', kind: 'expense', essential: true },
  { id: 'insurance', name: 'Insurance', kind: 'expense', essential: true },
  { id: 'subscriptions', name: 'Subscriptions', kind: 'expense' },
  { id: 'shopping', name: 'Shopping', kind: 'expense' },
  { id: 'personal_care', name: 'Personal care', kind: 'expense' },
  { id: 'leisure', name: 'Leisure and culture', kind: 'expense' },
  { id: 'travel', name: 'Travel', kind: 'expense' },
  { id: 'gifts', name: 'Gifts and donations', kind: 'expense' },
  { id: 'education', name: 'Education and professional', kind: 'expense' },
  { id: 'taxes', name: 'Taxes and social contributions', kind: 'expense', essential: true },
  { id: 'bank_fees', name: 'Bank fees', kind: 'expense' },
  { id: 'cash', name: 'Cash withdrawals', kind: 'expense' },
  { id: 'other_expense', name: 'Other expenses', kind: 'expense' },
  { id: 'salary', name: 'Salary', kind: 'income' },
  { id: 'freelance', name: 'Freelance income', kind: 'income' },
  { id: 'refunds', name: 'Refunds and reimbursements', kind: 'income' },
  { id: 'interest', name: 'Interest', kind: 'income' },
  { id: 'other_income', name: 'Other income', kind: 'income' },
  { id: 'savings', name: 'Savings and investments', kind: 'savings' },
  { id: 'own_transfer', name: 'Transfer between my accounts', kind: 'transfer' },
];

export function emptyVault(): VaultData {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return {
    version: 1,
    salt: Array.from(salt, (b) => b.toString(16).padStart(2, '0')).join(''),
    accounts: [],
    transactions: [],
    imports: [],
    balances: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    rules: [],
    merchantMemory: {},
    recurring: [],
    settings: { holderNames: [], autoLockMinutes: 5 },
    audit: [],
  };
}

/** Bring data saved by an older version of the app up to date. */
export function migrateVault(v: VaultData): VaultData {
  v.rules ??= [];
  v.merchantMemory ??= {};
  v.recurring ??= [];
  for (const a of v.accounts) if (!a.color) a.color = nextAccountColor(v.accounts);
  for (const def of DEFAULT_CATEGORIES) {
    const existing = v.categories.find((c) => c.id === def.id);
    if (!existing) v.categories.push({ ...def });
    else if (def.id === 'eating_out' && existing.name === 'Eating out') existing.name = def.name;
  }
  return v;
}
