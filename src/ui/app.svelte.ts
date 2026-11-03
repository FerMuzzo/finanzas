// Application state: vault lifecycle (create, unlock, lock, save), backups and auto lock.

import { emptyVault, migrateVault, type VaultData } from '../core/model';
import { kv } from '../core/storage';
import { bioAvailable, enrollBio, evalPrf } from './biometric';
import {
  addBioWrap,
  fromB64,
  newPrfSalt,
  unwrapWithPrf,
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
export type Tab = 'home' | 'spending' | 'charts' | 'regular' | 'transactions' | 'import' | 'settings';

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
  bioOn: false, // fingerprint unlock set up on this vault
  bioAvailable: false, // the phone offers a fingerprint or screen lock passkey
  autoBio: false, // offer the fingerprint prompt once when the app starts
});

let key: CryptoKey | null = null;
let header: VaultHeader | null = null;

// Optional encrypted copy in a file you choose (File System Access API, Chrome on Android and desktop)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FileHandle = any;
let mirrorHandle: FileHandle | null = null;
export const mirror = $state({
  supported: typeof window !== 'undefined' && 'showSaveFilePicker' in window,
  name: '',
  status: 'off' as 'off' | 'ok' | 'needs-permission' | 'error',
  lastWrite: '',
  error: '',
});

const PICKER_TYPES = [{ description: 'Finanzas encrypted file', accept: { 'application/json': ['.json'] } }];

async function loadMirror(): Promise<void> {
  try {
    mirrorHandle = (await kv.get<FileHandle>('mirrorHandle')) ?? null;
  } catch {
    mirrorHandle = null;
  }
  if (!mirrorHandle) {
    mirror.status = 'off';
    mirror.name = '';
    return;
  }
  mirror.name = mirrorHandle.name ?? 'file';
  try {
    const p = mirrorHandle.queryPermission ? await mirrorHandle.queryPermission({ mode: 'readwrite' }) : 'granted';
    mirror.status = p === 'granted' ? 'ok' : 'needs-permission';
  } catch {
    mirror.status = 'needs-permission';
  }
}

async function writeMirror(blob: EncryptedBlob): Promise<void> {
  if (!mirrorHandle || mirror.status !== 'ok' || !header) return;
  try {
    const w = await mirrorHandle.createWritable();
    await w.write(JSON.stringify(makeBackup(header, blob)));
    await w.close();
    mirror.lastWrite = new Date().toISOString();
    mirror.error = '';
  } catch (e) {
    mirror.status = 'error';
    mirror.error = (e as Error).message;
  }
}

async function writeAllNow(): Promise<void> {
  if (!key || !app.data || app.demo) return;
  await flush();
  const blob = await encryptJson(key, $state.snapshot(app.data));
  await kv.set('data', blob);
  await writeMirror(blob);
}

