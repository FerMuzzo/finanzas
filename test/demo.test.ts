import { describe, expect, it } from 'vitest';
import { buildDemoVault } from '../src/core/demo';
import { monthlySummaries } from '../src/core/summary';

describe('demo data', () => {
  it('builds a realistic vault through the real importer', () => {
    const v = buildDemoVault(new Date(2026, 10, 2));
    expect(v.accounts.length).toBe(2);
    expect(v.transactions.length).toBeGreaterThan(150);
    const linked = v.transactions.filter((t) => t.transferId);
    expect(linked.length).toBe(12); // 6 months, both sides
    const s = monthlySummaries(v);
    expect(s[0].month).toBe('2026-10');
    expect(s[0].income).toBeGreaterThan(280000);
    const types = new Set(v.transactions.map((t) => t.opType));
    for (const t of ['card', 'card_fee', 'cash_withdrawal', 'direct_debit', 'standing_order', 'transfer_in', 'instant_transfer_out']) {
      expect(types.has(t as never)).toBe(true);
    }
    const hotel = v.transactions.find((t) => t.counterparty.startsWith('Hotel'));
    expect(hotel?.foreign?.country).toBe('Espagne');
  });
});
