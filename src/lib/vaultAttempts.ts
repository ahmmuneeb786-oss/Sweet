// Failed-unlock limiter for the Locked Chats vault. One counter per user,
// shared by every method (PIN, password, fingerprint, face) so switching
// method can't reset it, and kept in localStorage so a reload can't either.
//
// A 4-digit PIN has 10,000 combinations; without this, all of them can be
// tried in one sitting. After FREE_ATTEMPTS failures each further failure
// locks the vault for the next, longer step. A correct unlock resets it.
//
// The App Lock keeps its own separate counter (scope 'app'): a run of
// wrong tries at app start shouldn't also pause the vault, or vice versa.
//
// This is a device-side limit — it stops someone guessing through the app,
// not someone with developer tools clearing site storage.

const FREE_ATTEMPTS = 5;
const LOCKOUT_STEPS_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

interface AttemptState {
  failures: number;
  lockedUntil: number;
}

export type AttemptScope = 'vault' | 'app';

// Fallback when localStorage is blocked (private mode etc.) — still limits
// within the session.
const memory = new Map<string, AttemptState>();
// The vault keeps its original key so counts saved before scopes existed still apply.
const storageKey = (userId: string, scope: AttemptScope) =>
  scope === 'vault' ? `sweet_vault_attempts_${userId}` : `sweet_app_lock_attempts_${userId}`;

function read(userId: string, scope: AttemptScope): AttemptState {
  try {
    const raw = localStorage.getItem(storageKey(userId, scope));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.failures === 'number' && typeof parsed?.lockedUntil === 'number') return parsed;
    }
  } catch {
    // fall through to memory
  }
  return memory.get(storageKey(userId, scope)) ?? { failures: 0, lockedUntil: 0 };
}

function write(userId: string, scope: AttemptScope, state: AttemptState) {
  memory.set(storageKey(userId, scope), state);
  try {
    localStorage.setItem(storageKey(userId, scope), JSON.stringify(state));
  } catch {
    // memory copy still applies
  }
}

export function getLockoutRemaining(userId: string, scope: AttemptScope = 'vault'): number {
  return Math.max(0, read(userId, scope).lockedUntil - Date.now());
}

// Returns how many tries are left before the next lockout (0 = locked now).
export function recordFailedAttempt(userId: string, scope: AttemptScope = 'vault'): number {
  const state = read(userId, scope);
  const failures = state.failures + 1;
  if (failures < FREE_ATTEMPTS) {
    write(userId, scope, { failures, lockedUntil: 0 });
    return FREE_ATTEMPTS - failures;
  }
  const step = LOCKOUT_STEPS_MS[Math.min(failures - FREE_ATTEMPTS, LOCKOUT_STEPS_MS.length - 1)];
  write(userId, scope, { failures, lockedUntil: Date.now() + step });
  return 0;
}

export function recordSuccessfulAttempt(userId: string, scope: AttemptScope = 'vault') {
  memory.delete(storageKey(userId, scope));
  try {
    localStorage.removeItem(storageKey(userId, scope));
  } catch {
    // nothing to clear
  }
}

export function attemptsLeftText(attemptsLeft: number): string {
  if (attemptsLeft <= 0) return '';
  return attemptsLeft === 1 ? '1 try left before a lockout.' : `${attemptsLeft} tries left before a lockout.`;
}

export function formatLockout(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
