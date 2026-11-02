// Société Générale CSV export.
// Layout: a summary line (account number, period start, period end, number of operations,
// balance date, balance), then the header "Date de l'opération; Libellé; Détail de l'écriture;
// Montant de l'opération; Devise", then one line per operation. Files opened and saved in a
// spreadsheet may gain empty leading cells or lose the leading zero of the account number,
// so cells are located by content rather than by fixed position.

import { parseFrDate } from '../dates';
import { parseAmount } from '../money';
import { normalizeKey } from '../text';
import type { Importer, ParsedFile, ParsedRow } from './types';

const HEADER_KEYS = ["date de l'operation", 'libelle', "detail de l'ecriture", "montant de l'operation"];

function findHeader(table: string[][]): number {
  return table.findIndex((row) => {
    const keys = row.map((c) => normalizeKey(c));
    return keys.includes(HEADER_KEYS[2]) && keys.includes(HEADER_KEYS[3]);
  });
}

export const sgImporter: Importer = {
  id: 'sg',
  name: 'Société Générale',

  detect(table) {
    return findHeader(table) >= 0;
  },

  parse(table) {
    const out: ParsedFile = { bank: 'sg', bankName: 'Société Générale', rows: [], warnings: [], errors: [] };
    const headerIdx = findHeader(table);
    if (headerIdx < 0) {
      out.errors.push('Société Générale header line not found.');
      return out;
    }

    // Summary line: the last non empty line before the header that contains dates.
    for (let i = headerIdx - 1; i >= 0; i--) {
      const cells = table[i].filter((c) => c !== '');
      if (cells.length < 3) continue;
      const dates: string[] = [];
      for (const c of cells) {
        const compact = c.replace(/\s/g, '');
        const d = parseFrDate(c);
        if (d) dates.push(d);
        else if (/^\d{8,}$/.test(compact) && !out.accountDigits) out.accountDigits = compact.replace(/^0+/, '');
        else if (/^\d{1,6}$/.test(compact) && out.announcedCount === undefined) out.announcedCount = Number(compact);
        else if (/\d/.test(c) && /[A-Z]{3}\s*$/.test(c)) {
          const amount = parseAmount(c);
          const cur = c.match(/([A-Z]{3})\s*$/)?.[1] ?? 'EUR';
          if (amount !== null) out.balance = { date: '', amount, currency: cur };
        }
      }
      if (dates.length) {
        out.periodStart = dates[0];
        out.periodEnd = dates[1] ?? dates[0];
        if (out.balance) out.balance.date = dates[2] ?? dates[1] ?? dates[0];
      }
      if (out.accountDigits) out.last4 = out.accountDigits.slice(-4);
      break;
    }

    for (let i = headerIdx + 1; i < table.length; i++) {
      const row = table[i];
      const di = row.findIndex((c) => parseFrDate(c) !== null);
      if (di < 0) {
        if (row.some((c) => c !== '')) out.warnings.push(`Line ${i + 1} skipped: no date found.`);
        continue;
      }
      const date = parseFrDate(row[di])!;
      const label = row[di + 1] ?? '';
      const detail = row[di + 2] ?? '';
      const amount = parseAmount(row[di + 3]);
      const currency = (row[di + 4] || 'EUR').toUpperCase();
      if (amount === null) {
        out.errors.push(`Line ${i + 1}: amount not readable ("${row[di + 3] ?? ''}").`);
        continue;
      }
      const parsed: ParsedRow = { date, label, detail, amount, currency, line: i + 1 };
      out.rows.push(parsed);
    }

    if (out.announcedCount !== undefined && out.announcedCount !== out.rows.length) {
      out.warnings.push(
        `The bank announces ${out.announcedCount} operations but ${out.rows.length} were read. Some lines may be missing.`,
      );
    }
    return out;
  },
};
