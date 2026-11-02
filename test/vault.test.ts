import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  createVault,
  decryptJson,
  encryptJson,
  makeBackup,
  normalizeRecoveryKey,
  parseBackup,
  setNewPassphrase,
  unwrapWithPassphrase,
  unwrapWithRecovery,
  WrongKeyError,
} from '../src/core/vault';
import { kv } from '../src/core/storage';
import { emptyVault } from '../src/core/model';
import { commitImport, previewImport } from '../src/core/importService';
import { linkTransfers } from '../src/core/transfers';
import { applyOwnNameHints, matchesOwnName } from '../src/core/ownNames';
import { monthlySummaries } from '../src/core/summary';
import { sgRawBytes } from './fixtures';

const FAST = 1000; // fewer PBKDF2 iterations to keep tests quick

describe('vault encryption', () => {
  it('encrypts and decrypts with passphrase and recovery key', async () => {
    const { header, key, recoveryKey } = await createVault('correct horse battery', FAST);
    expect(recoveryKey).toMatch(/^([0-9A-Z]{4} ){7}[0-9A-Z]{4}$/);
    const blob = await encryptJson(key, { hello: 'world', n: [1, 2, 3] });
    expect(blob.ct).not.toContain('world');

    const k1 = await unwrapWithPassphrase(header, 'correct horse battery');
    expect(await decryptJson(k1, blob)).toEqual({ hello: 'world', n: [1, 2, 3] });

    const k2 = await unwrapWithRecovery(header, recoveryKey.toLowerCase().replace(/ /g, '-'));
    expect(await decryptJson(k2, blob)).toEqual({ hello: 'world', n: [1, 2, 3] });

    await expect(unwrapWithPassphrase(header, 'wrong')).rejects.toBeInstanceOf(WrongKeyError);
    await expect(unwrapWithRecovery(header, 'AAAA')).rejects.toBeInstanceOf(WrongKeyError);
  });

  it('runtime key cannot be exported', async () => {
    const { key } = await createVault('pass phrase here', FAST);
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toBeTruthy();
  });

  it('changes the passphrase with the recovery key and keeps data readable', async () => {
    const { header, key, recoveryKey } = await createVault('old passphrase', FAST);
    const blob = await encryptJson(key, { a: 1 });
    const h2 = await setNewPassphrase(header, { recoveryKey }, 'new passphrase');
    await expect(unwrapWithPassphrase(h2, 'old passphrase')).rejects.toBeInstanceOf(WrongKeyError);
    const k = await unwrapWithPassphrase(h2, 'new passphrase');
    expect(await decryptJson(k, blob)).toEqual({ a: 1 });
    expect(await decryptJson(await unwrapWithRecovery(h2, recoveryKey), blob)).toEqual({ a: 1 });
  });

  it('round trips a backup file with a full vault', async () => {
    const v = emptyVault();
    commitImport(previewImport(sgRawBytes(), 'a.csv', v), v);
    const { header, key } = await createVault('backup pass', FAST);
    const file = JSON.stringify(makeBackup(header, await encryptJson(key, v)));
    expect(file).not.toContain('Acme');
    const parsed = parseBackup(file);
    const k = await unwrapWithPassphrase(parsed.header, 'backup pass');
    const restored = await decryptJson<typeof v>(k, parsed.data);
    expect(restored.transactions.length).toBe(v.transactions.length);
    expect(() => parseBackup('{"x":1}')).toThrow();
  });

  it('normalizes recovery keys typed by hand', () => {
    expect(normalizeRecoveryKey('abcd-0o1l i')).toBe('ABCD00111');
  });
});

describe('storage', () => {
  it('stores and reads values', async () => {
    await kv.setMany({ a: { x: 1 }, b: 'two' });
    expect(await kv.get('a')).toEqual({ x: 1 });
    expect(await kv.get('b')).toBe('two');
    await kv.clear();
    expect(await kv.get('a')).toBeUndefined();
  });
});

describe('own transfers', () => {
  it('matches own names', () => {
    expect(matchesOwnName('M. Jean Martin', ['Jean Martin'])).toBe(true);
    expect(matchesOwnName('Mme Dupont A et Mr Martin J', ['Jean Martin'])).toBe(false);
    expect(matchesOwnName('Mme Dupont A et Mr Martin J', ['Martin'])).toBe(true);
  });

  it('links transfers between two accounts and excludes them from totals', () => {
    const v = emptyVault();
    commitImport(previewImport(sgRawBytes(), 'a.csv', v), v);
    const before = monthlySummaries(v)[0];
    v.accounts.push({ id: 'hb', name: 'Hello bank', bank: 'hellobank', type: 'checking', currency: 'EUR', createdAt: '' });
    v.transactions.push({
      id: 'x1', accountId: 'hb', date: '2026-10-22', label: 'VIR', detail: 'VIREMENT EMIS VERS SG', amount: -15000,
      currency: 'EUR', opType: 'transfer_out', counterparty: 'Jean Martin', merchantKey: 'TO JEAN MARTIN',
      categoryId: null, tags: [], source: 'demo', fp: 'f', transferId: null, createdAt: '',
    });
    expect(linkTransfers(v)).toBe(1);
    const sgSide = v.transactions.find((t) => t.amount === 15000)!;
    expect(sgSide.transferId).toBeTruthy();
    expect(sgSide.categoryId).toBe('own_transfer');
    const after = monthlySummaries(v)[0];
    expect(after.income).toBe(before.income - 15000);
    v.settings.holderNames = ['Jean Martin'];
    applyOwnNameHints(v);
    expect(sgSide.ownTransferHint).toBe(true);
  });
});
