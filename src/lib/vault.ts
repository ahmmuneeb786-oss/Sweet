import { supabase } from './supabase';
import { localDB, type LocalVault } from '../db';
import { hashSecret, legacyHashSecret, newSalt } from './secureHash';

// Everything vault/lock related lives in vault_settings, NOT profiles —
// profiles is readable by everyone, and this table is owner-only (RLS).
export type VaultSettings = Omit<LocalVault, 'user_id' | 'cached_at'>;
export type VaultMethod = 'pin' | 'password' | 'face' | 'fingerprint';
export const VAULT_METHODS: VaultMethod[] = ['pin', 'password', 'face', 'fingerprint'];

export const VAULT_METHOD_LABELS: Record<VaultMethod, { name: string; emoji: string }> = {
  pin: { name: 'PIN', emoji: '🔢' },
  password: { name: 'Password', emoji: '🔏' },
  face: { name: 'Face', emoji: '📸' },
  fingerprint: { name: 'Fingerprint', emoji: '☝️' },
};

export const DEFAULT_VAULT: VaultSettings = {
  chat_security_type: 'none',
  allow_other_methods: false,
  pin_hash: null,
  pin_salt: null,
  password_hash: null,
  password_salt: null,
  face_descriptor: null,
  face_lock_enabled: false,
  app_lock_face: false,
  app_lock_fingerprint: false,
  app_password_hash: null,
  app_password_salt: null,
  fingerprint_credential_ids: [],
};

const COLUMNS =
  'chat_security_type, allow_other_methods, pin_hash, pin_salt, password_hash, password_salt, face_descriptor, face_lock_enabled, app_lock_face, app_lock_fingerprint, app_password_hash, app_password_salt, fingerprint_credential_ids';

// Rows written before the multi-lock update stored face/fingerprint as
// 'biometric' + a separate chat_biometric_type. The SQL migration converts
// them on the server, but a device copy cached earlier can still hold the
// old shape — read it as the new one, and fill any missing column.
function normalizeVault(raw: Record<string, unknown> | null | undefined): VaultSettings {
  const vault = { ...DEFAULT_VAULT, ...(raw ?? {}) } as VaultSettings & { chat_biometric_type?: string | null };
  if ((vault.chat_security_type as string) === 'biometric') {
    vault.chat_security_type = vault.chat_biometric_type === 'fingerprint' ? 'fingerprint' : 'face';
  }
  delete vault.chat_biometric_type;
  return vault;
}

// Which locks this account has saved, and whether each one can actually be
// used on THIS device. 'saved' = saved AND usable here. PIN/password work
// anywhere; face needs a camera ('no-camera' otherwise); a fingerprint only
// works on the device that registered it ('other-device' otherwise).
export type SavedState = 'saved' | 'other-device' | 'no-camera' | 'not-saved';

export function getSavedMethods(
  vault: VaultSettings,
  faceDescriptor: number[] | null,
  deviceFingerprintId: string | null,
  cameraAvailable: boolean
): Record<VaultMethod, SavedState> {
  const fingerprintIds = vault.fingerprint_credential_ids;
  const faceSaved = !!faceDescriptor && faceDescriptor.length > 0;
  return {
    pin: vault.pin_hash ? 'saved' : 'not-saved',
    password: vault.password_hash ? 'saved' : 'not-saved',
    face: !faceSaved ? 'not-saved' : cameraAvailable ? 'saved' : 'no-camera',
    fingerprint: deviceFingerprintId && fingerprintIds.includes(deviceFingerprintId)
      ? 'saved'
      : fingerprintIds.length > 0 ? 'other-device' : 'not-saved',
  };
}

// Settings, the locked-chats panel and the app lock in App.tsx each hold
// their own copy of these values; this keeps every mounted copy in step
// with the latest save/fetch instead of waiting for a reload.
type VaultListener = (userId: string, vault: VaultSettings) => void;
const listeners = new Set<VaultListener>();

export function onVaultChange(cb: VaultListener) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// Last-known settings in memory, so a gate opening mid-session knows them
// on its very first render instead of flashing a loading screen while it
// reads the device copy (e.g. "Unprotected" → straight through, no blink).
const memoryVault = new Map<string, VaultSettings>();

export function peekVault(userId: string): VaultSettings | null {
  return memoryVault.get(userId) ?? null;
}

