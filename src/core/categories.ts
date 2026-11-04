// Your categories: add, rename, and delete (moving their operations to another category).

import { DEFAULT_CATEGORIES, type Category, type CategoryKind, type VaultData } from './model';
import { normalizeKey, uid } from './text';

/** Used by the app itself to leave transfers between your accounts out of totals. */
export const PROTECTED_CATEGORIES = new Set(['own_transfer']);

export const KIND_LABELS: Record<CategoryKind, string> = {
  expense: 'Spending',
  income: 'Income',
  savings: 'Savings',
  transfer: 'Between my accounts',
};

function checkName(data: VaultData, name: string, exceptId?: string): string {
  const n = name.trim().replace(/\s+/g, ' ');
  if (!n) throw new Error('Give the category a name.');
  if (n.length > 40) throw new Error('Keep the name under 40 characters.');
  if (data.categories.some((c) => c.id !== exceptId && normalizeKey(c.name) === normalizeKey(n))) throw new Error('A category with this name already exists.');
  return n;
}

export function addCategory(data: VaultData, name: string, kind: CategoryKind): Category {
  const n = checkName(data, name);
  if (kind === 'transfer') throw new Error('Choose spending, income or savings.');
  const slug = normalizeKey(n).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'category';
  const c: Category = { id: `u_${slug}_${uid().slice(0, 6)}`, name: n, kind };
  data.categories.push(c);
  data.settings.removedCategories = (data.settings.removedCategories ?? []).filter((id) => id !== c.id);
  data.audit.push({ at: new Date().toISOString(), action: 'category added', detail: `${n} (${KIND_LABELS[kind]})` });
  return data.categories[data.categories.length - 1];
}

export function renameCategory(data: VaultData, id: string, name: string): void {
  const c = data.categories.find((x) => x.id === id);
  if (!c) return;
  const n = checkName(data, name, id);
  if (n === c.name) return;
  data.audit.push({ at: new Date().toISOString(), action: 'category renamed', detail: `${c.name} to ${n}` });
  c.name = n;
}

export interface CategoryUse {
  operations: number;
  rules: number;
  regular: number;
}

export function categoryUse(data: VaultData, id: string): CategoryUse {
  return {
    operations: data.transactions.filter((t) => t.categoryId === id).length,
    rules: data.rules.filter((r) => r.categoryId === id).length,
    regular: data.recurring.filter((r) => r.categoryId === id).length,
  };
}

/**
 * Delete a category. Its operations, regular payments, rules and learned merchants move to
 * another category, or become not categorized (rules are then removed). Returns the operations moved.
 */
export function deleteCategory(data: VaultData, id: string, moveTo: string | null): number {
  if (PROTECTED_CATEGORIES.has(id)) throw new Error('This category is needed for transfers between your accounts.');
  const c = data.categories.find((x) => x.id === id);
  if (!c) return 0;
  if (moveTo === id || (moveTo && !data.categories.some((x) => x.id === moveTo))) moveTo = null;
  let moved = 0;
  for (const t of data.transactions) {
    if (t.categoryId !== id) continue;
    t.categoryId = moveTo;
    if (!moveTo) t.catSource = undefined;
    moved++;
  }
  for (const s of data.recurring) if (s.categoryId === id) s.categoryId = moveTo;
  data.rules = moveTo ? data.rules.map((r) => (r.categoryId === id ? { ...r, categoryId: moveTo! } : r)) : data.rules.filter((r) => r.categoryId !== id);
  for (const [k, v] of Object.entries(data.merchantMemory)) {
    if (v !== id) continue;
    if (moveTo) data.merchantMemory[k] = moveTo;
    else delete data.merchantMemory[k];
  }
  data.categories = data.categories.filter((x) => x.id !== id);
  // A default category you delete does not come back with the next update of the app
  if (DEFAULT_CATEGORIES.some((d) => d.id === id)) data.settings.removedCategories = [...new Set([...(data.settings.removedCategories ?? []), id])];
  const target = moveTo ? data.categories.find((x) => x.id === moveTo)?.name : 'not categorized';
  data.audit.push({ at: new Date().toISOString(), action: moveTo ? 'categories merged' : 'category deleted', detail: `${c.name}: ${moved} operations moved to ${target}` });
  return moved;
}

/** Categories you can merge a category into: the others of the same kind (spending into spending, and so on). */
export function mergeTargets(data: VaultData, id: string): Category[] {
  const c = data.categories.find((x) => x.id === id);
  return c ? data.categories.filter((x) => x.id !== id && x.kind === c.kind) : [];
}

/**
 * Merge a category into another: its operations, rules, regular payments and learned merchants
 * move to the other one, which keeps its name, and the merged category disappears.
 */
export function mergeCategories(data: VaultData, fromId: string, intoId: string): number {
  const into = data.categories.find((x) => x.id === intoId);
  if (!into || fromId === intoId) throw new Error('Choose another category to merge into.');
  if (!mergeTargets(data, fromId).some((x) => x.id === intoId)) throw new Error('Only categories of the same kind can be merged.');
  return deleteCategory(data, fromId, intoId);
}
