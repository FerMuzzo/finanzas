// Application state: vault lifecycle (create, unlock, lock, save), backups and auto lock.

import { emptyVault, migrateVault, type VaultData } from '../core/model';
import { kv } from '../core/storage';
import {
  createVault,
  decryptJson,
  encryptJson,
  makeBackup,
  parseBackup,
  setNewPassphrase,
  unwrapWithPassphrase,
  unwrapWithRecovery,
  type EncryptedBlob,
  type VaultHeader,
} from '../core/vault';
import { todayIso } from '../core/dates';

export type Phase = 'loading' | 'welcome' | 'create' | 'recovery' | 'locked' | 'restore' | 'ready';
export type Tab = 'home' | 'spending' | 'regular' | 'transactions' | 'import' | 'settings';

export const app = $state({
  phase: 'loading' as Phase,
  tab: 'home' as Tab,
  demo: false,
  data: null as VaultData | null,
  recoveryKey: '',
  toast: '',
  busy: false,
  adding: false,
  failedAttempts: 0,
  selectedMonth: '',
  txFilter: { accountId: '', month: '', query: '', categoryId: '' },
});

let key: CryptoKey | null = null;
let header: VaultHeader | null = null;

export async function init(): Promise<void> {
  try {
    header = (await kv.get<VaultHeader>('header')) ?? null;
  } catch {
    header = null;
  }
  app.phase = header ? 'locked' : 'welcome';
}

export function toast(msg: string): void {
  app.toast = msg;
  setTimeout(() => {
    if (app.toast === msg) app.toast = '';
  }, 3500);
}

// Saving

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> = Promise.resolve();

/** Schedule an encrypted save of the current data. */
export function persist(): void {
  if (app.demo || !app.data) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saving = saving.then(saveNow).catch((e) => toast('Could not save: ' + (e as Error).message));
  }, 250);
}

async function saveNow(): Promise<void> {
  if (!key || !app.data || app.demo) return;
  const blob = await encryptJson(key, $state.snapshot(app.data));
  await kv.set('data', blob);
}

export async function flush(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    saving = saving.then(saveNow);
  }
  await saving;
}

// Creating and opening the vault

export async function createNewVault(passphrase: string): Promise<void> {
  app.busy = true;
  try {
    const v = await createVault(passphrase);
    key = v.key;
    header = v.header;
    const data = emptyVault();
    data.audit.push({ at: new Date().toISOString(), action: 'created' });
    const blob = await encryptJson(key, data);
    await kv.setMany({ header, data: blob });
    app.data = data;
    app.demo = false;
    app.recoveryKey = v.recoveryKey;
    app.phase = 'recovery';
    requestPersistence();
  } finally {
    app.busy = false;
  }
}

export function finishRecoveryStep(): void {
  app.recoveryKey = '';
  app.phase = 'ready';
  app.tab = 'import';
  touch();
}

/** Demo with invented data. Only exists in the preview build: the real app contains no demo data. */
export async function startDemo(): Promise<void> {
  if (import.meta.env.VITE_PREVIEW !== '1' && import.meta.env.VITE_E2E !== '1') return;
  const { buildDemoVault } = await import('../core/demo');
  app.data = buildDemoVault();
  app.demo = true;
  key = null;
  app.phase = 'ready';
  app.tab = 'home';
  touch();
}

async function openWith(k: CryptoKey): Promise<void> {
  const blob = await kv.get<EncryptedBlob>('data');
  if (!blob) throw new Error('No data found on this device.');
  const data = migrateVault(await decryptJson<VaultData>(k, blob));
  key = k;
  app.data = data;
  app.demo = false;
  app.failedAttempts = 0;
  app.phase = 'ready';
  app.tab = 'home';
  touch();
}

async function slowDownAfterFailures(): Promise<void> {
  const n = app.failedAttempts;
  if (n >= 3) await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** (n - 2))));
}

export async function unlock(passphrase: string): Promise<void> {
  if (!header) throw new Error('No vault on this device.');
  app.busy = true;
  try {
    await slowDownAfterFailures();
    const k = await unwrapWithPassphrase(header, passphrase);
    await openWith(k);
  } catch (e) {
    app.failedAttempts++;
    throw e;
  } finally {
    app.busy = false;
  }
}

