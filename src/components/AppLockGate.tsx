import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNotify } from '../contexts/NotificationContext';
import { getDeviceFingerprintId } from '../lib/fingerprint';
import {
  getLockoutRemaining,
  recordFailedAttempt,
  recordSuccessfulAttempt,
} from '../lib/vaultAttempts';
import { hashNewSecret, saveVault, secretFields, verifyVaultSecret } from '../lib/vault';
import {
  APP_LOCK_LABELS,
  getAppLockMethods,
  isFreshLogin,
  MIN_APP_PASSWORD_LENGTH,
  type AppLockMethod,
} from '../lib/appLock';
import { useCachedFace, useCameraAvailable, useVaultSettings } from '../hooks/useVaultSettings';
import { StrictLock } from './StrictLock';
import { VaultVerify } from './VaultVerify';
import { PasswordSetupSheet, styles } from './LockedChatsSettings';
import { DelayedSpinner, FingerprintPrompt, GateNotice, LockFooter, LockoutScreen } from './lockScreenParts';

interface AppLockGateProps {
  userId: string;
  onUnlock: () => void;
  // 'launch' = the lock when Sweet opens: nothing to cancel back to, so it
  // offers Sign out and "Forgot password?" instead.
  // 'settings' = guarding the Lock App Settings tab.
  purpose: 'launch' | 'settings';
  onCancel?: () => void;
  onSignOut?: () => void;
}

