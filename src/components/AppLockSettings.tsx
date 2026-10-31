import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, Fingerprint } from 'lucide-react';
import { StrictLock } from './StrictLock';
import { useNotify } from '../contexts/NotificationContext';
import { useConfirm } from '../contexts/ConfirmContext';
import {
  getSavedMethods,
  hashNewSecret,
  peekVault,
  saveVault,
  secretFields,
  verifyVaultSecret,
  type VaultSettings,
} from '../lib/vault';
import { getDeviceFingerprintId, isFingerprintSupported, registerFingerprint, verifyFingerprint } from '../lib/fingerprint';
import { MIN_APP_PASSWORD_LENGTH } from '../lib/appLock';
import { useCachedFace, useCameraAvailable, useVaultSettings } from '../hooks/useVaultSettings';
import { LockCard, PasswordSetupSheet, SheetFrame, styles, type Styles, type Theme } from './LockedChatsSettings';

interface AppLockSettingsProps {
  theme: Theme;
  userId: string;
  displayName: string;
  onBack: () => void;
}

// Turning App Lock on walks through these, skipping what the device can't
// do. The password is required; fingerprint is strongly encouraged; face
// is optional.
type WizardStep = 'password' | 'fingerprint' | 'face';

// Settings → Lock App Settings.
export function AppLockSettings({ theme, userId, displayName, onBack }: AppLockSettingsProps) {
  const { showSuccess, showError, showInfo } = useNotify();
  const confirm = useConfirm();
  const s = styles(theme);

  const { vault } = useVaultSettings(userId);
  const [cachedFace] = useCachedFace(userId);
  const cameraAvailable = useCameraAvailable();
  const [fingerprintSupported, setFingerprintSupported] = useState<boolean | null>(null);
  useEffect(() => {
    isFingerprintSupported().then(setFingerprintSupported);
  }, []);

  const [busy, setBusy] = useState(false);
  // Turning App Lock on: the current step, or null when not in the flow.
  const [wizard, setWizard] = useState<WizardStep | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  // Face registration scanner; `then` = what to do after it saves.
  const [faceScan, setFaceScan] = useState<null | { then: 'finish' | 'close' }>(null);

  if (!vault || cameraAvailable === null || fingerprintSupported === null) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-6 h-6 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const deviceFingerprintId = getDeviceFingerprintId(userId);
  const saved = getSavedMethods(vault, vault.face_descriptor ?? cachedFace, deviceFingerprintId, cameraAvailable);
  const faceSaved = saved.face === 'saved' || saved.face === 'no-camera';
  const lockOn = vault.face_lock_enabled;
  const fingerprintHere = saved.fingerprint === 'saved';

  async function save(updates: Partial<VaultSettings>, success?: string): Promise<boolean> {
    setBusy(true);
    try {
      await saveVault(userId, updates);
      if (success) showSuccess(success);
      return true;
    } catch (err) {
      console.error('App Lock save failed:', err);
      showError("Oops, that didn't save. Check your connection and try again 💗");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // ── Turning App Lock on ────────────────────────────────────────────────────
  // Steps run across several saves, so read the latest saved settings
  // (peekVault) rather than this render's copy, which lags one save behind.
  const latest = () => peekVault(userId) ?? vault!;

  function nextStep(after: WizardStep | null) {
    const order: WizardStep[] = ['password', 'fingerprint', 'face'];
    const remaining = after ? order.slice(order.indexOf(after) + 1) : order;
    const current = latest();
    const step = remaining.find((st) =>
      st === 'password' ? !current.app_password_hash
      : st === 'fingerprint' ? fingerprintSupported && !current.app_lock_fingerprint
      : cameraAvailable && !current.app_lock_face
    );
    if (step) setWizard(step);
    else finishTurningOn();
  }

  async function finishTurningOn() {
    setWizard(null);
    // Re-checked against the saved state: never switch on without a password.
    if (!latest().app_password_hash) {
      setWizard('password');
      return;
    }
    await save({ face_lock_enabled: true }, 'App Lock is on. Sweet is all yours 🛡️');
  }

  async function turnOff() {
    const ok = await confirm({
      title: 'Turn off App Lock?',
      message: 'Sweet will open without asking for anything. Your saved password, fingerprint and face stay saved for next time.',
      confirmLabel: 'Turn off',
      danger: true,
    });
    if (ok) await save({ face_lock_enabled: false }, 'App Lock is off');
  }

  // ── Password ───────────────────────────────────────────────────────────────
  async function savePassword(password: string): Promise<boolean> {
    if (vault!.password_hash && await verifyVaultSecret(userId, 'password', password, vault!)) {
      showError('Pick a different password from your Locked Chats one 💗');
      return false;
    }
    const { hash, salt } = await hashNewSecret(password);
    return save(secretFields('app-password', hash, salt));
  }

  // ── Fingerprint ────────────────────────────────────────────────────────────
  // Reuses this device's fingerprint if the vault already registered one —
  // just a touch to confirm — otherwise registers a new one.
  async function enableFingerprint(): Promise<boolean> {
    if (fingerprintHere && deviceFingerprintId) {
      if (!(await verifyFingerprint(deviceFingerprintId))) {
        showInfo("Fingerprint wasn't confirmed. Nothing changed.");
        return false;
      }
      return save({ app_lock_fingerprint: true }, 'Fingerprint unlock is on ☝️');
    }
    let newId: string;
    try {
      newId = await registerFingerprint(userId, displayName);
    } catch (err) {
      console.warn(err);
      showInfo('Fingerprint setup was cancelled. Nothing changed.');
      return false;
    }
    const ids = vault!.fingerprint_credential_ids.filter((id) => id !== deviceFingerprintId);
    return save(
      { fingerprint_credential_ids: [...ids, newId], app_lock_fingerprint: true },
      'Fingerprint saved. Unlocking Sweet just got faster ☝️'
    );
  }

  // ── Face ───────────────────────────────────────────────────────────────────
  async function enableFace(then: 'finish' | 'close') {
    if (faceSaved) {
      if (await save({ app_lock_face: true }, 'Face unlock is on 📸') && then === 'finish') nextStep('face');
      return;
    }
    if (!cameraAvailable) {
      showError("Face setup needs a camera, and this device doesn't have one.");
      return;
    }
    setFaceScan({ then });
  }

  // ── Card details ───────────────────────────────────────────────────────────
  const fingerprintStatus =
    !vault.app_lock_fingerprint ? (fingerprintSupported ? 'Off' : 'Not available on this device')
    : fingerprintHere ? 'On · this device'
    : 'On · not set up on this device';
  const faceStatus =
    !vault.app_lock_face ? (faceSaved ? 'Off · face saved' : 'Not set up yet')
    : saved.face === 'no-camera' ? 'On · no camera on this device'
    : 'On';
  const showFingerprintNudge = lockOn && fingerprintSupported && !(vault.app_lock_fingerprint && fingerprintHere);

  return (
    <div className={`p-6 space-y-6 animate-fadeIn ${s.title}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <button onClick={onBack} className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${s.action}`}>
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${s.section}`}>App Lock 🛡️</span>
      </div>

      {/* Intro + master switch */}
      <div className={`p-5 rounded-3xl space-y-4 ${s.intro}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className={`text-lg font-black ${s.title}`}>Keep Sweet just for you 💕</h2>
            <p className={`text-xs leading-relaxed mt-1 ${s.sub}`}>
              When App Lock is on, Sweet asks for your fingerprint, face or app password every time it opens.
            </p>
          </div>
          <Toggle
            s={s}
            on={lockOn}
            disabled={busy || wizard !== null}
            label="App Lock"
            onToggle={() => (lockOn ? turnOff() : nextStep(null))}
          />
        </div>
        <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${lockOn ? s.chipSaved : s.chipMissing}`}>
          {lockOn ? '✓ App Lock is on' : 'App Lock is off'}
        </span>
      </div>

      {/* Fingerprint nudge */}
      {showFingerprintNudge && (
        <button
          disabled={busy}
          onClick={enableFingerprint}
          className="w-full p-4 rounded-2xl flex items-center gap-3 text-left bg-gradient-to-r from-[#FF1493] to-[#FF69B4] text-white shadow-lg shadow-pink-200 active:scale-[0.99] transition-transform disabled:opacity-60"
        >
          <Fingerprint className="w-8 h-8 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-black">
              {fingerprintHere ? 'Use your saved fingerprint ☝️' : 'Add your fingerprint ☝️'}
            </p>
            <p className="text-[11px] opacity-90">
              {fingerprintHere
                ? "You already saved one on this device, we'll use it for App Lock too."
                : 'The fastest, safest way into Sweet. Works even without a camera.'}
            </p>
          </div>
        </button>
      )}

      {/* Ways to unlock */}
      {lockOn && (
        <div className="space-y-3">
          <p className={`text-[10px] font-bold uppercase tracking-[0.2em] px-1 ${s.section}`}>Ways to unlock</p>

          <LockCard
            s={s}
            emoji="🛡️"
            title="App password"
            description="Your backup key. Always works, on any device."
            selected={false}
            disabled={busy}
            status={vault.app_password_hash ? 'Saved · required' : 'Missing, please set one'}
            statusSaved={!!vault.app_password_hash}
            onSelect={() => setChangingPassword(true)}
            actions={
              <button disabled={busy} onClick={() => setChangingPassword(true)} className={`text-xs font-bold ${s.action}`}>
                {vault.app_password_hash ? 'Change' : 'Set up'}
              </button>
            }
          />

          <LockCard
            s={s}
            emoji="☝️"
            title="Fingerprint / device unlock"
            description="Fingerprint, Face ID or Windows Hello, whatever this device uses."
            selected={vault.app_lock_fingerprint && fingerprintHere}
            disabled={busy || !fingerprintSupported}
            status={fingerprintStatus}
            statusSaved={vault.app_lock_fingerprint && fingerprintHere}
            onSelect={() => (vault.app_lock_fingerprint && fingerprintHere ? undefined : enableFingerprint())}
            actions={
              vault.app_lock_fingerprint ? (
                <>
                  {!fingerprintHere && fingerprintSupported && (
                    <button disabled={busy} onClick={enableFingerprint} className={`text-xs font-bold ${s.action}`}>
                      Add this device
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => save({ app_lock_fingerprint: false }, 'Fingerprint unlock is off')}
                    className={`text-xs font-bold ${s.danger}`}
                  >
                    Turn off
                  </button>
                </>
              ) : fingerprintSupported ? (
                <button disabled={busy} onClick={enableFingerprint} className={`text-xs font-bold ${s.action}`}>
                  Turn on
                </button>
              ) : null
            }
          />

          <LockCard
            s={s}
            emoji="📸"
            title="Face"
            description="Look at your screen and smile. Shared with Locked Chats."
            selected={vault.app_lock_face && saved.face === 'saved'}
            disabled={busy}
            status={faceStatus}
            statusSaved={vault.app_lock_face && saved.face === 'saved'}
            onSelect={() => (vault.app_lock_face ? undefined : enableFace('close'))}
            actions={
              vault.app_lock_face ? (
                <button
                  disabled={busy}
                  onClick={() => save({ app_lock_face: false }, 'Face unlock is off')}
                  className={`text-xs font-bold ${s.danger}`}
                >
                  Turn off
                </button>
              ) : (
                <button disabled={busy} onClick={() => enableFace('close')} className={`text-xs font-bold ${s.action}`}>
                  {faceSaved ? 'Turn on' : 'Set up'}
                </button>
              )
            }
          />
        </div>
      )}

      <p className={`text-[11px] text-center leading-relaxed px-4 ${s.faint}`}>
        Forgot your app password? Sign out and back in, and you can set a new one right on the lock screen 🍬
      </p>

      {/* ── Turning-on flow ─────────────────────────────────────────────── */}
      {wizard === 'password' && (
        <PasswordSetupSheet
          s={s}
          busy={busy}
          title="Create your app password 🛡️"
          subtitle={`Your backup key: it works on any device, even without a camera. At least ${MIN_APP_PASSWORD_LENGTH} characters, different from your Locked Chats password.`}
          onDone={async (password) => {
            if (await savePassword(password)) nextStep('password');
          }}
          onCancel={() => setWizard(null)}
          showError={showError}
        />
      )}

      {wizard === 'fingerprint' && (
        <PitchSheet
          s={s}
          icon={<Fingerprint className="w-12 h-12 text-[#FF1493] mx-auto" />}
          title={fingerprintHere ? "We'll use your saved fingerprint ☝️" : 'Add your fingerprint ☝️'}
          body={fingerprintHere
            ? 'You already saved a fingerprint on this device for Locked Chats. One touch and App Lock will use it too.'
            : 'It is the quickest way into Sweet: no typing, nothing to remember, and it works even on devices without a camera.'}
          points={fingerprintHere ? [] : ['Unlocks in a blink ⚡', 'Your fingerprint never leaves this device 🔐', 'Your password stays as a backup 🛡️']}
          primary={fingerprintHere ? 'Use my fingerprint' : 'Add fingerprint'}
          secondary="Maybe later"
          busy={busy}
          onPrimary={async () => {
            if (await enableFingerprint()) nextStep('fingerprint');
          }}
          onSecondary={() => nextStep('fingerprint')}
        />
      )}

      {wizard === 'face' && (
        <PitchSheet
          s={s}
          icon={<span className="block text-5xl text-center">📸</span>}
          title={faceSaved ? 'Use your face too?' : 'Add your face too?'}
          body={faceSaved
            ? 'Your face is already saved for Locked Chats. Sweet can use it to open as well.'
            : 'A quick smile at your screen, and you are in. Totally optional.'}
          points={[]}
          primary={faceSaved ? 'Yes, use my face' : 'Set up face'}
          secondary="Skip"
          busy={busy}
          onPrimary={() => enableFace('finish')}
          onSecondary={() => nextStep('face')}
        />
      )}

      {changingPassword && (
        <PasswordSetupSheet
          s={s}
          busy={busy}
          title={vault.app_password_hash ? 'Change your app password 🛡️' : 'Create your app password 🛡️'}
          subtitle={`At least ${MIN_APP_PASSWORD_LENGTH} characters, different from your Locked Chats password.`}
          onDone={async (password) => {
            if (await savePassword(password)) {
              showSuccess('App password saved 🛡️');
              setChangingPassword(false);
            }
          }}
          onCancel={() => setChangingPassword(false)}
          showError={showError}
        />
      )}

      {faceScan && (
        <StrictLock
          mode="register"
          userId={userId}
          onSaveDescriptor={async (_uid, descriptor) => {
            const ok = await save({ face_descriptor: descriptor, app_lock_face: true }, 'Face saved 📸');
            // Throwing lets StrictLock show its retry state instead of success.
            if (!ok) throw new Error('Face save failed');
          }}
          onRegisterSuccess={() => {
            const then = faceScan.then;
            setFaceScan(null);
            if (then === 'finish') nextStep('face');
          }}
          onUnlock={() => setFaceScan(null)}
          onCancel={() => setFaceScan(null)}
        />
      )}
    </div>
  );
}

function Toggle({ s, on, disabled, label, onToggle }: {
  s: Styles;
  on: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-60 ${on ? s.trackOn : s.trackOff}`}
    >
      <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : ''}`} />
    </button>
  );
}

// One step of the turning-on flow that recommends something.
function PitchSheet({ s, icon, title, body, points, primary, secondary, busy, onPrimary, onSecondary }: {
  s: Styles;
  icon: ReactNode;
  title: string;
  body: string;
  points: string[];
  primary: string;
  secondary: string;
  busy: boolean;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  return (
    <SheetFrame s={s} title={title} subtitle={body} onCancel={onSecondary}>
      {icon}
      {points.length > 0 && (
        <ul className="space-y-1.5">
          {points.map((p) => (
            <li key={p} className={`text-xs font-medium text-center ${s.sub}`}>{p}</li>
          ))}
        </ul>
      )}
      <div className="space-y-2">
        <button
          disabled={busy}
          onClick={onPrimary}
          className={`w-full py-3 rounded-2xl text-sm font-black transition-colors disabled:opacity-50 ${s.primary}`}
        >
          {busy ? 'One moment…' : primary}
        </button>
        <button onClick={onSecondary} className={`w-full py-2 text-[11px] font-semibold ${s.faint}`}>
          {secondary}
        </button>
      </div>
    </SheetFrame>
  );
}
