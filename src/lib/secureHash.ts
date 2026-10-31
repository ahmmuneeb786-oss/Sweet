// Vault PINs/passwords are never stored or compared in plaintext.
//
// PBKDF2 with a random per-user salt: a 4-digit PIN only has 10,000
// possibilities, so the hash has to be deliberately slow to make guessing
// expensive. 200k iterations is ~0.2-1s on a phone — fine for a one-off
// unlock, painful for someone trying all 10,000.
const PBKDF2_ITERATIONS = 200_000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function newSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashSecret(value: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(value),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: PBKDF2_ITERATIONS },
    key,
    256
  );
  return toHex(new Uint8Array(bits));
}

// The old scheme: one SHA-256 pass salted with the (public) user id. Only
// kept so secrets saved before the switch still verify — they get re-hashed
// with hashSecret() the first time they're entered correctly.
export async function legacyHashSecret(value: string, userId: string): Promise<string> {
  const data = new TextEncoder().encode(`${userId}:${value}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}