// The App Lock. Fingerprint first, then face, with the backup password
// always available as "Use another way" — so it works on every device.
export function AppLockGate({ userId, onUnlock, purpose, onCancel, onSignOut }: AppLockGateProps) {
  const { user } = useAuth();
  const { showError, showSuccess } = useNotify();
  const { vault, loadFailed } = useVaultSettings(userId);
  const [cachedFace] = useCachedFace(userId);
  const cameraAvailable = useCameraAvailable();
  const faceDescriptor = vault?.face_descriptor ?? cachedFace;
  const deviceFingerprintId = getDeviceFingerprintId(userId);
  const isLaunch = purpose === 'launch';

  // Its own failed-attempt counter, separate from the vault's.
  const [lockoutMs, setLockoutMs] = useState(() => getLockoutRemaining(userId, 'app'));
  const isLockedOut = lockoutMs > 0;
  useEffect(() => {
    if (!isLockedOut) return;
    const timer = setInterval(() => setLockoutMs(getLockoutRemaining(userId, 'app')), 1000);
    return () => clearInterval(timer);
  }, [isLockedOut, userId]);

  const reportFailure = () => {
    const attemptsLeft = recordFailedAttempt(userId, 'app');
    setLockoutMs(getLockoutRemaining(userId, 'app'));
    return attemptsLeft;
  };

  const handleVerified = () => {
    recordSuccessfulAttempt(userId, 'app');
    onUnlock();
  };

  const [chosenMethod, setChosenMethod] = useState<AppLockMethod | null>(null);
  // "Forgot password?" → 'reset' (just signed in: set a new one here) or
  // 'explain' (otherwise: sign out and back in first).
  const [forgot, setForgot] = useState<null | 'reset' | 'explain'>(null);
  const [savingReset, setSavingReset] = useState(false);

  const ready = !!vault && cameraAvailable !== null;
  const lockOn = !!vault?.face_lock_enabled;
  const methods = ready ? getAppLockMethods(vault!, faceDescriptor, deviceFingerprintId, cameraAvailable!) : [];
  // Lock off — or, in Settings, nothing usable at all (the account login is
  // the remaining protection, so let them in to fix it).
  const letThrough = ready && (!lockOn || (!isLaunch && methods.length === 0));
  const method = chosenMethod && methods.includes(chosenMethod) ? chosenMethod : methods[0] ?? null;

  useEffect(() => {
    if (letThrough) onUnlock();
  }, [letThrough]);

  async function saveNewPassword(password: string) {
    if (!vault) return;
    if (vault.password_hash && await verifyVaultSecret(userId, 'password', password, vault)) {
      showError('Pick a different password from your Locked Chats one 💗');
      return;
    }
    setSavingReset(true);
    try {
      const { hash, salt } = await hashNewSecret(password);
      await saveVault(userId, secretFields('app-password', hash, salt));
      showSuccess('New app password saved. Welcome back 💕');
      handleVerified();
    } catch (err) {
      console.error('App password reset failed:', err);
      showError("Oops, that didn't save. Check your connection and try again 💗");
    } finally {
      setSavingReset(false);
    }
  }

  // Sign out / forgot links, only at app start.
  const footerLinks = isLaunch ? (
    <>
      {vault?.app_password_hash && (
        <button
          onClick={() => setForgot(isFreshLogin(user) ? 'reset' : 'explain')}
          className="text-xs font-semibold text-pink-500 hover:text-pink-700"
        >
          Forgot app password?
        </button>
      )}
      {onSignOut && (
        <button onClick={onSignOut} className="text-xs font-semibold text-pink-300 hover:text-pink-500">
          Not you? Sign out
        </button>
      )}
    </>
  ) : null;

  if (!ready) {
    return loadFailed && !vault ? (
      <GateNotice
        theme="sweet"
        opaque={isLaunch}
        title="Couldn't load your App Lock"
        body="Sweet couldn't check your App Lock settings. Check your connection and reopen the app."
        onClose={isLaunch ? onSignOut : onCancel}
        closeLabel={isLaunch ? 'Sign out' : 'Got it'}
      />
    ) : (
      <DelayedSpinner opaque={isLaunch} />
    );
  }

  if (letThrough) return null;

  if (forgot === 'reset') {
    // Opaque cover: the app is already mounted underneath at launch.
    return (
      <div className="fixed inset-0 z-[9997] bg-[#FFF0F3]">
        <PasswordSetupSheet
          s={styles('sweet')}
          busy={savingReset}
          title="Set a new app password 🛡️"
          subtitle={`You just signed in, so you can choose a new one. At least ${MIN_APP_PASSWORD_LENGTH} characters, different from your Locked Chats password.`}
          cancelLabel="Back"
          onDone={saveNewPassword}
          onCancel={() => setForgot(null)}
          showError={showError}
        />
      </div>
    );
  }

  if (forgot === 'explain') {
    return (
      <>
        <GateNotice
          theme="sweet"
          opaque
          title="Forgot your app password?"
          body="Sign out, then sign back in to your account. Right after signing in, tap “Forgot app password?” again and you can choose a new one."
          onClose={onSignOut}
          closeLabel="Sign out"
        />
        <LockFooter options={[]} onPick={() => {}}>
          <button onClick={() => setForgot(null)} className="text-xs font-semibold text-pink-500 hover:text-pink-700">
            Back
          </button>
        </LockFooter>
      </>
    );
  }

  if (isLockedOut) {
    return (
      <>
        <LockoutScreen
          remainingMs={lockoutMs}
          message="Sweet is paused for a moment to keep your chats safe. Try again in"
          onCancel={isLaunch ? undefined : onCancel}
        />
        {isLaunch && <LockFooter options={[]} onPick={() => {}}>{footerLinks}</LockFooter>}
      </>
    );
  }

  if (!method) {
    // Launch only (Settings lets through): App Lock on, but nothing usable
    // here — e.g. no password saved and no camera/sensor on this device.
    return (
      <>
        <GateNotice
          theme="sweet"
          opaque
          title="Can't unlock on this device"
          body="Your App Lock has no way to unlock on this device. Sign out and back in, then set an app password to get back in."
        />
        <LockFooter options={[]} onPick={() => {}}>{footerLinks}</LockFooter>
      </>
    );
  }

  let prompt;
  if (method === 'fingerprint' && deviceFingerprintId) {
    prompt = (
      <FingerprintPrompt
        key="fingerprint"
        title="Unlock Sweet"
        credentialId={deviceFingerprintId}
        onUnlock={handleVerified}
        onFailedAttempt={reportFailure}
        onCancel={isLaunch ? undefined : onCancel}
      />
    );
  } else if (method === 'face' && faceDescriptor) {
    prompt = (
      <StrictLock
        key="face"
        mode="verify"
        userId={userId}
        savedDescriptor={faceDescriptor}
        onSaveDescriptor={async () => {}} // not used in verify mode
        onUnlock={handleVerified}
        onMismatch={reportFailure}
        onCancel={isLaunch ? undefined : onCancel}
      />
    );
  } else {
    prompt = (
      <VaultVerify
        key="password"
        mode="app-password"
        userId={userId}
        vault={vault!}
        onUnlock={handleVerified}
        onFailedAttempt={reportFailure}
        onCancel={isLaunch ? undefined : onCancel}
      />
    );
  }

  return (
    <>
      {prompt}
      <LockFooter
        options={methods
          .filter((m) => m !== method)
          .map((m) => ({ key: m, label: `${APP_LOCK_LABELS[m].emoji} ${APP_LOCK_LABELS[m].name}` }))}
        onPick={(key) => setChosenMethod(key as AppLockMethod)}
      >
        {footerLinks}
      </LockFooter>
    </>
  );
}
