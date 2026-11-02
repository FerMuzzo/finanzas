/** Parse "dd/mm/yyyy" (also dd.mm.yyyy or dd-mm-yyyy) into ISO "yyyy-mm-dd". */
export function parseFrDate(s: string | undefined | null): string | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  const check = new Date(iso + 'T00:00:00Z');
  if (check.getUTCDate() !== d) return null;
  return iso;
}

/** Parse an ISO date "yyyy-mm-dd" if valid. */
export function parseIsoDate(s: string | undefined | null): string | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * Card lines carry the purchase day and month only ("29/10"). The year is inferred from the
 * booking date: a December purchase booked in January belongs to the previous year.
 */
export function inferShortDate(dayMonth: string, bookingIso: string): string | null {
  const m = dayMonth.match(/^(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(bookingIso.slice(0, 4));
  const bookingMonth = Number(bookingIso.slice(5, 7));
  if (mo > bookingMonth + 1) y -= 1;
  return parseFrDate(`${pad(d)}/${pad(mo)}/${y}`);
}

export function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a + 'T00:00:00Z');
  const tb = Date.parse(b + 'T00:00:00Z');
  return Math.round(Math.abs(ta - tb) / 86400000);
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortMonthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export function formatMonth(ym: string): string {
  return monthFmt.format(new Date(ym + '-01T00:00:00Z'));
}

export function formatShortMonth(ym: string): string {
  return shortMonthFmt.format(new Date(ym + '-01T00:00:00Z'));
}

export function formatDay(iso: string): string {
  return dayFmt.format(new Date(iso + 'T00:00:00Z'));
}
