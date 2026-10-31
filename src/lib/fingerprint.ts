// Fingerprint (or any device biometric: Touch ID, Windows Hello, Android
// fingerprint) for the Locked Chats vault, via WebAuthn's platform
// authenticator. The biometric itself never leaves the device — the OS
// checks it and we only learn "verified" or not.
//
// A credential lives on ONE device, so each device registers its own. The
// ids go in vault_settings.fingerprint_credential_ids (so we know which are
// valid for this account), and this device remembers which one is its own
// in localStorage.

function toB64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const deviceKey = (userId: string) => `sweet_fingerprint_credential_${userId}`;

export function getDeviceFingerprintId(userId: string): string | null {
  try {
    return localStorage.getItem(deviceKey(userId));
  } catch {
    return null;
  }
}

// After the account stops listing this device's credential ("Remove from
// this device"). The OS-level passkey itself can only be deleted by the
// user in their device settings — the browser has no API for it.
export function forgetDeviceFingerprint(userId: string) {
  try {
    localStorage.removeItem(deviceKey(userId));
  } catch {
    // nothing stored
  }
}

export async function isFingerprintSupported(): Promise<boolean> {
  if (!window.PublicKeyCredential) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// Prompts for the fingerprint and creates this device's credential.
// Returns its id; throws if the user cancels or the device refuses.
export async function registerFingerprint(userId: string, displayName: string): Promise<string> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Sweet' },
      user: {
        id: new TextEncoder().encode(userId),
        name: displayName || 'Sweet user',
        displayName: displayName || 'Sweet user',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged',
      },
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error('Fingerprint registration was cancelled');
  const id = toB64url(credential.rawId);
  try {
    localStorage.setItem(deviceKey(userId), id);
  } catch {
    // Storage blocked — registration still worked, it just can't be
    // remembered for this device; verification will report "not set up".
  }
  return id;
}

// Prompts for the fingerprint against this device's credential. Resolves
// false on cancel/mismatch rather than throwing.
export async function verifyFingerprint(credentialId: string): Promise<boolean> {
  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: fromB64url(credentialId), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    if (!assertion) return false;

    // authenticatorData = 32-byte rpIdHash, then a flags byte; 0x04 is
    // "user verified" — i.e. the fingerprint/biometric actually matched,
    // not just "someone tapped the device".
    const authData = new Uint8Array((assertion.response as AuthenticatorAssertionResponse).authenticatorData);
    return (authData[32] & 0x04) !== 0;
  } catch (err) {
    console.warn('Fingerprint verification failed:', err);
    return false;
  }
}
