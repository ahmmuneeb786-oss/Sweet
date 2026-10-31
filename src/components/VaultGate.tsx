import { useState, useEffect } from 'react';
import { getDeviceFingerprintId } from '../lib/fingerprint';
import {
  getLockoutRemaining,
  recordFailedAttempt,
  recordSuccessfulAttempt,
} from '../lib/vaultAttempts';
import { getSavedMethods, VAULT_METHOD_LABELS, VAULT_METHODS, type VaultMethod } from '../lib/vault';
import { useCachedFace, useCameraAvailable, useVaultSettings } from '../hooks/useVaultSettings';
import { StrictLock } from './StrictLock';
import { VaultVerify } from './VaultVerify';
import { DelayedSpinner, FingerprintPrompt, GateNotice, LockFooter, LockoutScreen } from './lockScreenParts';

interface VaultGateProps {
  theme: 'light' | 'dark' | 'sweet';
  userId: string;
  onUnlock: () => void;
  onCancel: () => void;
  // 'settings' = guarding the Locked Chats settings themselves. If the main
  // lock can't run here (no camera, fingerprint on another device), any
  // other saved lock is accepted, and with none at all the screen opens —
  // otherwise there'd be no way to reach the fix.
  purpose?: 'chat' | 'settings';
}

// The one place the vault gets verified (PIN / password / face /
// fingerprint). ChatWindow renders this for ANY locked chat, however it was
// opened, and Settings renders it before the Locked Chats settings — so
// there's no path that skips it.
export function VaultGate({ theme, userId, onUnlock, onCancel, purpose = 'chat' }: VaultGateProps) {
  const { vault, loadFailed } = useVaultSettings(userId);
  const [cachedFace] = useCachedFace(userId);
  const cameraAvailable = useCameraAvailable();
  const faceDescriptor = vault?.face_descriptor ?? cachedFace;
  const deviceFingerprintId = getDeviceFingerprintId(userId);

  // Shared failed-attempt limit for every method (see lib/vaultAttempts).
  // While locked out, the lockout screen replaces whichever prompt was up.
  const [lockoutMs, setLockoutMs] = useState(() => getLockoutRemaining(userId));
  const isLockedOut = lockoutMs > 0;
  useEffect(() => {
    if (!isLockedOut) return;
    const timer = setInterval(() => setLockoutMs(getLockoutRemaining(userId)), 1000);
    return () => clearInterval(timer);
  }, [isLockedOut, userId]);

  // Returns tries left before the next lockout, for the prompt's message.
  const reportFailure = () => {
    const attemptsLeft = recordFailedAttempt(userId);
    setLockoutMs(getLockoutRemaining(userId));
    return attemptsLeft;
  };

  const handleVerified = () => {
    recordSuccessfulAttempt(userId);
    onUnlock();
  };

  // Lock picked with "Use another way" — null = start with the main lock.
  const [chosenMethod, setChosenMethod] = useState<VaultMethod | null>(null);

  // Which locks may be used here (main first), or why none can.
  let allowed: VaultMethod[] = [];
  let blocked: 'let-through' | 'fingerprint-elsewhere' | 'no-camera' | 'incomplete' | null = null;
  const ready = !!vault && cameraAvailable !== null;
  if (vault && cameraAvailable !== null) {
    const saved = getSavedMethods(vault, faceDescriptor, deviceFingerprintId, cameraAvailable);
    if (vault.chat_security_type === 'none') {
      // User explicitly chose no lock for the vault — respect that.
      blocked = 'let-through';
    } else {
      const main = vault.chat_security_type;
      const mainUsable = saved[main] === 'saved';
      const others = VAULT_METHODS.filter((m) => m !== main && saved[m] === 'saved');
      // Other saved locks count when the user allowed them — and in Settings
      // when the main lock can't run on this device (no camera, fingerprint
      // registered elsewhere), so the screen that fixes it is never a dead
      // end. NOT always in Settings: then an old PIN the user stopped trusting
      // (backups switched off) could still open Settings and turn the lock off.
      const useOthers = vault.allow_other_methods || (purpose === 'settings' && !mainUsable);
      allowed = [...(mainUsable ? [main] : []), ...(useOthers ? others : [])];

      if (allowed.length === 0) {
        // In Settings with nothing usable at all, the account login is the
        // remaining protection — let them in to set a lock up.
        blocked = purpose === 'settings'
          ? 'let-through'
          : saved[main] === 'other-device' ? 'fingerprint-elsewhere'
          : saved[main] === 'no-camera' ? 'no-camera'
          : 'incomplete';
      }
    }
  }
  const method = chosenMethod && allowed.includes(chosenMethod) ? chosenMethod : allowed[0] ?? null;
  const letThrough = blocked === 'let-through';

  useEffect(() => {
    if (letThrough) onUnlock();
  }, [letThrough]);

  if (!ready) {
    // Until we know the user's settings we can't tell whether a PIN is
    // required — never fall through to "no lock" and show the chat.
    return loadFailed ? (
      <GateNotice
        theme={theme}
        title="Couldn't load your vault settings"
        body="Your locked chats' security settings couldn't be loaded. Check your connection and try again."
        onClose={onCancel}
      />
    ) : (
      <DelayedSpinner />
    );
  }

  if (letThrough) return null;

  if (isLockedOut) {
    return (
      <LockoutScreen
        remainingMs={lockoutMs}
        message="Your locked chats are paused for a moment. Try again in"
        onCancel={onCancel}
      />
    );
  }

  if (blocked === 'fingerprint-elsewhere') {
    return (
      <GateNotice
        theme={theme}
        title="Fingerprint isn't set up on this device"
        body="Your locked chats use fingerprint unlock, but it was set up on a different device. Go to Settings → Locked Chats and add this device under Fingerprint."
        onClose={onCancel}
      />
    );
  }

  if (blocked === 'no-camera') {
    return (
      <GateNotice
        theme={theme}
        title="This device has no camera"
        body="Your locked chats unlock with your face, but there's no camera here. Go to Settings → Locked Chats to pick another main lock, or turn on 'Let me unlock with my other saved locks too'."
        onClose={onCancel}
      />
    );
  }

  if (blocked === 'incomplete' || !method) {
    // Main lock chosen but its secret was never saved (e.g. an interrupted
    // setup) — don't silently let them in or silently fail.
    return (
      <GateNotice
        theme={theme}
        title="Security setup looks incomplete"
        body="Your vault's main lock isn't fully set up yet. Go to Settings → Locked Chats and set it up again."
        onClose={onCancel}
      />
    );
  }

  // key: switching lock remounts the prompt fresh (and stops the camera).
  let prompt;
  if (method === 'fingerprint' && deviceFingerprintId) {
    prompt = (
      <FingerprintPrompt
        key="fingerprint"
        title="Vault Fingerprint"
        credentialId={deviceFingerprintId}
        onUnlock={handleVerified}
        onFailedAttempt={reportFailure}
        onCancel={onCancel}
      />
    );
  } else if (method === 'face' && faceDescriptor) {
    // Reuse the same registered face as the app lock — one registration,
    // both places, rather than a second separate enrollment flow.
    prompt = (
      <StrictLock
        key="face"
        mode="verify"
        userId={userId}
        savedDescriptor={faceDescriptor}
        onSaveDescriptor={async () => {}} // not used in verify mode
        onUnlock={handleVerified}
        onMismatch={reportFailure}
        onCancel={onCancel}
      />
    );
  } else {
    prompt = (
      <VaultVerify
        key={method}
        mode={method === 'password' ? 'password' : 'pin'}
        userId={userId}
        vault={vault!}
        onUnlock={handleVerified}
        onFailedAttempt={reportFailure}
        onCancel={onCancel}
      />
    );
  }

  return (
    <>
      {prompt}
      <LockFooter
        options={allowed
          .filter((m) => m !== method)
          .map((m) => ({ key: m, label: `${VAULT_METHOD_LABELS[m].emoji} ${VAULT_METHOD_LABELS[m].name}` }))}
        onPick={(key) => setChosenMethod(key as VaultMethod)}
      />
    </>
  );
}
