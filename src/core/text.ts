// Text helpers: decoding bank files and normalizing labels.

// Windows 1252 code points for bytes 0x80 to 0x9F (the rest matches Latin 1).
const CP1252_HIGH: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Decode file bytes: UTF 8 when valid, otherwise Windows 1252 (common for French bank exports). */
export function decodeBytes(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return repairMojibake(text);
}

const MOJIBAKE = /[ÃÂâ][\u0080-¿ŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]/g;

/**
 * Repair text that was UTF 8 but got read as Windows 1252 somewhere along the way
 * ("opÃ©ration" becomes "opération"). Only applied when it clearly reduces the damage.
 */
export function repairMojibake(text: string): string {
  const before = (text.match(MOJIBAKE) || []).length;
  if (before === 0) return text;
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x100) bytes.push(cp);
    else if (CP1252_HIGH[cp] !== undefined) bytes.push(CP1252_HIGH[cp]);
    else return text; // contains characters that cannot come from a misread, leave untouched
  }
  let repaired: string;
  try {
    repaired = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return text;
  }
  const after = (repaired.match(MOJIBAKE) || []).length;
  return after < before ? repaired : text;
}

/** Lowercase, remove accents and collapse spaces: used to compare headers and labels. */
export function normalizeKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Collapse repeated spaces. */
export function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Title case a bank label for display: "GRAND CAFE DU PORT" → "Grand Cafe du Port". */
export function titleCase(s: string): string {
  const small = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'of', 'the', 'and', 'au', 'aux', 'en', 'sur']);
  return squash(s)
    .toLowerCase()
    .split(' ')
    .map((w, i) => {
      if (i > 0 && small.has(w)) return w;
      if (/^[a-z]{1,2}\.?$/.test(w) && i > 0 && w.length === 1) return w.toUpperCase();
      return w.replace(/(^|[-'.*])([a-zà-ÿ])/g, (_, p, c) => p + c.toUpperCase());
    })
    .join(' ');
}

/** Small fast non cryptographic hash (cyrb53), used for duplicate fingerprints inside the encrypted vault. */
export function hash53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function uid(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
