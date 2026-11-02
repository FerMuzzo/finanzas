// Detection of regular payments and income: same merchant, regular interval, stable amount.

import { daysBetween } from './dates';
import { CADENCE_DAYS, type Cadence, type OpType, type RecurringSeries, type Transaction, type VaultData } from './model';
import { uid } from './text';

export interface RecurringCandidate {
  key: string;
  name: string;
  cadence: Cadence;
  typical: number; // signed cents
  min: number;
  max: number;
  fixed: boolean;
  count: number;
  firstDate: string;
  lastDate: string;
  nextDate: string;
  dayOfMonth?: number;
  opType: OpType;
  categoryId: string | null;
  monthly: number; // signed cents per month
  txIds: string[];
}

const CADENCES: [Cadence, number, number][] = [
  ['weekly', 5, 9],
  ['biweekly', 12, 17],
  ['monthly', 25, 36],
  ['bimonthly', 54, 68],
  ['quarterly', 82, 100],
  ['semiannual', 170, 195],
  ['yearly', 340, 390],
];

const SKIP_KEYS = new Set(['RETRAIT DAB', 'CHEQUE', 'FROM UNKNOWN', 'TO UNKNOWN', 'FRAIS PAIEMENT HORS ZONE EURO', '']);
const DEBIT_TYPES = new Set<OpType>(['direct_debit', 'standing_order', 'transfer_out', 'instant_transfer_out']);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function seriesKey(t: Transaction): string {
  return (t.amount < 0 ? 'OUT ' : 'IN ') + t.merchantKey;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

function nextMonthly(last: string, day: number): string {
  const d = new Date(last + 'T00:00:00Z');
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const daysIn = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, daysIn))).toISOString().slice(0, 10);
}

/** Group operations that could form a series, excluding transfers between your own accounts. */
function groups(data: VaultData): Map<string, Transaction[]> {
  const map = new Map<string, Transaction[]>();
  for (const t of data.transactions) {
    if (t.transferId || t.categoryId === 'own_transfer' || SKIP_KEYS.has(t.merchantKey)) continue;
    if (t.opType === 'card_refund' || t.opType === 'cash_withdrawal') continue;
    const k = seriesKey(t);
    const arr = map.get(k);
    if (arr) arr.push(t);
    else map.set(k, [t]);
  }
  return map;
}

export function analyzeGroup(txs: Transaction[], dataEnd: string): RecurringCandidate | null {
  if (txs.length < 2) return null;
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date));
  const dates = sorted.map((t) => t.opDate ?? t.date);
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i++) intervals.push(daysBetween(dates[i], dates[i - 1]));
  if (intervals.some((d) => d === 0)) return null; // several on the same day: a shop, not a subscription
  const med = median(intervals);
  const cad = CADENCES.find(([, lo, hi]) => med >= lo && med <= hi);
  if (!cad) return null;
  const [cadence, lo, hi] = cad;
  const regular = intervals.filter((d) => d >= lo - 2 && d <= hi + 2).length / intervals.length;
  if (regular < 0.75) return null;

  const t0 = sorted[sorted.length - 1];
  const isIn = t0.amount > 0;
  const abs = sorted.map((t) => Math.abs(t.amount));
  const typical = median(abs);
  const spread = Math.max(...abs.map((a) => Math.abs(a - typical))) / typical;
  const isDebit = DEBIT_TYPES.has(t0.opType);

  // Minimum evidence depends on how the money moves
  const minCount = cadence === 'weekly' || cadence === 'biweekly' ? 4 : isDebit || isIn ? 2 : 3;
  if (sorted.length < minCount) return null;
  if (cadence === 'monthly' && sorted.length === 2 && !isDebit && !isIn) return null;
  if (isIn || isDebit) {
    if (spread > (isIn ? 0.3 : 0.6)) return null;
  } else {
    // Card payments: the same price most of the time (a single price increase is allowed)
    const same = abs.filter((a) => Math.abs(a - typical) / typical <= 0.05).length / abs.length;
    if (same < 0.75) return null;
  }

  // Still active: the last one is recent compared with the end of the imported data
  const days = CADENCE_DAYS[cadence];
  const last = dates[dates.length - 1];
  if (daysBetween(last, dataEnd) > days * 1.6 + 5) return null;

  const dayOfMonth = cadence === 'monthly' ? Math.round(median(dates.map((d) => Number(d.slice(8, 10))))) : undefined;
  const nextDate = dayOfMonth ? nextMonthly(last, dayOfMonth) : addDays(last, days);
  const sign = isIn ? 1 : -1;
  return {
    key: seriesKey(t0),
    name: t0.counterparty,
    cadence,
    typical: sign * Math.round(typical),
    min: sign * Math.min(...abs),
    max: sign * Math.max(...abs),
    fixed: spread <= 0.03,
    count: sorted.length,
    firstDate: dates[0],
    lastDate: last,
    nextDate,
    dayOfMonth,
    opType: t0.opType,
    categoryId: t0.categoryId,
    monthly: Math.round((sign * typical * 30.44) / days),
    txIds: sorted.map((t) => t.id),
  };
}

