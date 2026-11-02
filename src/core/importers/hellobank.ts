// Hello bank CSV export.
// Layout: a summary line ("Compte de chèques ****1234; Solde au 01/01/2026; 1500.00; EUR"),
// then the header "Date operation; Categorie operation; Sous Categorie operation; Libelle operation;
// Montant operation; Pointage operation; Commentaire operation", then one line per operation.
// Dates use dashes (01-01-2026) and amounts may use a dot or a comma as decimal separator.

import { parseFrDate } from '../dates';
import { parseAmount } from '../money';
import { normalizeKey } from '../text';
import type { Importer, ParsedFile, ParsedRow } from './types';

function headerIndex(table: string[][]): number {
  return table.findIndex((row) => {
    const k = row.map((c) => normalizeKey(c));
    return k.includes('date operation') && k.includes('libelle operation') && k.includes('montant operation');
  });
}

export const hellobankImporter: Importer = {
  id: 'hellobank',
  name: 'Hello bank',

  detect(table) {
    return headerIndex(table) >= 0;
  },

  parse(table) {
    const out: ParsedFile = { bank: 'hellobank', bankName: 'Hello bank', rows: [], warnings: [], errors: [] };
    const hi = headerIndex(table);
    if (hi < 0) {
      out.errors.push('Hello bank header line not found.');
      return out;
    }
    const header = table[hi].map((c) => normalizeKey(c));
    const col = (name: string) => header.indexOf(name);
    const iDate = col('date operation');
    const iCat = col('categorie operation');
    const iSub = col('sous categorie operation');
    const iLabel = col('libelle operation');
    const iAmount = col('montant operation');
    const iComment = col('commentaire operation');

    // Summary line before the header
    for (let i = hi - 1; i >= 0; i--) {
      const cells = table[i].filter((c) => c !== '');
      if (!cells.length) continue;
      for (let j = 0; j < cells.length; j++) {
        const c = cells[j];
        const acc = c.match(/\*{2,}\s*(\d{4})/);
        if (acc) {
          out.last4 = acc[1];
          out.accountLabel = c.replace(/\*{2,}\s*\d{4}/, '').trim() || undefined;
        }
        const sol = normalizeKey(c).match(/solde au\s+(\S+)/);
        if (sol) {
          const date = parseFrDate(sol[1]);
          // the balance is the next cell that reads as an amount
          for (let k = j + 1; k < cells.length; k++) {
            const amount = parseAmount(cells[k]);
            if (amount !== null) {
              const cur = cells.slice(k + 1).find((x) => /^[A-Z]{3}$/.test(x)) ?? 'EUR';
              if (date) out.balance = { date, amount, currency: cur };
              break;
            }
          }
        }
      }
      break;
    }

    let minDate = '';
    let maxDate = '';
    for (let i = hi + 1; i < table.length; i++) {
      const row = table[i];
      // Locate the date cell; if the row is shifted compared with the header, shift every column
      let di = parseFrDate(row[iDate]) ? iDate : row.findIndex((c) => parseFrDate(c) !== null);
      if (di < 0) {
        if (row.some((c) => c !== '')) out.warnings.push(`Line ${i + 1} skipped: no date found.`);
        continue;
      }
      const shift = di - iDate;
      const at = (idx: number) => (idx >= 0 ? row[idx + shift] ?? '' : '');
      const date = parseFrDate(row[di])!;
      const amount = parseAmount(at(iAmount));
      if (amount === null) {
        out.errors.push(`Line ${i + 1}: amount not readable ("${at(iAmount)}").`);
        continue;
      }
      const label = at(iLabel);
      const parsed: ParsedRow = {
        date,
        label,
        detail: label,
        amount,
        currency: 'EUR',
        line: i + 1,
        bankCategory: at(iCat) || undefined,
        bankSubCategory: at(iSub) || undefined,
        comment: at(iComment) || undefined,
      };
      out.rows.push(parsed);
      if (!minDate || date < minDate) minDate = date;
      if (!maxDate || date > maxDate) maxDate = date;
      di = -1;
    }
    if (minDate) {
      out.periodStart = minDate;
      out.periodEnd = out.balance?.date && out.balance.date > maxDate ? out.balance.date : maxDate;
    }
    return out;
  },
};
