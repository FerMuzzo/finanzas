// Money is always handled as integer cents to avoid floating point errors.

/** Parse a French style amount such as "-845,00", "1 234,56 EUR" or "1.234,56". Returns cents or null. */
export function parseAmount(input: string | undefined | null): number | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;
  s = s.replace(/[A-Za-z€\s  ]/g, '');
  // Unicode minus and similar signs
  s = s.replace(/[−‒–—]/g, '-');
  let negative = false;
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  else if (s.startsWith('+')) { s = s.slice(1); }
  if (s.endsWith('-')) { negative = true; s = s.slice(0, -1); }
  if (!/^[0-9.,']+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let intPart: string;
  let decPart = '';
  const sepIndex = Math.max(lastComma, lastDot);
  if (sepIndex >= 0 && s.length - sepIndex - 1 <= 2 && s.length - sepIndex - 1 > 0) {
    intPart = s.slice(0, sepIndex);
    decPart = s.slice(sepIndex + 1);
  } else {
    intPart = s;
  }
  intPart = intPart.replace(/[.,']/g, '');
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(decPart)) return null;
  const cents = Number(intPart || '0') * 100 + Number((decPart + '00').slice(0, 2));
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Format cents for display, for example 123456 → "1 234,56 €". */
export function formatCents(cents: number, currency = 'EUR', opts: { sign?: boolean } = {}): string {
  const key = currency + (opts.sign ? '+' : '');
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      signDisplay: opts.sign ? 'exceptZero' : 'auto',
    });
    formatters.set(key, f);
  }
  return f.format(cents / 100);
}
