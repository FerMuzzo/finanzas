// Reads the operations table of a monthly statement PDF, from the text and positions that the
// PDF reader gives for each page. Statements differ from bank to bank, so nothing is tied to one
// layout: the header line ("Date", "Débit", "Crédit" or "Montant") gives the column positions,
// each operation starts with a date, labels may continue on the next lines, and the balance lines
// ("Solde précédent", "Nouveau solde") are used to check that every operation was read.

import { parseAmount } from './money';
import { normalizeKey, squash } from './text';
import type { ParsedFile, ParsedRow } from './importers/types';
import type { BankId } from './model';
import { pad } from './dates';

export interface PdfItem {
  str: string;
  x: number; // left, in PDF points
  y: number; // baseline, measured from the bottom of the page (PDF convention)
  w: number;
  h: number; // font size
}

export interface PdfPage {
  items: PdfItem[];
}

interface Token {
  s: string;
  x0: number;
  x1: number;
}

interface Line {
  page: number;
  y: number; // baseline from the top of the document (pages stacked)
  h: number;
  tokens: Token[];
  text: string;
}

export interface PdfBalance {
  date?: string;
  amount: number;
}

export interface ParsedPdf extends ParsedFile {
  opening?: PdfBalance;
  closing?: PdfBalance;
  totals?: { debit: number; credit: number };
  hasColumns: boolean; // a header with Débit and Crédit, or Montant, was found
  ibanDigits?: string; // used only to recognize the account next time (salted hash), never stored
  proposedName: string;
  proposedType: 'checking' | 'savings';
  guessedSigns: number; // operations whose direction was guessed from the label
}

const MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
};

