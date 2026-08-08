// Small helper so vault PINs/passwords are never stored or compared in
// plaintext. Salted with the user's own id so two different people using
// the same PIN don't produce identical stored values.
export async function hashSecret(value: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${value}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}