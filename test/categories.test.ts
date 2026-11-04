// Adding, renaming and deleting categories. Invented names and amounts.

import { describe, expect, it } from 'vitest';
import { emptyVault, migrateVault, type VaultData } from '../src/core/model';
import { addAccount } from '../src/core/accounts';
import { addManual } from '../src/core/manual';
import { addCategory, categoryUse, deleteCategory, mergeCategories, mergeTargets, renameCategory } from '../src/core/categories';
import { categorizeAll, setCategoryForMany } from '../src/core/categorize';
import { spendingByCategory } from '../src/core/summary';

function vault(): VaultData {
  return migrateVault(emptyVault());
}

describe('categories', () => {
  it('adds a category that counts as spending and is learned like the others', () => {
    const v = vault();
    const a = addAccount(v, { name: 'Current', bank: 'other', type: 'checking' });
    const pets = addCategory(v, '  Pets  ', 'expense');
    expect(pets).toMatchObject({ name: 'Pets', kind: 'expense' });
    expect(() => addCategory(v, 'pets', 'expense')).toThrow(/already exists/);
    expect(() => addCategory(v, ' ', 'income')).toThrow(/name/);
    const t = addManual(v, { accountId: a.id, date: '2026-10-02', amount: -4500, description: 'Animalerie test', categoryId: null });
    setCategoryForMany(v, [t.id], pets.id);
    const u = addManual(v, { accountId: a.id, date: '2026-10-09', amount: -2000, description: 'Animalerie test', categoryId: null });
    expect(v.transactions.find((x) => x.id === u.id)!.categoryId).toBe(pets.id);
    expect(spendingByCategory(v, ['2026-10'])).toEqual([{ categoryId: pets.id, amount: 6500, count: 2 }]);
  });

  it('renames a category', () => {
    const v = vault();
    renameCategory(v, 'eating_out', 'Eating out and bars');
    expect(v.categories.find((c) => c.id === 'eating_out')!.name).toBe('Eating out and bars');
    expect(() => renameCategory(v, 'eating_out', 'Groceries')).toThrow(/already exists/);
  });

  it('deletes a category, moving its operations, rules and learned merchants', () => {
    const v = vault();
    const a = addAccount(v, { name: 'Current', bank: 'other', type: 'checking' });
    const t = addManual(v, { accountId: a.id, date: '2026-10-02', amount: -900, description: 'Kiosque test', categoryId: 'leisure' });
    v.rules.push({ id: 'r1', pattern: 'kiosque', categoryId: 'leisure', createdAt: '' });
    expect(categoryUse(v, 'leisure')).toEqual({ operations: 1, rules: 1, regular: 0 });
    expect(deleteCategory(v, 'leisure', 'shopping')).toBe(1);
    expect(v.transactions.find((x) => x.id === t.id)!.categoryId).toBe('shopping');
    expect(v.rules[0].categoryId).toBe('shopping');
    expect(Object.values(v.merchantMemory)).not.toContain('leisure');
    expect(v.categories.some((c) => c.id === 'leisure')).toBe(false);
    // a deleted default category does not come back, and is never suggested
    migrateVault(v);
    expect(v.categories.some((c) => c.id === 'leisure')).toBe(false);
  });

  it('deletes a category leaving its operations not categorized, and keeps the transfer category', () => {
    const v = vault();
    const a = addAccount(v, { name: 'Current', bank: 'other', type: 'checking' });
    const fee = addManual(v, { accountId: a.id, date: '2026-10-02', amount: -300, description: 'Bank charge', categoryId: null });
    v.transactions.find((x) => x.id === fee.id)!.opType = 'bank_fee';
    categorizeAll(v);
    expect(v.transactions.find((x) => x.id === fee.id)!.categoryId).toBe('bank_fees');
    deleteCategory(v, 'bank_fees', null);
    categorizeAll(v);
    expect(v.transactions.find((x) => x.id === fee.id)!.categoryId).toBeNull();
    expect(() => deleteCategory(v, 'own_transfer', null)).toThrow(/transfers/);
  });
});

describe('merging categories', () => {
  it('moves everything into the other category, which keeps its name', () => {
    const v = vault();
    const a = addAccount(v, { name: 'Current', bank: 'other', type: 'checking' });
    const snacks = addCategory(v, 'Snacks', 'expense');
    const t1 = addManual(v, { accountId: a.id, date: '2026-10-02', amount: -350, description: 'Kiosque test', categoryId: snacks.id });
    const t2 = addManual(v, { accountId: a.id, date: '2026-10-05', amount: -1200, description: 'Primeur test', categoryId: 'groceries' });
    v.rules.push({ id: 'r1', pattern: 'kiosque', categoryId: snacks.id, createdAt: '' });
    expect(mergeTargets(v, snacks.id).every((c) => c.kind === 'expense')).toBe(true);
    expect(mergeTargets(v, snacks.id).some((c) => c.id === 'salary')).toBe(false);
    expect(mergeCategories(v, snacks.id, 'groceries')).toBe(1);
    expect(v.transactions.find((x) => x.id === t1.id)!.categoryId).toBe('groceries');
    expect(v.transactions.find((x) => x.id === t2.id)!.categoryId).toBe('groceries');
    expect(v.rules[0].categoryId).toBe('groceries');
    expect(v.categories.some((c) => c.id === snacks.id)).toBe(false);
    expect(v.categories.find((c) => c.id === 'groceries')!.name).toBe('Groceries');
    expect(spendingByCategory(v, ['2026-10'])).toEqual([{ categoryId: 'groceries', amount: 1550, count: 2 }]);
    // a later operation of the merged category's merchant goes to the merged one
    const t3 = addManual(v, { accountId: a.id, date: '2026-10-09', amount: -400, description: 'Kiosque test', categoryId: null });
    expect(v.transactions.find((x) => x.id === t3.id)!.categoryId).toBe('groceries');
    expect(v.audit.some((e) => e.action === 'categories merged')).toBe(true);
  });

  it('refuses a merge across kinds or into itself', () => {
    const v = vault();
    expect(() => mergeCategories(v, 'groceries', 'salary')).toThrow(/same kind/);
    expect(() => mergeCategories(v, 'groceries', 'groceries')).toThrow(/another category/);
    expect(() => mergeCategories(v, 'own_transfer', 'savings')).toThrow();
  });
});
