export interface Strength {
  score: 0 | 1 | 2 | 3;
  label: string;
  ok: boolean;
}

/** Simple strength estimate. Long passphrases made of several words are the goal. */
export function passphraseStrength(p: string): Strength {
  const len = p.length;
  const words = p.trim().split(/\s+/).filter((w) => w.length >= 3).length;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d\s]/].filter((r) => r.test(p)).length;
  if (len < 10) return { score: 0, label: 'Too short: use at least 10 characters', ok: false };
  if (len >= 20 || (len >= 14 && (words >= 3 || classes >= 3))) return { score: 3, label: 'Strong', ok: true };
  if (len >= 14 || classes >= 3 || words >= 3) return { score: 2, label: 'Good', ok: true };
  return { score: 1, label: 'Acceptable, longer is better', ok: true };
}