const DATE_RE = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?$/;
const AMOUNT_RE = /^[+\-−]?\d{1,3}(?:[ .  ']\d{3})*,\d{2}(?:\s?(?:€|EUR))?[+-]?$|^[+\-−]?\d+,\d{2}(?:\s?(?:€|EUR))?[+-]?$/;

/** Split text items into words with an estimated position for each (proportional to characters). */
function tokensOf(items: PdfItem[]): Token[] {
  const out: Token[] = [];
  for (const it of items) {
    const s = it.str;
    if (!s.trim()) continue;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    const n = s.length || 1;
    while ((m = re.exec(s))) {
      out.push({ s: m[0], x0: it.x + (it.w * m.index) / n, x1: it.x + (it.w * (m.index + m[0].length)) / n });
    }
  }
  out.sort((a, b) => a.x0 - b.x0);
  // Join the parts of an amount written with a space as thousands separator ("1" "234,56")
  const joined: Token[] = [];
  for (const t of out) {
    const prev = joined[joined.length - 1];
    if (prev && /^[+\-−]?\d{1,3}(?:[ .]\d{3})*$/.test(prev.s) && /^\d{3}(?:[ .]\d{3})*,\d{2}/.test(t.s) && t.x0 - prev.x1 < 6) {
      prev.s = prev.s + ' ' + t.s;
      prev.x1 = t.x1;
    } else if (prev && /^(€|EUR)$/.test(t.s) && AMOUNT_RE.test(prev.s) && t.x0 - prev.x1 < 8) {
      prev.x1 = t.x1; // currency sign right after an amount
    } else {
      joined.push({ ...t });
    }
  }
  return joined;
}

/** Group the text of each page into lines, top to bottom. */
export function linesOf(pages: PdfPage[]): Line[] {
  const lines: Line[] = [];
  let offset = 0;
  pages.forEach((p, pi) => {
    const items = p.items.filter((i) => i.str && i.str.trim());
    const maxY = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
    const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
    const groups: { y: number; h: number; items: PdfItem[] }[] = [];
    for (const it of sorted) {
      const g = groups.find((gr) => Math.abs(gr.y - it.y) <= Math.max(2, 0.35 * Math.min(gr.h, it.h || gr.h)));
      if (g) {
        g.items.push(it);
        g.h = Math.max(g.h, it.h);
      } else groups.push({ y: it.y, h: it.h || 10, items: [it] });
    }
    groups.sort((a, b) => b.y - a.y);
    for (const g of groups) {
      const tokens = tokensOf(g.items);
      if (!tokens.length) continue;
      lines.push({ page: pi + 1, y: offset + (maxY - g.y), h: g.h, tokens, text: tokens.map((t) => t.s).join(' ') });
    }
    offset += maxY + 1000;
  });
  return lines;
}

function isDate(s: string): boolean {
  const m = s.match(DATE_RE);
  if (!m) return false;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  return d >= 1 && d <= 31 && mo >= 1 && mo <= 12;
}

function isAmount(s: string): boolean {
  return AMOUNT_RE.test(s.trim());
}

function fullDate(s: string): string | null {
  const m = s.match(DATE_RE);
  if (!m || !m[3]) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return iso(y, Number(m[2]), Number(m[1]));
}

function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const s = `${y}-${pad(mo)}-${pad(d)}`;
  return new Date(s + 'T00:00:00Z').getUTCDate() === d ? s : null;
}

interface Columns {
  date?: Token;
  value?: Token;
  label?: Token;
  debit?: Token;
  credit?: Token;
  amount?: Token;
  balance?: Token;
}

function headerOf(line: Line): Columns | null {
  const cols: Columns = {};
  for (const t of line.tokens) {
    const k = normalizeKey(t.s).replace(/[^a-z]/g, '');
    if (k === 'date' && !cols.date) cols.date = t;
    else if (k === 'valeur' || k === 'val') cols.value = t;
    else if (/^(nature|libelle|libelles|operation|operations|designation|description|detail)$/.test(k) && !cols.label) cols.label = t;
    else if (k === 'debit' || k === 'debits') cols.debit = t;
    else if (k === 'credit' || k === 'credits') cols.credit = t;
    else if (k === 'montant' || k === 'montants') cols.amount = t;
    else if (k === 'solde') cols.balance = t;
  }
  if (cols.debit && cols.credit) return cols;
  if (cols.date && cols.amount) return cols;
  return null;
}

type Col = 'debit' | 'credit' | 'amount' | 'balance';

function columnOf(t: Token, cols: Columns): Col | null {
  let best: Col | null = null;
  let bestD = Infinity;
  for (const c of ['debit', 'credit', 'amount', 'balance'] as Col[]) {
    const h = cols[c];
    if (!h) continue;
    const d = Math.min(Math.abs(t.x1 - h.x1), Math.abs((t.x0 + t.x1) / 2 - (h.x0 + h.x1) / 2), Math.abs(t.x0 - h.x0));
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function numericLeft(cols: Columns): number {
  return Math.min(...(['debit', 'credit', 'amount', 'balance'] as Col[]).map((c) => cols[c]?.x0 ?? Infinity));
}

function signedText(s: string): number | null {
  const v = parseAmount(s.replace(/−/g, '-'));
  return v;
}

const IN_WORDS = /\b(RECU|RECUS|VERSEMENT|VERST|REMISE|INTERETS?|INT CREDITEURS|REMBOURSEMENT|REMB|AVOIR|CREDIT|DEPOT|PRIME|ABONDEMENT)\b/;

function guessSign(label: string): number {
  const up = normalizeKey(label).toUpperCase();
  if (/INTERETS? DEBITEURS/.test(up)) return -1;
  return IN_WORDS.test(up) ? 1 : -1;
}

function findPeriod(text: string): { start?: string; end?: string } {
  const t = normalizeKey(text);
  const words = t.match(/du (\d{1,2})(?:er)? ([a-z]+) (\d{4}) au (\d{1,2})(?:er)? ([a-z]+) (\d{4})/);
  if (words && MONTHS[words[2]] && MONTHS[words[5]]) {
    return {
      start: iso(Number(words[3]), MONTHS[words[2]], Number(words[1])) ?? undefined,
      end: iso(Number(words[6]), MONTHS[words[5]], Number(words[4])) ?? undefined,
    };
  }
  const nums = t.match(/du (\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}) au (\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/);
  if (nums) return { start: fullDate(nums[1]) ?? undefined, end: fullDate(nums[2]) ?? undefined };
  const stop = t.match(/(?:arrete|releve|situation) (?:au|du) (\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/);
  if (stop) return { end: fullDate(stop[1]) ?? undefined };
  const monthYear = t.match(/(?:releve|extrait)[^\n]{0,40}? (janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre) (\d{4})/);
  if (monthYear) {
    const y = Number(monthYear[2]);
    const mo = MONTHS[monthYear[1]];
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return { start: iso(y, mo, 1) ?? undefined, end: iso(y, mo, last) ?? undefined };
  }
  return {};
}

function detectBank(text: string): { bank: BankId; name: string } {
  const t = normalizeKey(text);
  if (/societe generale/.test(t)) return { bank: 'sg', name: 'Société Générale' };
  if (/hello ?bank/.test(t)) return { bank: 'hellobank', name: 'Hello bank' };
  return { bank: 'other', name: 'Bank statement' };
}

function accountKind(text: string): { name: string; type: 'checking' | 'savings' } {
  const t = normalizeKey(text);
  const named: [RegExp, string][] = [
    [/livret a\b/, 'Livret A'],
    [/\bldds\b|livret de developpement durable/, 'LDDS'],
    [/\blep\b|livret d'epargne populaire/, 'LEP'],
    [/livret jeune/, 'Livret Jeune'],
    [/\bpel\b|plan d'epargne logement/, 'PEL'],
    [/\bcel\b|compte d'epargne logement/, 'CEL'],
    [/livret|compte d'epargne|compte sur livret|epargne/, 'Savings account'],
  ];
  for (const [re, name] of named) if (re.test(t)) return { name, type: 'savings' };
  return { name: 'Account', type: 'checking' };
}

interface Draft {
  date: string; // raw token
  label: string[];
  amount: number | null;
  guessed: boolean;
  page: number;
  y: number;
  h: number;
}

export function parsePdfStatement(pages: PdfPage[]): ParsedPdf {
  const lines = linesOf(pages);
  const allText = lines.map((l) => l.text).join('\n');
  const { bank, name: bankName } = detectBank(allText);
  // The kind of account is named in the statement heading, above the operations table
  const firstHeader = lines.findIndex((l) => headerOf(l));
  const heading = lines.slice(0, firstHeader >= 0 ? Math.min(firstHeader, 30) : 15);
  const kind = accountKind(heading.map((l) => l.text).join('\n'));
  const period = findPeriod(allText);
  const iban = allText.replace(/\s/g, '').match(/FR\d{2}\d{10}[0-9A-Z]{11}\d{2}/)?.[0];
  const ibanDigits = iban ? iban.slice(14, 25) : undefined;

  const out: ParsedPdf = {
    bank,
    bankName,
    rows: [],
    warnings: [],
    errors: [],
    periodStart: period.start,
    periodEnd: period.end,
    hasColumns: false,
    ibanDigits,
    last4: ibanDigits ? ibanDigits.slice(-4) : undefined,
    accountLabel: kind.name,
    proposedName: kind.name,
    proposedType: kind.type,
    guessedSigns: 0,
  };

  let cols: Columns | null = null;
  let current: Draft | null = null;
  let tableEnded = false;
  const drafts: Draft[] = [];

  const flush = () => {
    if (current) drafts.push(current);
    current = null;
  };

  for (const line of lines) {
    const h = headerOf(line);
    if (h) {
      flush();
      cols = h;
      out.hasColumns = true;
      continue;
    }
    const toks = line.tokens;
    const startsWithDate = isDate(toks[0].s);
    // Leading dates (operation date, then value date in some layouts)
    let i = 0;
    while (i < toks.length && i < 2 && isDate(toks[i].s)) i++;
    const rest = toks.slice(i);
    const restText = rest.map((t) => t.s).join(' ');
    const key = normalizeKey(restText);

    // Amount tokens in the amount columns (or the last ones on the line when there is no header)
    const amountToks: { t: Token; col: Col | null }[] = [];
    const nl = cols ? numericLeft(cols) : Infinity;
    for (let k = rest.length - 1; k >= 0; k--) {
      const t = rest[k];
      if (!isAmount(t.s)) {
        if (!cols) break;
        continue;
      }
      if (cols && t.x1 < nl - 40) continue;
      amountToks.unshift({ t, col: cols ? columnOf(t, cols) : null });
    }

    const valueOf = (a: { t: Token; col: Col | null }): number | null => {
      const v = signedText(a.t.s);
      if (v === null) return null;
      if (a.col === 'debit') return -Math.abs(v);
      if (a.col === 'credit') return Math.abs(v);
      return v;
    };

    // Carried forward lines between pages; the first one can be the opening balance
    if (!startsWithDate && /report|intermediaire/.test(key) && /solde|report/.test(key)) {
      flush();
      if (!out.opening && drafts.length === 0 && /solde|report/.test(key)) {
        const a = amountToks.filter((x) => x.col !== 'balance').pop();
        const v = a ? valueOf(a) : null;
        if (v !== null) out.opening = { amount: /debiteur/.test(key) && v > 0 ? -v : v };
      }
      continue;
    }

    // Balance lines
    if (/^(ancien |nouveau |)solde\b|^solde (crediteur|debiteur|precedent|au|final|initial|disponible)/.test(key)) {
      flush();
      const a = [...amountToks].reverse().find((x) => x.col !== 'balance' || !cols) ?? amountToks[amountToks.length - 1];
      const inline = !a ? rest.filter((t) => isAmount(t.s)).pop() : undefined;
      let v = a ? valueOf(a) : inline ? signedText(inline.s) : null;
      if (v !== null) {
        if (/debiteur/.test(key) && v > 0) v = -v;
        const dateTok = [...toks].reverse().find((t) => isDate(t.s.replace(/[:.]$/, '')));
        const date = dateTok ? fullDate(dateTok.s.replace(/[:.]$/, '')) ?? undefined : undefined;
        const isOpening = /ancien|precedent|initial|report/.test(key) || (!/nouveau|final/.test(key) && drafts.length === 0 && !current);
        if (isOpening && !out.opening) out.opening = { date, amount: v };
        else if (!isOpening) {
          out.closing = { date, amount: v };
          tableEnded = true;
        }
      }
      continue;
    }

    // Totals and carried forward lines
    if (/^totaux?\b|^total\b|^(a |)reporter\b|^report\b|^sous total/.test(key) && !startsWithDate) {
      flush();
      if (/^tota/.test(key) && cols) {
        let debit = 0;
        let credit = 0;
        for (const a of amountToks) {
          const v = signedText(a.t.s);
          if (v === null) continue;
          if (a.col === 'debit') debit += Math.abs(v);
          else if (a.col === 'credit') credit += Math.abs(v);
        }
        if (debit || credit) out.totals = { debit: (out.totals?.debit ?? 0) + debit, credit: (out.totals?.credit ?? 0) + credit };
      }
      continue;
    }

    if (startsWithDate && tableEnded && amountToks.length) {
      if (!out.warnings.some((w) => w.startsWith('More operations')))
        out.warnings.push('More operations follow the closing balance, perhaps of another account. Only the first account in this PDF was read.');
      continue;
    }

    if (startsWithDate && !tableEnded && (cols || amountToks.length)) {
      flush();
      const labelToks = rest.filter((t) => !amountToks.some((a) => a.t === t));
      // A value date printed after the label, in its own column
      while (labelToks.length && isDate(labelToks[labelToks.length - 1].s) && cols?.value) {
        const t = labelToks[labelToks.length - 1];
        if (Math.abs(t.x0 - cols.value.x0) < 35 || Math.abs((t.x0 + t.x1) / 2 - (cols.value.x0 + cols.value.x1) / 2) < 35) labelToks.pop();
        else break;
      }
      const useful = amountToks.filter((a) => a.col !== 'balance');
      let amount: number | null = null;
      let guessed = false;
      if (useful.length) {
        amount = valueOf(useful[0]);
        const raw = useful[0].t.s;
        if (!cols?.debit && !/^[+\-−]|[+-]$/.test(raw.trim())) {
          // A single amount column without a sign: guess the direction from the label
          amount = Math.abs(amount ?? 0) * guessSign(labelToks.map((t) => t.s).join(' '));
          guessed = true;
        }
      }
      current = { date: toks[0].s, label: [labelToks.map((t) => t.s).join(' ')], amount, guessed, page: line.page, y: line.y, h: line.h };
      continue;
    }

    // Continuation of the label of the previous operation
    if (current) {
      const c: Draft = current;
      const close = line.page === c.page && line.y - c.y < (c.h || 10) * 2.6 * Math.max(1, c.label.length);
      const inLabel = !cols?.label || toks[0].x0 >= cols.label.x0 - 15;
      if (close && inLabel && !startsWithDate) {
        const labelPart = rest.filter((t) => !amountToks.some((a) => a.t === t)).map((t) => t.s).join(' ');
        if (labelPart) c.label.push(labelPart);
        if (c.amount === null && amountToks.length) {
          const useful = amountToks.filter((a) => a.col !== 'balance');
          if (useful.length) c.amount = valueOf(useful[0]);
        }
        continue;
      }
      flush();
    }
  }
  flush();

  // Years for short dates ("18.12"): taken from the statement period, a December line in a
  // statement ending in January belongs to the previous year
  const fullYears = drafts.map((d) => fullDate(d.date)).filter(Boolean) as string[];
  const end = out.periodEnd ?? out.closing?.date ?? fullYears.sort().pop();
  const endYear = end ? Number(end.slice(0, 4)) : new Date().getFullYear();
  const endMonth = end ? Number(end.slice(5, 7)) : 12;

  let line = 0;
  for (const d of drafts) {
    line++;
    let date = fullDate(d.date);
    if (!date) {
      const m = d.date.match(DATE_RE)!;
      const mo = Number(m[2]);
      date = iso(mo > endMonth ? endYear - 1 : endYear, mo, Number(m[1]));
    }
    const label = squash(d.label[0] ?? '');
    const detail = squash(d.label.join(' '));
    if (!date) {
      out.errors.push(`Page ${d.page}: date not readable ("${d.date}").`);
      continue;
    }
    if (d.amount === null) {
      out.warnings.push(`Page ${d.page}: no amount found for "${label}", line skipped.`);
      continue;
    }
    if (d.guessed) out.guessedSigns++;
    const row: ParsedRow = { date, label, detail, amount: d.amount, currency: 'EUR', line };
    out.rows.push(row);
  }

  if (!out.periodStart && out.rows.length) out.periodStart = out.rows.map((r) => r.date).sort()[0];
  if (!out.periodEnd && out.rows.length) out.periodEnd = out.rows.map((r) => r.date).sort().pop();
  if (out.closing) {
    out.balance = { date: out.closing.date ?? out.periodEnd ?? '', amount: out.closing.amount, currency: 'EUR' };
  }
  if (!out.rows.length && !out.errors.length) {
    out.errors.push(
      out.hasColumns
        ? 'The operations table was found but no operation could be read.'
        : 'No operations table was found in this PDF. If it is a scanned image, its text cannot be read.',
    );
  }
  return out;
}

export interface PdfCheck {
  status: 'ok' | 'mismatch' | 'unknown';
  expected?: number; // closing minus opening
  found: number; // sum of the operations read
  message: string;
}

/** Compare the operations read with the balances and totals printed on the statement. */
export function checkStatement(p: ParsedPdf, amounts: number[] = p.rows.map((r) => r.amount)): PdfCheck {
  const found = amounts.reduce((s, a) => s + a, 0);
  if (p.opening && p.closing) {
    const expected = p.closing.amount - p.opening.amount;
    return expected === found
      ? { status: 'ok', expected, found, message: 'Opening balance plus the operations read gives the closing balance.' }
      : { status: 'mismatch', expected, found, message: 'The operations read do not add up to the change in balance.' };
  }
  if (p.totals) {
    const debit = -amounts.filter((a) => a < 0).reduce((s, a) => s + a, 0);
    const credit = amounts.filter((a) => a > 0).reduce((s, a) => s + a, 0);
    const expected = p.totals.credit - p.totals.debit;
    return debit === p.totals.debit && credit === p.totals.credit
      ? { status: 'ok', expected, found, message: 'The operations read match the totals printed on the statement.' }
      : { status: 'mismatch', expected, found, message: 'The operations read do not match the totals printed on the statement.' };
  }
  return { status: 'unknown', found, message: 'The statement gives no opening balance or totals to check against.' };
}
