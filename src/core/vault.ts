// Encryption of the whole dataset with the browser's built in WebCrypto.
//
// A random 256 bit data key encrypts the data (AES GCM). That data key is itself stored twice,
// wrapped by a key derived from your passphrase (PBKDF2, 600 000 iterations) and wrapped by a
// key derived from your printed recovery key (HKDF). Either one can unlock the vault.

const PBKDF2_ITERATIONS = 600_000;
const AAD = new TextEncoder().encode('finanzas-vault-v1');

export interface Wrapped {
  iv: string;
  ct: string;
}

export interface BioWrap {
  credentialId: string; // passkey used for fingerprint unlock
  prfSalt: string; // input given to the passkey's PRF extension
  wrapped: Wrapped; // data key wrapped by a key derived from the passkey's secret
  createdAt: string;
}

export interface VaultHeader {
  format: 'finanzas-vault';
  v: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string };
  pass: Wrapped;
  recovery: { salt: string; wrapped: Wrapped };
  bio?: BioWrap;
  createdAt: string;
}

export interface EncryptedBlob {
  iv: string;
  ct: string;
  gz: boolean;
}

export interface BackupFile {
  format: 'finanzas-backup';
  v: 1;
  createdAt: string;
  header: VaultHeader;
  data: EncryptedBlob;
}

export class WrongKeyError extends Error {
  constructor() {
    super('Wrong passphrase or recovery key.');
  }
}

const subtle = () => globalThis.crypto.subtle;

export function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function random(n: number): Uint8Array<ArrayBuffer> {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

// Crockford base 32, without ambiguous letters
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function formatRecoveryKey(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join(' ');
}

export function normalizeRecoveryKey(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

async function passKek(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

async function recoveryKek(recovery: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', new TextEncoder().encode(normalizeRecoveryKey(recovery)), 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('finanzas-recovery') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

async function wrap(dek: CryptoKey, kek: CryptoKey): Promise<Wrapped> {
  const iv = random(12);
  const ct = await subtle().wrapKey('raw', dek, kek, { name: 'AES-GCM', iv, additionalData: AAD });
  return { iv: toB64(iv), ct: toB64(ct) };
}

async function unwrap(w: Wrapped, kek: CryptoKey, extractable = false): Promise<CryptoKey> {
  try {
    return await subtle().unwrapKey(
      'raw',
      fromB64(w.ct),
      kek,
      { name: 'AES-GCM', iv: fromB64(w.iv), additionalData: AAD },
      { name: 'AES-GCM', length: 256 },
      extractable,
      ['encrypt', 'decrypt'],
    );
  } catch {
    throw new WrongKeyError();
  }
}

// Fingerprint unlock: the phone's passkey returns a secret (WebAuthn PRF extension) only after
// your fingerprint or screen lock. That secret derives a key that wraps the data key, like the
// passphrase does. Without the passkey there is nothing in the app that can open the data.

async function prfKek(prfOutput: ArrayBuffer | Uint8Array, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const raw = prfOutput instanceof Uint8Array ? prfOutput : new Uint8Array(prfOutput);
  const base = await subtle().importKey('raw', new Uint8Array(raw), 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('finanzas-fingerprint') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

export async function addBioWrap(
  header: VaultHeader,
  extractableDek: CryptoKey,
  credentialId: Uint8Array,
  prfSalt: Uint8Array<ArrayBuffer>,
  prfOutput: ArrayBuffer | Uint8Array,
): Promise<VaultHeader> {
  return {
    ...header,
    bio: {
      credentialId: toB64(credentialId),
      prfSalt: toB64(prfSalt),
      wrapped: await wrap(extractableDek, await prfKek(prfOutput, prfSalt)),
      createdAt: new Date().toISOString(),
    },
  };
}

export async function unwrapWithPrf(header: VaultHeader, prfOutput: ArrayBuffer | Uint8Array): Promise<CryptoKey> {
  if (!header.bio) throw new WrongKeyError();
  return unwrap(header.bio.wrapped, await prfKek(prfOutput, fromB64(header.bio.prfSalt)));
}

export function newPrfSalt(): Uint8Array<ArrayBuffer> {
  return random(32);
}

export interface NewVault {
  header: VaultHeader;
  key: CryptoKey;
  recoveryKey: string;
}

export async function createVault(passphrase: string, iterations = PBKDF2_ITERATIONS): Promise<NewVault> {
  const dek = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const salt = random(16);
  const rsalt = random(16);
  const recoveryKey = formatRecoveryKey(random(20));
  const header: VaultHeader = {
    format: 'finanzas-vault',
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toB64(salt) },
    pass: await wrap(dek, await passKek(passphrase, salt, iterations)),
    recovery: { salt: toB64(rsalt), wrapped: await wrap(dek, await recoveryKek(recoveryKey, rsalt)) },
    createdAt: new Date().toISOString(),
  };
  // Runtime copy of the key that cannot be exported
  const key = await unwrapWithPassphrase(header, passphrase);
  return { header, key, recoveryKey };
}

export async function unwrapWithPassphrase(header: VaultHeader, passphrase: string, extractable = false): Promise<CryptoKey> {
  const kek = await passKek(passphrase, fromB64(header.kdf.salt), header.kdf.iterations);
  return unwrap(header.pass, kek, extractable);
}

export async function unwrapWithRecovery(header: VaultHeader, recoveryKey: string, extractable = false): Promise<CryptoKey> {
  const kek = await recoveryKek(recoveryKey, fromB64(header.recovery.salt));
  return unwrap(header.recovery.wrapped, kek, extractable);
}

/** Set a new passphrase, proving knowledge of the current passphrase or of the recovery key. */
export async function setNewPassphrase(
  header: VaultHeader,
  proof: { passphrase?: string; recoveryKey?: string },
  newPassphrase: string,
): Promise<VaultHeader> {
  const dek = proof.passphrase !== undefined
    ? await unwrapWithPassphrase(header, proof.passphrase, true)
    : await unwrapWithRecovery(header, proof.recoveryKey ?? '', true);
  const salt = random(16);
  return {
    ...header,
    kdf: { ...header.kdf, salt: toB64(salt) },
    pass: await wrap(dek, await passKek(newPassphrase, salt, header.kdf.iterations)),
  };
}

async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<EncryptedBlob> {
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const canZip = typeof CompressionStream !== 'undefined';
  const payload = canZip ? await gzip(plain) : plain;
  const iv = random(12);
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, payload);
  return { iv: toB64(iv), ct: toB64(ct), gz: canZip };
}

export async function decryptJson<T>(key: CryptoKey, blob: EncryptedBlob): Promise<T> {
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(blob.iv), additionalData: AAD }, key, fromB64(blob.ct));
  } catch {
    throw new WrongKeyError();
  }
  const bytes = blob.gz ? await gunzip(new Uint8Array(plain)) : new Uint8Array(plain);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export function makeBackup(header: VaultHeader, data: EncryptedBlob): BackupFile {
  return { format: 'finanzas-backup', v: 1, createdAt: new Date().toISOString(), header, data };
}

export function parseBackup(text: string): BackupFile {
  let obj: BackupFile;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('This is not a backup file from this app.');
  }
  if (obj?.format !== 'finanzas-backup' || obj.v !== 1 || !obj.header || !obj.data) {
    throw new Error('This is not a backup file from this app.');
  }
  return obj;
}
