// Cleaning of merchant names so that the same shop gets the same name and key every time.

import { normalizeKey, squash, titleCase } from './text';

// Payment platforms that prefix the real merchant name, for example "SUNDAY*CHEZ PAUL"
const PREFIXES = /^(?:SUNDAY|SUMUP|SQ|ZETTLE_?|IZ|PAYPAL|LYF|STRIPE|PAYPLUG|MOLLIE|ZTL|SP|TST)\s*\*\s*/;

export function cleanMerchant(raw: string): string {
  let s = squash(raw.toUpperCase());
  s = s.replace(PREFIXES, '');
  s = s.replace(/\s*\((?:FRANCE|FR|PARIS|SAS|SA)\)\s*$/, '');
  s = s.replace(/^(?:HELP|WWW|PAY|BILLING)\.(?=[A-Z0-9-]+\.[A-Z]{2,})/, '');
  return squash(s);
}

export function displayMerchant(clean: string): string {
  if (/^[A-Z0-9-]+(\.[A-Z0-9-]+)*\.[A-Z]{2,6}(\/\S*)?$/.test(clean)) return clean.toLowerCase();
  return titleCase(clean);
}

/** Stable grouping key: letters only, without accents, punctuation or numbers. */
export function keyOf(name: string): string {
  return squash(
    normalizeKey(name)
      .toUpperCase()
      .replace(/[^A-Z ]+/g, ' '),
  );
}