export function dataEndDate(data: VaultData): string {
  let end = '';
  for (const t of data.transactions) if (t.date > end) end = t.date;
  return end;
}

/** All series found in the data, whether already confirmed, dismissed or new. */
export function detectAll(data: VaultData): RecurringCandidate[] {
  const end = dataEndDate(data);
  const out: RecurringCandidate[] = [];
  for (const txs of groups(data).values()) {
    const c = analyzeGroup(txs, end);
    if (c) out.push(c);
  }
  return out.sort((a, b) => Math.abs(b.monthly) - Math.abs(a.monthly));
}

/** New suggestions: series you have not confirmed or dismissed yet. */
export function suggestions(data: VaultData): RecurringCandidate[] {
  const known = new Set(data.recurring.map((r) => r.key));
  return detectAll(data).filter((c) => !known.has(c.key));
}

export function confirmSeries(data: VaultData, c: RecurringCandidate): RecurringSeries {
  const s: RecurringSeries = {
    id: uid(),
    key: c.key,
    name: c.name,
    status: 'confirmed',
    cadence: c.cadence,
    amount: c.typical,
    minAmount: c.min,
    maxAmount: c.max,
    categoryId: c.categoryId,
    createdAt: new Date().toISOString(),
  };
  data.recurring.push(s);
  linkSeries(data);
  return s;
}

export function dismissSeries(data: VaultData, c: RecurringCandidate): void {
  data.recurring.push({
    id: uid(), key: c.key, name: c.name, status: 'dismissed', cadence: c.cadence, amount: c.typical,
    minAmount: c.min, maxAmount: c.max, categoryId: c.categoryId, createdAt: new Date().toISOString(),
  });
}

export function forgetSeries(data: VaultData, id: string): void {
  data.recurring = data.recurring.filter((r) => r.id !== id);
  for (const t of data.transactions) if (t.recurringId === id) t.recurringId = undefined;
}

/** Attach operations to the confirmed series they belong to (also new imports). */
export function linkSeries(data: VaultData): void {
  const byKey = new Map(data.recurring.filter((r) => r.status === 'confirmed').map((r) => [r.key, r]));
  for (const t of data.transactions) {
    const s = t.transferId ? undefined : byKey.get(seriesKey(t));
    t.recurringId = s ? s.id : undefined;
  }
}

export interface SeriesStatus {
  series: RecurringSeries;
  lastDate?: string;
  lastAmount?: number;
  nextDate?: string;
  count: number;
  monthly: number;
  priceChange?: { from: number; to: number };
  late: boolean;
}

/** Current state of each confirmed series: last payment, next expected, price change, missing. */
export function seriesStatuses(data: VaultData): SeriesStatus[] {
  const end = dataEndDate(data);
  const out: SeriesStatus[] = [];
  for (const s of data.recurring.filter((r) => r.status === 'confirmed')) {
    const txs = data.transactions.filter((t) => t.recurringId === s.id).sort((a, b) => a.date.localeCompare(b.date));
    const days = CADENCE_DAYS[s.cadence];
    const st: SeriesStatus = { series: s, count: txs.length, monthly: Math.round((s.amount * 30.44) / days), late: false };
    if (txs.length) {
      const last = txs[txs.length - 1];
      st.lastDate = last.opDate ?? last.date;
      st.lastAmount = last.amount;
      const live = analyzeGroup(txs, end);
      st.nextDate = live?.nextDate ?? addDays(st.lastDate, days);
      st.late = daysBetween(st.lastDate, end) > days + 7 && end > st.lastDate;
      if (txs.length >= 3) {
        const prev = median(txs.slice(0, -1).map((t) => Math.abs(t.amount)));
        const now = Math.abs(last.amount);
        const prevFixed = txs.slice(0, -1).every((t) => Math.abs(Math.abs(t.amount) - prev) / prev <= 0.03);
        if (prevFixed && Math.abs(now - prev) / prev > 0.01) st.priceChange = { from: Math.sign(last.amount) * prev, to: last.amount };
      }
      st.monthly = Math.round((median(txs.slice(-3).map((t) => t.amount)) * 30.44) / days);
    }
    out.push(st);
  }
  return out.sort((a, b) => a.monthly - b.monthly);
}
