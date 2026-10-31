import type { User } from '@supabase/supabase-js';
import { getSavedMethods, type VaultSettings } from './vault';

// The App Lock — asked when Sweet opens, separate from the Locked Chats
// vault. Its settings live in the same owner-only vault_settings row:
// face_lock_enabled (on/off), app_lock_face, app_lock_fingerprint and the
// app's own backup password (app_password_hash/salt). Face and fingerprint
// registrations are shared with the vault; the password is not.
export type AppLockMethod = 'fingerprint' | 'face' | 'password';

export const APP_LOCK_LABELS: Record<AppLockMethod, { name: string; emoji: string }> = {
  fingerprint: { name: 'Fingerprint', emoji: '☝️' },
  face: { name: 'Face', emoji: '📸' },
  password: { name: 'App password', emoji: '🛡️' },
};

// The App Lock's ways in that work on THIS device, fastest first. The
// backup password works everywhere, which is what stops the App Lock from
// ever trapping someone on a device without a camera or sensor.
export function getAppLockMethods(
  vault: VaultSettings,
  faceDescriptor: number[] | null,
  deviceFingerprintId: string | null,
  cameraAvailable: boolean
): AppLockMethod[] {
  const saved = getSavedMethods(vault, faceDescriptor, deviceFingerprintId, cameraAvailable);
  const methods: AppLockMethod[] = [];
  if (vault.app_lock_fingerprint && saved.fingerprint === 'saved') methods.push('fingerprint');
  if (vault.app_lock_face && saved.face === 'saved') methods.push('face');
  if (vault.app_password_hash) methods.push('password');
  return methods;
}

// "Forgot your app password?" is only allowed right after a real sign-in:
// proving you own the account (email/Telegram login) is what earns a reset.
// Someone holding an already-unlocked phone can't do that without the
// account login itself — and with that, they could read the chats from any
// device anyway.
const FRESH_LOGIN_WINDOW_MS = 10 * 60 * 1000;

export function isFreshLogin(user: User | null): boolean {
  const signedInAt = user?.last_sign_in_at ? new Date(user.last_sign_in_at).getTime() : 0;
  return signedInAt > 0 && Date.now() - signedInAt < FRESH_LOGIN_WINDOW_MS;
}

export const MIN_APP_PASSWORD_LENGTH = 6;
