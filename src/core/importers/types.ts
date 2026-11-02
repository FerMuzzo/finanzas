import type { BankId } from '../model';

export interface ParsedRow {
  date: string; // ISO booking date
  label: string;
  detail: string;
  amount: number; // cents
  currency: string;
  line: number; // line number in the file, for error messages
  bankCategory?: string; // category given by the bank, when the export has one
  bankSubCategory?: string;
  comment?: string;
}

export interface ParsedFile {
  bank: BankId;
  bankName: string;
  accountDigits?: string; // full account number digits, used only to compute a salted hash, never stored
  last4?: string;
  accountLabel?: string; // for example "Compte de chèques"
  periodStart?: string;
  periodEnd?: string;
  announcedCount?: number;
  balance?: { date: string; amount: number; currency: string };
  rows: ParsedRow[];
  warnings: string[];
  errors: string[];
}

export interface Importer {
  id: BankId;
  name: string;
  detect(table: string[][]): boolean;
  parse(table: string[][]): ParsedFile;
}
