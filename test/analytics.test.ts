import { describe, expect, it } from 'vitest';
import { buildDemoVault } from '../src/core/demo';
import { allMonths, applyFilter, balanceHistory, byCategory, byMerchant, byWeekday, monthlyByCategory, monthlyTotals, monthPace, monthsBetween, sizeDistribution, type ChartFilter } from '../src/core/analytics';
import { findSimilarOperations, monthlySeries, similarStats } from '../src/core/similar';
import { averageMonthlyNetFlow, currentBalance, simulateSavings } from '../src/core/savings';
import { latestBalance } from '../src/core/summary';

const v = buildDemoVault(new Date(2026, 10, 2));
const months = allMonths(v);

describe('similar operations', () => {
  it('finds the same merchant and computes totals', () => {
    const nf = v.transactions.find((t) => t.counterparty === 'netflix.com')!;
    const list = findSimilarOperations(v, nf);
    expect(list.length).toBe(6);
    const st = similarStats(list)!;
    expect(st.count).toBe(6);
    expect(st.average).toBe(-1349);
    expect(st.perMonth).toBe(-1349);
    const ser = monthlySeries(list);
    expect(ser.values.every((x) => x === 1349)).toBe(true);
  });
  it('finds operations with a similar amount when asked', () => {
    const rent = v.transactions.find((t) => t.amount === -95000)!;
    const byAmount = findSimilarOperations(v, rent, { byName: false, byAmount: true, amountTolerance: 0.05 });
    expect(byAmount.every((t) => Math.abs(t.amount + 95000) <= 4750)).toBe(true);
    const shop = v.transactions.find((t) => t.counterparty === 'Monoprix')!;
    const both = findSimilarOperations(v, shop, { byName: true, byAmount: true, amountTolerance: 0.15 });
    expect(both.every((t) => t.counterparty === 'Monoprix')).toBe(true);
    expect(both.length).toBeLessThanOrEqual(findSimilarOperations(v, shop).length);
  });
});

describe('savings simulation', () => {
  it('adds interest once a year like a Livret A, or every month', () => {
    const y = simulateSavings({ start: 100000, monthly: 0, ratePct: 3, years: 1, interestPaid: 'yearly', taxPct: 0 });
    expect(y.final.balance).toBe(103000);
    expect(y.points[6].interest).toBe(0);
    const m = simulateSavings({ start: 100000, monthly: 0, ratePct: 3, years: 1, interestPaid: 'monthly', taxPct: 0 });
    expect(m.final.balance).toBe(103042);
    const taxed = simulateSavings({ start: 100000, monthly: 0, ratePct: 3, years: 1, interestPaid: 'yearly', taxPct: 30 });
    expect(taxed.final.interest).toBe(2100);
    const dep = simulateSavings({ start: 0, monthly: 10000, ratePct: 0, years: 2, interestPaid: 'yearly', taxPct: 0 });
    expect(dep.final).toMatchObject({ balance: 240000, deposited: 240000, interest: 0 });
  });
  it('estimates monthly deposits and the current balance of the demo savings account', () => {
    const hb = v.accounts.find((a) => a.bank === 'hellobank')!;
    expect(averageMonthlyNetFlow(v, hb.id)).toBe(30000);
    expect(currentBalance(v, hb)).toBe(latestBalance(v, hb.id)!.amount);
  });
});

describe('charts data', () => {
  const f: ChartFilter = { from: months[0], to: months[months.length - 1], accountIds: [], categoryIds: [], kind: 'expense', query: '', regular: 'all' };
  const items = applyFilter(v, f);
  it('filters and totals', () => {
    expect(items.length).toBeGreaterThan(100);
    const totals = monthlyTotals(items, months);
    expect(totals.reduce((a, b) => a + b, 0)).toBe(items.reduce((a, it) => a + it.value, 0));
    const stacked = monthlyByCategory(v, items, months, 4);
    expect(stacked.length).toBe(5);
    const sum = stacked.reduce((a, s) => a + s.values.reduce((x, y) => x + y, 0), 0);
    expect(sum).toBe(totals.reduce((a, b) => a + b, 0));
    expect(byCategory(v, items)[0].id).toBe('housing');
    expect(byMerchant(items, 5).length).toBe(5);
    expect(byWeekday(items).count.reduce((a, b) => a + b, 0)).toBe(items.length);
    expect(sizeDistribution(items).count.reduce((a, b) => a + b, 0)).toBe(items.length);
    const pace = monthPace(items, months[months.length - 2], months);
    expect(pace.current[30]).toBe(totals[months.length - 2]);
  });
  it('filters by category, search and regular payments', () => {
    const g = applyFilter(v, { ...f, categoryIds: ['groceries'] });
    expect(g.every((it) => it.t.categoryId === 'groceries')).toBe(true);
    const q = applyFilter(v, { ...f, query: 'lidl' });
    expect(q.every((it) => it.t.counterparty === 'Lidl')).toBe(true);
    const inc = applyFilter(v, { ...f, kind: 'income' });
    expect(inc.every((it) => it.t.amount > 0)).toBe(true);
    expect(monthsBetween('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
  it('rebuilds month end balances from the bank balance', () => {
    const sg = v.accounts.find((a) => a.bank === 'sg')!;
    const hist = balanceHistory(v, sg.id, months);
    const snap = latestBalance(v, sg.id)!;
    const i = months.indexOf(snap.date.slice(0, 7));
    const after = v.transactions.filter((t) => t.accountId === sg.id && t.date > snap.date && t.date.slice(0, 7) === months[i]).reduce((s, t) => s + t.amount, 0);
    expect(hist[i]).toBe(snap.amount + after);
    const prevMonthOps = v.transactions.filter((t) => t.accountId === sg.id && t.date.slice(0, 7) === months[i] && t.date <= snap.date).reduce((s, t) => s + t.amount, 0);
    expect(hist[i - 1]).toBe(snap.amount - prevMonthOps);
  });
});