/** Unlock with the recovery key and immediately choose a new passphrase. */
export async function unlockWithRecoveryKey(recoveryKey: string, newPassphrase: string): Promise<void> {
  if (!header) throw new Error('No vault on this device.');
  app.busy = true;
  try {
    await slowDownAfterFailures();
    const k = await unwrapWithRecovery(header, recoveryKey);
    header = await setNewPassphrase(header, { recoveryKey }, newPassphrase);
    await kv.set('header', header);
    await openWith(k);
    app.data!.audit.push({ at: new Date().toISOString(), action: 'passphrase reset with recovery key' });
    persist();
  } catch (e) {
    app.failedAttempts++;
    throw e;
  } finally {
    app.busy = false;
  }
}

export async function changePassphrase(current: string, next: string): Promise<void> {
  if (!header) throw new Error('No vault on this device.');
  app.busy = true;
  try {
    header = await setNewPassphrase(header, { passphrase: current }, next);
    await kv.set('header', header);
    app.data?.audit.push({ at: new Date().toISOString(), action: 'passphrase changed' });
    persist();
  } finally {
    app.busy = false;
  }
}

export async function lock(): Promise<void> {
  if (app.phase !== 'ready') return;
  if (!app.demo) await flush();
  key = null;
  app.data = null;
  app.selectedMonth = '';
  app.txFilter = { accountId: '', month: '', query: '', categoryId: '' };
  app.phase = app.demo ? 'welcome' : 'locked';
  app.demo = false;
}

export async function eraseEverything(): Promise<void> {
  key = null;
  header = null;
  app.data = null;
  app.demo = false;
  await kv.clear();
  app.phase = 'welcome';
}

// Backups

export async function backupFile(): Promise<{ name: string; blob: Blob }> {
  if (!key || !header || !app.data) throw new Error('Unlock first.');
  await flush();
  app.data.settings.lastBackupAt = new Date().toISOString();
  const encrypted = await encryptJson(key, $state.snapshot(app.data));
  await kv.set('data', encrypted);
  const json = JSON.stringify(makeBackup(header, encrypted));
  return { name: `finanzas-backup-${todayIso()}.json`, blob: new Blob([json], { type: 'application/json' }) };
}

export async function restoreFromBackup(text: string, secret: string): Promise<void> {
  app.busy = true;
  try {
    const b = parseBackup(text);
    let k: CryptoKey;
    try {
      k = await unwrapWithPassphrase(b.header, secret);
    } catch {
      k = await unwrapWithRecovery(b.header, secret);
    }
    const data = migrateVault(await decryptJson<VaultData>(k, b.data));
    await kv.setMany({ header: b.header, data: b.data });
    header = b.header;
    key = k;
    app.data = data;
    app.demo = false;
    app.phase = 'ready';
    app.tab = 'home';
    data.audit.push({ at: new Date().toISOString(), action: 'restored from backup', detail: b.createdAt });
    persist();
    touch();
  } finally {
    app.busy = false;
  }
}

// Persistent storage, so Chrome does not evict the vault when space runs low

export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* ignore */
  }
  return false;
}

export async function isPersisted(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}

// Auto lock after inactivity and when the app stays in the background

let lastActivity = Date.now();
let hiddenAt = 0;

export function touch(): void {
  lastActivity = Date.now();
}

export function startAutoLock(): void {
  const onActivity = () => touch();
  for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) {
    window.addEventListener(ev, onActivity, { passive: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      void flush();
    } else if (hiddenAt && Date.now() - hiddenAt > 60_000) {
      void lock();
    }
  });
  setInterval(() => {
    if (app.phase !== 'ready' || !app.data) return;
    const minutes = app.data.settings.autoLockMinutes || 5;
    if (Date.now() - lastActivity > minutes * 60_000) void lock();
  }, 15_000);
}

export function showOperations(filter: Partial<typeof app.txFilter>): void {
  app.txFilter = { accountId: '', month: '', query: '', categoryId: '', ...filter };
  app.tab = 'transactions';
  window.scrollTo({ top: 0 });
}

export function go(tab: Tab): void {
  app.tab = tab;
  window.scrollTo({ top: 0 });
}
