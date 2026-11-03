// Fingerprint unlock with a passkey (WebAuthn) and its PRF extension.
// On Android, passkeys saved in Google Password Manager support PRF.

export class BioUnsupportedError extends Error {
  constructor() {
    super("This phone's passkey storage cannot provide the secret needed to unlock encrypted data.");
  }
}

function random(n: number): Uint8Array<ArrayBuffer> {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

export async function bioAvailable(): Promise<boolean> {
  try {
    if (!window.isSecureContext || !window.PublicKeyCredential) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

interface PrfResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
}

/** Ask the passkey for its secret for this salt. Shows the fingerprint prompt. */
export async function evalPrf(credentialId: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: credentialId }],
      userVerification: 'required',
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Cancelled');
  const out = (cred.getClientExtensionResults() as PrfResults).prf?.results?.first;
  if (!out) throw new BioUnsupportedError();
  return out;
}

/** Create a passkey for this app and get its secret. Shows the fingerprint prompt (once or twice). */
export async function enrollBio(salt: Uint8Array<ArrayBuffer>): Promise<{ credentialId: Uint8Array<ArrayBuffer>; prf: ArrayBuffer }> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      rp: { name: 'Finanzas', id: location.hostname },
      user: { id: random(16), name: 'Finanzas unlock', displayName: 'Finanzas unlock' },
      challenge: random(32),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      attestation: 'none',
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Cancelled');
  const credentialId = new Uint8Array(cred.rawId);
  const ext = cred.getClientExtensionResults() as PrfResults;
  if (ext.prf?.enabled === false) throw new BioUnsupportedError();
  const prf = ext.prf?.results?.first ?? (await evalPrf(credentialId, salt));
  return { credentialId, prf };
}
