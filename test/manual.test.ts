import { describe, expect, it } from 'vitest';
import { commitImport, previewImport } from '../src/core/importService';
import { addManual, ensureCashAccount, findSimilar } from '../src/core/manual';
import { emptyVault } from '../src/core/model';
import { buildDemoVault } from '../src/core/demo';
import { hbText, sgRawBytes, SG_ROWS } from './fixtures';

describe('operations added by hand', () => {
  it('warns about an operation that is already there', () => {
    const v = emptyVault();
    commitImport(previewImport(sgRawBytes(), 'sg.csv', v), v);
    const acc = v.accounts[0].id;
    const hits = findSimilar(v, { accountId: acc, date: '2026-10-29', amount: -4800 });
    expect(hits.map((t) => t.counterparty)).toEqual(['Asso Exemple']);
    expect(findSimilar(v, { accountId: acc, date: '2026-10-29', amount: -4900 })).toEqual([]);
    expect(findSimilar(v, { accountId: acc, date: '2026-10-10', amount: -4800 })).toEqual([]);
  });

  it('merges a manual entry with the bank line when the file arrives', () => {
    const v = emptyVault();
    const withoutSalon = SG_ROWS.filter((r) => !r[2].includes('SALON'));
    commitImport(previewImport(sgRawBytes(withoutSalon), 'a.csv', v), v);
    const acc = v.accounts[0].id;
    const m = addManual(v, { accountId: acc, date: '2026-10-24', amount: -2500, description: 'coiffeur', categoryId: 'personal_care', note: 'haircut' });
    expect(m.counterparty).toBe('Coiffeur');
    const prev = previewImport(sgRawBytes(), 'b.csv', v);
    expect(prev.manualCount).toBe(1);
    expect(prev.newCount).toBe(0);
    expect(prev.duplicateCount).toBe(withoutSalon.length);
    const r = commitImport(prev, v);
    expect(r).toMatchObject({ added: 0, merged: 1 });
    expect(v.transactions.length).toBe(SG_ROWS.length);
    const t = v.transactions.find((x) => x.id === m.id)!;
    expect(t).toMatchObject({ source: 'import', counterparty: 'Salon Exemple', categoryId: 'personal_care', catSource: 'user', date: '2026-10-26', opDate: '2026-10-24' });
    expect(t.note).toContain('haircut');
    expect(t.note).toContain('Added by hand as Coiffeur');
    // importing again changes nothing
    expect(previewImport(sgRawBytes(), 'c.csv', v).newCount).toBe(0);
  });

  it('flags a possible duplicate with a different reference and skips it unless asked', () => {
    const v = emptyVault();
    commitImport(previewImport(sgRawBytes(), 'a.csv', v), v);
    const changed = SG_ROWS.map((r, i) => (i === 5 ? [r[0], r[1], r[2].replace('900000000000002IOPD', '900000000000999IOPD'), r[3], r[4]] : r));
    const prev = previewImport(sgRawBytes(changed), 'b.csv', v);
    expect(prev.possibleCount).toBe(1);
    expect(prev.rows[5].match?.counterparty).toBe('Airport Shop Exemple');
    const before = v.transactions.length;
    const r = commitImport(prev, v);
    expect(r.possibleSkipped).toBe(1);
    expect(v.transactions.length).toBe(before);
    const prev2 = previewImport(sgRawBytes(changed), 'b.csv', v);
    commitImport(prev2, v, undefined, { includePossible: true });
    expect(v.transactions.length).toBe(before + 1);
  });

  it('turns cash withdrawals into transfers once a Cash account exists', () => {
    const v = buildDemoVault(new Date(2026, 10, 2));
    const w = v.transactions.filter((t) => t.opType === 'cash_withdrawal');
    expect(w.every((t) => t.categoryId === 'cash')).toBe(true);
    const cash = ensureCashAccount(v);
    expect(cash.bank).toBe('cash');
    expect(w.every((t) => t.categoryId === 'own_transfer')).toBe(true);
    expect(ensureCashAccount(v).id).toBe(cash.id);
  });

  it('gives each new account its own color', () => {
    const v = emptyVault();
    commitImport(previewImport(sgRawBytes(), 'a.csv', v), v, undefined, { color: 5 });
    commitImport(previewImport(new TextEncoder().encode(hbText()), 'b.csv', v), v);
    expect(v.accounts.map((a) => a.color)).toEqual([5, 1]);
  });
});