async function cacheVault(userId: string, vault: VaultSettings) {
  memoryVault.set(userId, vault);
  await localDB.vault.put({ user_id: userId, ...vault, cached_at: new Date().toISOString() });
  // The app lock reads face data from its own cache — keep it in step.
  await localDB.saveFaceLockDataLocally(userId, vault.face_descriptor, vault.face_lock_enabled);
  listeners.forEach((cb) => cb(userId, vault));
}

export async function getCachedVault(userId: string): Promise<VaultSettings | null> {
  const cached = await localDB.vault.get(userId);
  if (!cached) return null;
  const { user_id: _u, cached_at: _c, ...rest } = cached;
  const vault = normalizeVault(rest);
  if (!memoryVault.has(userId)) memoryVault.set(userId, vault);
  return vault;
}

// Fresh from the server, falling back to the device copy when offline.
// No row on the server just means the user never configured anything.
// Throws only when there's neither a server answer nor a cached copy.
export async function fetchVault(userId: string): Promise<VaultSettings> {
  try {
    const { data, error } = await supabase
      .from('vault_settings')
      .select(COLUMNS)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;

    const vault = normalizeVault(data);
    await cacheVault(userId, vault);
    return vault;
  } catch (err) {
    const cached = await getCachedVault(userId);
    if (cached) return cached;
    throw err;
  }
}

// Writes go to the server first; the device copy only changes once the
// server has accepted it, so the two can't silently disagree.
export async function saveVault(userId: string, updates: Partial<VaultSettings>): Promise<VaultSettings> {
  const { data, error } = await supabase
    .from('vault_settings')
    .upsert({ user_id: userId, ...updates, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select(COLUMNS)
    .single();
  if (error) throw error;

  const vault = normalizeVault(data);
  await cacheVault(userId, vault);
  return vault;
}

// One-shot pass from the Locked Chats panel (which verifies before opening)
// to ChatWindow (which verifies any locked chat it shows) — so a chat opened
// from the vault isn't asked for the PIN twice. Single-use and short-lived,
// so it can't be replayed later to open the chat without verifying.
const GRANT_TTL_MS = 10_000;
const chatGrants = new Map<string, number>();

export function grantChatAccess(chatId: string) {
  chatGrants.set(chatId, Date.now());
}

export function consumeChatAccess(chatId: string): boolean {
  const grantedAt = chatGrants.get(chatId);
  chatGrants.delete(chatId);
  return grantedAt !== undefined && Date.now() - grantedAt < GRANT_TTL_MS;
}

export async function hashNewSecret(value: string): Promise<{ hash: string; salt: string }> {
  const salt = newSalt();
  return { hash: await hashSecret(value, salt), salt };
}

// The three typed secrets: the vault PIN and password, and the App Lock's
// own backup password (deliberately separate from the vault one).
export type SecretKind = 'pin' | 'password' | 'app-password';

function storedSecret(vault: VaultSettings, kind: SecretKind) {
  if (kind === 'pin') return { hash: vault.pin_hash, salt: vault.pin_salt };
  if (kind === 'password') return { hash: vault.password_hash, salt: vault.password_salt };
  return { hash: vault.app_password_hash, salt: vault.app_password_salt };
}

export function secretFields(kind: SecretKind, hash: string | null, salt: string | null): Partial<VaultSettings> {
  if (kind === 'pin') return { pin_hash: hash, pin_salt: salt };
  if (kind === 'password') return { password_hash: hash, password_salt: salt };
  return { app_password_hash: hash, app_password_salt: salt };
}

export async function verifyVaultSecret(
  userId: string,
  mode: SecretKind,
  candidate: string,
  vault: VaultSettings
): Promise<boolean> {
  const { hash: storedHash, salt: storedSalt } = storedSecret(vault, mode);
  if (!storedHash) return false;

  if (storedSalt) {
    return (await hashSecret(candidate, storedSalt)) === storedHash;
  }

  // No salt = saved with the old SHA-256 scheme. On a correct entry,
  // quietly upgrade it — failure (e.g. offline) just means it tries again
  // next unlock.
  const ok = (await legacyHashSecret(candidate, userId)) === storedHash;
  if (ok) {
    hashNewSecret(candidate)
      .then(({ hash, salt }) =>
        saveVault(userId, secretFields(mode, hash, salt))
      )
      .catch((err) => console.warn('Vault secret upgrade deferred:', err));
  }
  return ok;
}
