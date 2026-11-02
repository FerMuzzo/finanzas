import { describe, expect, it } from 'vitest';
import { buildDemoVault } from '../src/core/demo';
import { categorizeAll, setCategoryByHand } from '../src/core/categorize';
import { confirmSeries, detectAll, dismissSeries, seriesStatuses, suggestions } from '../src/core/recurring';
import { completeMonths, fixedVersusVariable, spendingByCategory, topMerchants } from '../src/core/summary';

const today = new Date(2026, 10, 2);

describe('categories', () => {
  it('categorizes most demo operations and learns from a choice', () => {
    const v = buildDemoVault(today);
    const spend = v.transactions.filter((t) => t.amount < 0 && !t.transferId);
    const done = spend.filter((t) => t.categoryId).length / spend.length;
    expect(done).toBeGreaterThan(0.85);
    const lion = v.transactions.filter((t) => t.counterparty === 'The Red Fox');
    expect(lion.length).toBeGreaterThan(1);
    expect(lion[0].categoryId).toBeNull();
    const others = setCategoryByHand(v, lion[0], 'eating_out');
    expect(others).toBe(lion.length - 1);
    expect(lion.every((t) => t.categoryId === 'eating_out')).toBe(true);
    expect(lion[0].catSource).toBe('user');
    expect(lion[1].catSource).toBe('memory');
    // a later automatic pass never overrides a choice made by hand
    setCategoryByHand(v, lion[1], 'leisure');
    categorizeAll(v);
    expect(lion[1].categoryId).toBe('leisure');
    expect(lion[0].categoryId).toBe('eating_out');
  });
});

describe('regular payments', () => {
  it('finds the demo subscriptions, bills and salary but not shops', () => {
    const v = buildDemoVault(today);
    const found = detectAll(v);
    const names = found.map((c) => c.name);
    for (const n of ['Sci les Lilas', 'Free Mobile', 'Edf Clients Particuliers', 'Box Internet Sa', 'Mutuelle Exemple', 'netflix.com', 'Salle de Sport Forme', 'Exemple Employeur Sa']) {
      expect(names).toContain(n);
    }
    for (const n of ['Monoprix', 'Carrefour City', 'Lidl', 'Biocoop']) expect(names).not.toContain(n);
    const rent = found.find((c) => c.name === 'Sci les Lilas')!;
    expect(rent).toMatchObject({ cadence: 'monthly', typical: -95000, fixed: true, dayOfMonth: 1 });
    const salary = found.find((c) => c.name === 'Exemple Employeur Sa')!;
    expect(salary.typical).toBeGreaterThan(0);
  });

  it('confirms and dismisses suggestions, then tracks status', () => {
    const v = buildDemoVault(today);
    const s = suggestions(v);
    const netflix = s.find((c) => c.name === 'netflix.com')!;
    confirmSeries(v, netflix);
    dismissSeries(v, s.find((c) => c.name === 'Edf Clients Particuliers')!);
    const after = suggestions(v).map((c) => c.name);
    expect(after).not.toContain('netflix.com');
    expect(after).not.toContain('Edf Clients Particuliers');
    const st = seriesStatuses(v);
    expect(st.length).toBe(1);
    expect(st[0].count).toBe(6);
    expect(st[0].monthly).toBe(-1349);
    expect(st[0].late).toBe(false);
    const linked = v.transactions.filter((t) => t.recurringId === st[0].series.id).length;
    expect(linked).toBe(6);
    const months = completeMonths(v, '2026-11-02');
    const fv = fixedVersusVariable(v, [months[0]]);
    expect(fv.fixed).toBe(1349);
  });

  it('keeps a subscription after a price increase and flags it', () => {
    const v = buildDemoVault(today);
    const nf = v.transactions.filter((t) => t.counterparty === 'netflix.com').sort((a, b) => a.date.localeCompare(b.date));
    nf[nf.length - 1].amount = -1599;
    const c = detectAll(v).find((x) => x.name === 'netflix.com')!;
    expect(c.typical).toBe(-1349);
    confirmSeries(v, c);
    const st = seriesStatuses(v)[0];
    expect(st.priceChange).toEqual({ from: -1349, to: -1599 });
  });
});

describe('spending summaries', () => {
  it('breaks spending down by category and merchant', () => {
    const v = buildDemoVault(today);
    const months = completeMonths(v, '2026-11-02').slice(0, 3);
    const avg = spendingByCategory(v, months, { average: true });
    const groceries = avg.find((c) => c.categoryId === 'groceries')!;
    expect(groceries.amount).toBeGreaterThan(10000);
    const housing = avg.find((c) => c.categoryId === 'housing')!;
    expect(housing.amount).toBe(95000);
    const top = topMerchants(v, months, { categoryId: 'groceries', limit: 3 });
    expect(top.length).toBe(3);
    expect(avg.find((c) => c.categoryId === 'own_transfer')).toBeUndefined();
  });
});