/** Ask where to keep the encrypted copy. Must be called from a tap. */
export async function chooseMirror(): Promise<boolean> {
  if (!mirror.supported) return false;
  let h: FileHandle;
  try {
    h = await (window as unknown as { showSaveFilePicker: (o: object) => Promise<FileHandle> }).showSaveFilePicker({
      suggestedName: 'finanzas-data.json',
      startIn: 'documents',
      types: PICKER_TYPES,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') return false;
    throw e;
  }
  mirrorHandle = h;
  mirror.name = h.name ?? 'file';
  mirror.status = 'ok';
  try {
    await kv.set('mirrorHandle', h); // remembered, so the copy keeps updating after the app restarts
  } catch {
    /* some browsers cannot store the handle; the copy then works until the app is closed */
  }
  await writeAllNow();
  app.data?.audit.push({ at: new Date().toISOString(), action: 'copy file chosen', detail: mirror.name });
  return mirror.status === 'ok';
}

/** After a restart Chrome may ask again for permission to write the file. Must be called from a tap. */
export async function resumeMirror(): Promise<void> {
  if (!mirrorHandle) return;
  try {
    const p = mirrorHandle.requestPermission ? await mirrorHandle.requestPermission({ mode: 'readwrite' }) : 'granted';
    mirror.status = p === 'granted' ? 'ok' : 'needs-permission';
  } catch (e) {
    mirror.status = 'error';
    mirror.error = (e as Error).message;
  }
  if (mirror.status === 'ok') await writeAllNow();
}

export async function stopMirror(): Promise<void> {
  mirrorHandle = null;
  mirror.status = 'off';
  mirror.name = '';
  await kv.del('mirrorHandle');
}

/** Save a file where you choose when the browser allows it, otherwise as a download. */
export async function saveFileWithPicker(name: string, makeBlob: () => Promise<Blob>): Promise<string | null> {
  if (mirror.supported) {
    let h: FileHandle;
    try {
      h = await (window as unknown as { showSaveFilePicker: (o: object) => Promise<FileHandle> }).showSaveFilePicker({
        suggestedName: name,
        startIn: 'documents',
        types: PICKER_TYPES,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      h = null;
    }
    if (h) {
      const w = await h.createWritable();
      await w.write(await makeBlob());
      await w.close();
      return h.name ?? name;
    }
  }
  const blob = await makeBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'Downloads';
}

export async function init(): Promise<void> {
  try {
    header = (await kv.get<VaultHeader>('header')) ?? null;
  } catch {
    header = null;
  }
  app.phase = header ? 'locked' : 'welcome';
  app.bioOn = !!header?.bio;
  app.autoBio = app.bioOn;
  app.bioAvailable = await bioAvailable();
}

/** Turn on fingerprint unlock. The passphrase is asked again to prove it is you. */
export async function enableBio(passphrase: string): Promise<void> {
  if (!header) throw new Error('No vault on this device.');
  const dek = await unwrapWithPassphrase(header, passphrase, true);
  const salt = newPrfSalt();
  const { credentialId, prf } = await enrollBio(salt);
  header = await addBioWrap(header, dek, credentialId, salt, prf);
  await kv.set('header', header);
  app.bioOn = true;
  app.data?.audit.push({ at: new Date().toISOString(), action: 'fingerprint unlock turned on' });
  persist();
}

export async function disableBio(): Promise<void> {
  if (!header) return;
  const { bio: _removed, ...rest } = header;
  header = rest;
  await kv.set('header', header);
  app.bioOn = false;
  app.data?.audit.push({ at: new Date().toISOString(), action: 'fingerprint unlock turned off' });
  persist();
}

export async function unlockWithBio(): Promise<void> {
  if (!header?.bio) throw new Error('Fingerprint unlock is not set up.');
  app.busy = true;
  try {
    const prf = await evalPrf(fromB64(header.bio.credentialId), fromB64(header.bio.prfSalt));
    const k = await unwrapWithPrf(header, prf);
    await openWith(k);
  } finally {
    app.busy = false;
  }
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
  await writeMirror(blob);
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
  await loadMirror();
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
  app.bioOn = false;
  app.data = null;
  app.demo = false;
  mirrorHandle = null;
  mirror.status = 'off';
  mirror.name = '';
  await kv.clear();
  app.phase = 'welcome';
}

// Backups

export function backupName(): string {
  return `finanzas-backup-${todayIso()}.json`;
}

export async function backupFile(): Promise<{ name: string; blob: Blob }> {
  if (!key || !header || !app.data) throw new Error('Unlock first.');
  await flush();
  app.data.settings.lastBackupAt = new Date().toISOString();
  const encrypted = await encryptJson(key, $state.snapshot(app.data));
  await kv.set('data', encrypted);
  const json = JSON.stringify(makeBackup(header, encrypted));
  return { name: backupName(), blob: new Blob([json], { type: 'application/json' }) };
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
    app.bioOn = !!header.bio;
    key = k;
    app.data = data;
    app.demo = false;
    app.phase = 'ready';
    app.tab = 'home';
    data.audit.push({ at: new Date().toISOString(), action: 'restored from backup', detail: b.createdAt });
    persist();
    touch();
    await loadMirror();
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
