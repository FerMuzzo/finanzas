import Papa from 'papaparse';
import { normalizeKey } from './text';

const CANDIDATE_DELIMITERS = [';', '\t', ',', '|'];

/**
 * Split delimited text into rows of trimmed cells. The delimiter is chosen as the one that
 * splits the header line (a line containing the keyword) into the most cells.
 */
export function readTable(text: string, headerKeyword = 'libell'): string[][] {
  const lines = text.split(/\r?\n/);
  const headerLine = lines.find((l) => normalizeKey(l).includes(headerKeyword)) ?? lines.find((l) => l.trim()) ?? '';
  let best = ';';
  let bestCount = 0;
  for (const d of CANDIDATE_DELIMITERS) {
    const n = headerLine.split(d).filter((c) => c.trim()).length;
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  const parsed = Papa.parse<string[]>(text, { delimiter: best, skipEmptyLines: false });
  return parsed.data.map((row) => row.map(cleanCell));
}

/** Remove spreadsheet protections such as ="0123" and surrounding spaces. */
export function cleanCell(c: unknown): string {
  let s = c == null ? '' : String(c);
  s = s.replace(/ /g, ' ').trim();
  const m = s.match(/^="(.*)"$/);
  if (m) s = m[1];
  return s;
}

/** Protect exported cells against spreadsheet formula injection. */
export function safeCsvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
  if (/[;"\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
