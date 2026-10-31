import { useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, Check, Delete } from 'lucide-react';
import { StrictLock } from './StrictLock';
import { useNotify } from '../contexts/NotificationContext';
import { useConfirm } from '../contexts/ConfirmContext';
import {
  getSavedMethods,
  hashNewSecret,
  saveVault,
  verifyVaultSecret,
  VAULT_METHOD_LABELS,
  VAULT_METHODS,
  type SavedState,
  type VaultMethod,
  type VaultSettings,
} from '../lib/vault';
import {
  forgetDeviceFingerprint,
  getDeviceFingerprintId,
  isFingerprintSupported,
  registerFingerprint,
} from '../lib/fingerprint';
import { useCachedFace, useCameraAvailable, useVaultSettings } from '../hooks/useVaultSettings';

export type Theme = 'light' | 'dark' | 'sweet';
type MainLock = VaultMethod | 'none';

export const MIN_VAULT_PASSWORD_LENGTH = 6;

interface LockedChatsSettingsProps {
  theme: Theme;
  userId: string;
  displayName: string;
  onBack: () => void;
}

const DESCRIPTIONS: Record<MainLock, string> = {
  none: 'Locked chats stay hidden, but open with just a tap.',
  pin: 'A quick little code only you know.',
  password: `A secret phrase of at least ${MIN_VAULT_PASSWORD_LENGTH} characters.`,
  face: 'Just look at your screen and smile.',
  fingerprint: 'A tap of your fingertip on this device.',
};

function statusText(method: VaultMethod, state: SavedState): string {
  if (state === 'other-device') return 'Saved on another device';
  if (state === 'no-camera') return 'Saved · no camera on this device';
  if (state === 'not-saved') return 'Not set up yet';
  if (method === 'fingerprint') return 'Saved on this device';
  if (method === 'face') return 'Saved · also used by App Lock';
  return 'Saved';
}

function joinNames(methods: VaultMethod[]): string {
  const names = methods.map((m) => VAULT_METHOD_LABELS[m].name);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// Shared with AppLockSettings so both lock tabs look like one family.
export function styles(theme: Theme) {
  const sweet = theme === 'sweet';
  const dark = theme === 'dark';
  return {
    title: sweet ? 'text-[#4B004B]' : dark ? 'text-gray-100' : 'text-gray-900',
    sub: sweet ? 'text-[#8B004B]' : dark ? 'text-gray-400' : 'text-gray-500',
    faint: sweet ? 'text-[#8B004B]/70' : dark ? 'text-gray-500' : 'text-gray-400',
    section: sweet ? 'text-[#FF69B4]' : dark ? 'text-gray-500' : 'text-gray-400',
    card: sweet ? 'border-2 border-[#FFD1DC] bg-[#FFF0F5] hover:border-[#FFB6C1] hover:bg-white' : dark ? 'border border-gray-800 bg-gray-900/50 hover:border-gray-700' : 'border border-gray-200 bg-white hover:border-gray-300',
    cardSelected: sweet ? 'border-2 border-[#FF1493] bg-white shadow-md shadow-pink-100' : dark ? 'border border-pink-500/60 bg-gray-800' : 'border border-pink-400 bg-pink-50/40',
    iconBox: sweet ? 'border border-[#FFB6C1] bg-[#FFE4E1]' : dark ? 'bg-gray-800' : 'bg-gray-100',
    intro: sweet ? 'border-2 border-[#FFD1DC] bg-gradient-to-br from-[#FFF0F5] to-white' : dark ? 'border border-gray-800 bg-gray-800/30' : 'border border-gray-200 bg-gray-50',
    chipSaved: sweet ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : dark ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-600',
    chipMissing: sweet ? 'bg-white text-[#8B004B]/70 border border-[#FFD1DC]' : dark ? 'bg-gray-800 text-gray-500' : 'bg-gray-100 text-gray-500',
    chipMain: 'bg-[#FF1493] text-white',
    action: sweet ? 'text-[#FF1493] hover:text-[#C71585]' : dark ? 'text-pink-400 hover:text-pink-300' : 'text-pink-600 hover:text-pink-700',
    danger: 'text-red-400 hover:text-red-600',
    radioOn: 'border-[#FF1493] bg-[#FF1493]',
    radioOff: sweet ? 'border-[#FFB6C1] bg-white' : dark ? 'border-gray-600 bg-gray-900' : 'border-gray-300 bg-white',
    sheet: sweet ? 'bg-[#FFF0F5] border-2 border-[#FFD1DC]' : dark ? 'bg-gray-900 border border-gray-800' : 'bg-white border border-gray-200',
    input: sweet ? 'bg-white border border-[#FFB6C1] focus:ring-2 focus:ring-[#FF69B4] text-[#4B004B]' : dark ? 'bg-gray-800 border border-gray-700 focus:ring-2 focus:ring-pink-500/50 text-gray-100' : 'bg-gray-50 border border-gray-200 focus:ring-2 focus:ring-pink-300 focus:bg-white text-gray-800',
    key: sweet ? 'bg-white border border-[#FFB6C1] text-[#4B004B] hover:border-[#FF69B4]' : dark ? 'bg-gray-800 border border-gray-700 text-gray-200 hover:border-gray-500' : 'bg-gray-50 border border-gray-200 text-gray-700 hover:border-gray-400',
    primary: 'bg-[#FF1493] hover:bg-[#FF69B4] text-white',
    secondary: sweet ? 'bg-white border border-[#FFB6C1] text-[#4B004B] hover:bg-[#FFE4E1]' : dark ? 'bg-gray-800 text-gray-300 hover:bg-gray-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
    trackOn: 'bg-[#FF1493]',
    trackOff: sweet ? 'bg-[#FFD1DC]' : dark ? 'bg-gray-700' : 'bg-gray-300',
  };
}

// Settings → Locked Chats. One MAIN lock (asked for first) plus every other
// lock the user has saved, which stay saved when the main one changes and
// can optionally be used to unlock too (allow_other_methods).
export function LockedChatsSettings({ theme, userId, displayName, onBack }: LockedChatsSettingsProps) {
  const { showSuccess, showError, showInfo } = useNotify();
  const confirm = useConfirm();
  const s = styles(theme);

  const { vault, loadFailed } = useVaultSettings(userId);
  const [localFace, setLocalFace] = useCachedFace(userId);

  // Setup sheet currently open, and whether finishing it also makes that
  // lock the main one (tapping its card) or only saves it (its "Set up").
  const [setup, setSetup] = useState<{ method: 'pin' | 'password' | 'face'; makeMain: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // Ref, not just state: two taps in the same tick both still see the old
  // `busy` before React re-renders — which is how a double tap used to save
  // twice or open two fingerprint prompts.
  const busyRef = useRef(false);

  // A saved face can't be used on a device without a camera (e.g. a PC).
  const cameraAvailable = useCameraAvailable();

  if (!vault) {
    // Only reachable offline with nothing saved on this device — say so
    // instead of spinning forever.
    return loadFailed ? (
      <div className={`p-6 space-y-4 text-center ${s.title}`}>
        <p className="text-3xl">🔌</p>
        <p className="text-sm font-bold">Couldn't load your vault settings</p>
        <p className={`text-xs ${s.sub}`}>Check your connection and try again.</p>
        <button onClick={onBack} className={`px-5 py-2.5 rounded-2xl text-xs font-bold ${s.primary}`}>Back</button>
      </div>
    ) : (
      <div className="flex items-center justify-center h-40">
        <div className="w-6 h-6 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const deviceFingerprintId = getDeviceFingerprintId(userId);
  // Until the camera check answers, assume one — it only affects labels.
  const saved = getSavedMethods(vault, vault.face_descriptor ?? localFace, deviceFingerprintId, cameraAvailable ?? true);
  const main: MainLock = vault.chat_security_type;
  const backups = VAULT_METHODS.filter((m) => m !== main && saved[m] === 'saved');

  // One action at a time: every button goes through here, and a tap while
  // something is still running (hashing, a fingerprint prompt, a confirm
  // dialog, saving) is ignored. Resolves undefined when it was ignored.
  async function exclusive<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    try {
      return await action();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // Every write goes through here: server first, screen updates (via
  // onVaultChange) only once it's accepted.
  async function save(updates: Partial<VaultSettings>, success?: string): Promise<boolean> {
    try {
      await saveVault(userId, updates);
      if (success) showSuccess(success);
      return true;
    } catch (err) {
      console.error('Vault save failed:', err);
      showError("Oops, that didn't save. Check your connection and try again 💗");
      return false;
    }
  }

  const appLockUsesFace = vault.face_lock_enabled && vault.app_lock_face;
  const appLockUsesFingerprint = vault.face_lock_enabled && vault.app_lock_fingerprint;

  const mainUpdate = (method: VaultMethod, makeMain: boolean): Partial<VaultSettings> =>
    makeMain ? { chat_security_type: method } : {};

  async function setUpFingerprint(makeMain: boolean) {
    await exclusive(() => registerThisDevice(makeMain));
  }

  async function registerThisDevice(makeMain: boolean) {
    if (!(await isFingerprintSupported())) {
      showError("This device doesn't support fingerprint unlock here.");
      return;
    }
    let newId: string;
    try {
      newId = await registerFingerprint(userId, displayName);
    } catch (err) {
      console.warn(err);
      showInfo('Fingerprint setup was cancelled. Nothing changed.');
      return;
    }
    // Replace any stale id this device had before, keep other devices'.
    const ids = vault!.fingerprint_credential_ids.filter((id) => id !== deviceFingerprintId);
    await save(
      { fingerprint_credential_ids: [...ids, newId], ...mainUpdate('fingerprint', makeMain) },
      makeMain ? 'Fingerprint is now your main lock ☝️' : 'Fingerprint saved on this device ☝️'
    );
  }

  async function startSetup(method: VaultMethod, makeMain: boolean) {
    if (busyRef.current) return;
    if (method === 'face' && cameraAvailable === false) {
      showError("Face setup needs a camera, and this device doesn't have one.");
      return;
    }
    if (method === 'fingerprint') {
      await setUpFingerprint(makeMain);
      return;
    }
    // Re-registering the face also changes the one App Lock checks — say so
    // first, rather than surprising them at the next app start.
    if (method === 'face' && saved.face === 'saved' && appLockUsesFace) {
      const ok = await exclusive(() => confirm({
        title: 'Change your face?',
        message: 'App Lock uses this face too, so your new face will unlock the app as well.',
        confirmLabel: 'Change face',
      }));
      if (!ok) return;
    }
    setSetup({ method, makeMain });
  }

  async function chooseMain(next: MainLock) {
    if (busyRef.current || next === main) return;
    // Not saved yet: set it up first; it becomes main once saved.
    // (startSetup guards itself, so it runs outside exclusive.)
    if (next !== 'none' && saved[next] !== 'saved' && saved[next] !== 'no-camera') {
      await startSetup(next, true);
      return;
    }
    await exclusive(() => switchMain(next));
  }

  async function switchMain(next: MainLock) {
    if (next === 'none') {
      await save({ chat_security_type: 'none' }, 'Locked chats will open with a tap 🔓');
      return;
    }
    if (saved[next] === 'saved') {
      await save({ chat_security_type: next }, `${VAULT_METHOD_LABELS[next].name} is now your main lock ${VAULT_METHOD_LABELS[next].emoji}`);
      return;
    }
    if (saved[next] === 'no-camera') {
      // Allowed (it works on their phone), but warn: on THIS device the
      // vault would then only open through a backup lock.
      const ok = await confirm({
        title: 'No camera on this device',
        message: "Your face is saved, but this device has no camera, so you won't be able to unlock with it here. Keep a backup lock saved and 'Let me unlock with my other saved locks too' turned on. Use Face as your main lock anyway?",
        confirmLabel: 'Use Face',
      });
      if (ok) await save({ chat_security_type: 'face' }, 'Face is now your main lock 📸');
    }
  }

  async function removeMethod(method: VaultMethod) {
    if (method === main) return;
    await exclusive(() => removeSaved(method));
  }

  async function removeSaved(method: VaultMethod) {
    if (method === 'face' && vault!.face_lock_enabled && vault!.app_lock_face) {
      showInfo('App Lock uses this face too. Turn App Lock off first, then you can remove it 💕');
      return;
    }
    const label = VAULT_METHOD_LABELS[method].name;
    const ok = await confirm({
      title: method === 'fingerprint' ? 'Remove fingerprint from this device?' : `Remove your ${label}?`,
      message: method === 'fingerprint'
        ? appLockUsesFingerprint
          ? "This device's fingerprint will stop unlocking your vault, and App Lock won't be able to use it on this device either. Other devices keep theirs."
          : "This device's fingerprint will stop unlocking your vault. Other devices keep theirs."
        : `Your saved ${label.toLowerCase()} will be deleted. You can set a new one anytime.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;

    const updates: Partial<VaultSettings> =
      method === 'pin' ? { pin_hash: null, pin_salt: null }
      : method === 'password' ? { password_hash: null, password_salt: null }
      : method === 'face' ? { face_descriptor: null }
      : { fingerprint_credential_ids: vault!.fingerprint_credential_ids.filter((id) => id !== deviceFingerprintId) };

    if (await save(updates, `${label} removed`)) {
      if (method === 'fingerprint') forgetDeviceFingerprint(userId);
      if (method === 'face') setLocalFace(null);
    }
  }

  // Resolves true once saved, so the PIN sheet can reset itself on failure.
  async function finishSecret(method: 'pin' | 'password', value: string, makeMain: boolean): Promise<boolean> {
    return (await exclusive(() => saveSecret(method, value, makeMain))) ?? false;
  }

  async function saveSecret(method: 'pin' | 'password', value: string, makeMain: boolean): Promise<boolean> {
    // Kept apart from the App Lock's password on purpose: knowing one
    // shouldn't open the other.
    if (method === 'password' && vault!.app_password_hash && await verifyVaultSecret(userId, 'app-password', value, vault!)) {
      showError('Pick a different password from your App Lock one 💗');
      return false;
    }
    const { hash, salt } = await hashNewSecret(value);
    const fields = method === 'pin' ? { pin_hash: hash, pin_salt: salt } : { password_hash: hash, password_salt: salt };
    const name = VAULT_METHOD_LABELS[method].name;
    if (await save({ ...fields, ...mainUpdate(method, makeMain) }, makeMain ? `${name} saved and set as your main lock 🍬` : `${name} saved 🍬`)) {
      setSetup(null);
      return true;
    }
    return false;
  }

  const otherSavedCount = VAULT_METHODS.filter((m) => m !== main && saved[m] === 'saved').length;
  const toggleDisabled = main === 'none' || busy;

  return (
    <div className={`p-6 space-y-6 animate-fadeIn ${s.title}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${s.action}`}
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${s.section}`}>Sweet Vault 🔒</span>
      </div>

      {/* Intro */}
      <div className={`p-5 rounded-3xl ${s.intro}`}>
        <h2 className={`text-lg font-black ${s.title}`}>Your secret corner 🤫</h2>
        <p className={`text-xs leading-relaxed mt-1 ${s.sub}`}>
          Locked chats live here, hidden from your main chat list. Choose a main lock, and keep a few backups saved for the days it's not handy.
        </p>
      </div>

      {/* Main lock */}
      <div className="space-y-3">
        <p className={`text-[10px] font-bold uppercase tracking-[0.2em] px-1 ${s.section}`}>Main lock</p>

        <LockCard
          s={s}
          emoji="🔓"
          title="No lock"
          description={DESCRIPTIONS.none}
          selected={main === 'none'}
          disabled={busy}
          onSelect={() => chooseMain('none')}
        />

        {VAULT_METHODS.map((m) => {
          const state = saved[m];
          const isMain = main === m;
          // Saved on the account, even if this device can't use it (no camera).
          const savedHere = state === 'saved' || state === 'no-camera';
          return (
            <LockCard
              key={m}
              s={s}
              emoji={VAULT_METHOD_LABELS[m].emoji}
              title={m === 'pin' ? 'PIN' : VAULT_METHOD_LABELS[m].name}
              description={DESCRIPTIONS[m]}
              selected={isMain}
              disabled={busy}
              status={statusText(m, state)}
              statusSaved={state === 'saved'}
              onSelect={() => chooseMain(m)}
              actions={
                <>
                  {!savedHere && (
                    <button disabled={busy} onClick={() => startSetup(m, false)} className={`text-xs font-bold ${s.action}`}>
                      {state === 'other-device' ? 'Add this device' : 'Set up'}
                    </button>
                  )}
                  {state === 'saved' && m !== 'fingerprint' && (
                    <button disabled={busy} onClick={() => startSetup(m, false)} className={`text-xs font-bold ${s.action}`}>
                      Change
                    </button>
                  )}
                  {savedHere && !isMain && (
                    <button disabled={busy} onClick={() => removeMethod(m)} className={`text-xs font-bold ${s.danger}`}>
                      {m === 'fingerprint' ? 'Remove from this device' : 'Remove'}
                    </button>
                  )}
                </>
              }
            />
          );
        })}
      </div>

      {/* Backups toggle */}
      <div className={`p-4 rounded-2xl flex items-start justify-between gap-4 ${s.intro} ${toggleDisabled ? 'opacity-60' : ''}`}>
        <div className="space-y-1">
          <p className={`text-sm font-bold ${s.title}`}>Let me unlock with my other saved locks too</p>
          <p className={`text-[11px] leading-relaxed ${s.sub}`}>
            {main === 'none'
              ? 'Pick a main lock first.'
              : otherSavedCount === 0
                ? 'Save another lock above to use it as a backup.'
                : `You can also use ${joinNames(backups)} 💫`}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={vault.allow_other_methods}
          disabled={toggleDisabled}
          onClick={() => exclusive(() => save(
            { allow_other_methods: !vault.allow_other_methods },
            vault.allow_other_methods ? 'Only your main lock will open the vault' : 'Your saved locks can open the vault too 💫'
          ))}
          className={`relative shrink-0 w-12 h-7 rounded-full transition-colors ${vault.allow_other_methods ? s.trackOn : s.trackOff}`}
        >
          <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${vault.allow_other_methods ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      <p className={`text-[11px] text-center leading-relaxed px-4 ${s.faint}`}>
        5 wrong tries pause the vault for a little while, so nobody can keep guessing 🍬
      </p>

      {/* Setup sheets */}
      {setup?.method === 'pin' && (
        <PinSetupSheet
          s={s}
          busy={busy}
          onDone={(pin) => finishSecret('pin', pin, setup.makeMain)}
          onCancel={() => setSetup(null)}
        />
      )}
      {setup?.method === 'password' && (
        <PasswordSetupSheet
          s={s}
          busy={busy}
          onDone={(password) => finishSecret('password', password, setup.makeMain)}
          onCancel={() => setSetup(null)}
          showError={showError}
        />
      )}
      {setup?.method === 'face' && (
        <StrictLock
          mode="register"
          userId={userId}
          onSaveDescriptor={async (_uid, descriptor) => {
            const makeMain = setup.makeMain;
            const ok = await exclusive(() => save(
              { face_descriptor: descriptor, ...mainUpdate('face', makeMain) },
              makeMain ? 'Face saved and set as your main lock 📸' : 'Face saved 📸'
            ));
            // Throwing lets StrictLock show its retry state instead of success.
            if (!ok) throw new Error('Face save failed');
          }}
          onRegisterSuccess={() => setSetup(null)}
          onUnlock={() => setSetup(null)}
          onCancel={() => setSetup(null)}
        />
      )}
    </div>
  );
}

export type Styles = ReturnType<typeof styles>;

export function LockCard({ s, emoji, title, description, selected, disabled, status, statusSaved, onSelect, actions }: {
  s: Styles;
  emoji: string;
  title: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  status?: string;
  statusSaved?: boolean;
  onSelect: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className={`rounded-2xl p-4 transition-all ${selected ? s.cardSelected : s.card}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        className="w-full flex items-center gap-3 text-left disabled:cursor-wait"
      >
        <div className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-lg ${s.iconBox}`}>{emoji}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className={`text-sm font-bold ${s.title}`}>{title}</h4>
            {selected && <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${s.chipMain}`}>Main lock</span>}
          </div>
          <p className={`text-[11px] mt-0.5 ${s.sub}`}>{description}</p>
        </div>
        <span className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${selected ? s.radioOn : s.radioOff}`}>
          {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
        </span>
      </button>

      {(status || actions) && (
        <div className="flex items-center justify-between gap-3 mt-3 pl-14">
          {status && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusSaved ? s.chipSaved : s.chipMissing}`}>
              {statusSaved ? '✓ ' : ''}{status}
            </span>
          )}
          <div className="flex items-center gap-3 ml-auto">{actions}</div>
        </div>
      )}
    </div>
  );
}

export function SheetFrame({ s, title, subtitle, children, onCancel }: {
  s: Styles;
  title: string;
  subtitle: string;
  children: ReactNode;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[9998] bg-black/30 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onCancel}>
      <div
        className={`w-full max-w-sm rounded-3xl p-6 space-y-5 shadow-2xl animate-scaleIn ${s.sheet}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center space-y-1">
          <h3 className={`text-base font-black ${s.title}`}>{title}</h3>
          <p className={`text-xs ${s.sub}`}>{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function PinSetupSheet({ s, busy, onDone, onCancel }: {
  s: Styles;
  busy: boolean;
  // Resolves false when saving failed — the sheet then starts over instead
  // of sitting there with all four dots filled.
  onDone: (pin: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<'enter' | 'confirm'>('enter');
  const [first, setFirst] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  function press(digit: string) {
    if (busy || value.length >= 4) return;
    const next = value + digit;
    setValue(next);
    if (next.length < 4) return;

    if (step === 'enter') {
      setTimeout(() => {
        setFirst(next);
        setValue('');
        setError('');
        setStep('confirm');
      }, 250);
    } else if (next === first) {
      onDone(next).then((ok) => {
        if (ok) return;
        setError("That didn't save. Let's try again 💗");
        setFirst('');
        setValue('');
        setStep('enter');
      });
    } else {
      setTimeout(() => {
        setError("Those didn't match. Let's start again 🌸");
        setFirst('');
        setValue('');
        setStep('enter');
      }, 250);
    }
  }

  return (
    <SheetFrame
      s={s}
      title={step === 'enter' ? 'Choose your vault PIN 🔑' : 'Type it once more 🌸'}
      subtitle={busy ? 'Saving…' : error || (step === 'enter' ? '4 digits only you know.' : 'Just to be sure.')}
      onCancel={onCancel}
    >
      <div className="flex justify-center gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`w-3.5 h-3.5 rounded-full border-2 transition-all ${
              value.length > i ? 'bg-[#FF1493] border-[#FF1493] scale-110' : 'border-[#FFB6C1] bg-transparent'
            }`}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 max-w-[240px] mx-auto">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} disabled={busy} onClick={() => press(d)} className={`h-12 rounded-2xl text-base font-bold active:scale-95 transition-all disabled:opacity-50 ${s.key}`}>
            {d}
          </button>
        ))}
        <button onClick={onCancel} className={`h-12 rounded-2xl text-xs font-bold ${s.sub}`}>Cancel</button>
        <button disabled={busy} onClick={() => press('0')} className={`h-12 rounded-2xl text-base font-bold active:scale-95 transition-all disabled:opacity-50 ${s.key}`}>
          0
        </button>
        <button
          disabled={busy}
          onClick={() => setValue((v) => v.slice(0, -1))}
          className={`h-12 rounded-2xl flex items-center justify-center disabled:opacity-50 ${s.sub}`}
          aria-label="Delete last digit"
        >
          <Delete className="w-5 h-5" />
        </button>
      </div>
    </SheetFrame>
  );
}

export function PasswordSetupSheet({
  s,
  busy,
  onDone,
  onCancel,
  showError,
  title = 'Set your vault password 🔏',
  subtitle = 'Choose something sweet that only you would know.',
  cancelLabel = 'Cancel',
}: {
  s: Styles;
  busy: boolean;
  title?: string;
  subtitle?: string;
  cancelLabel?: string;
  onDone: (password: string) => void;
  onCancel: () => void;
  showError: (msg: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');

  function submit() {
    if (password.trim().length < MIN_VAULT_PASSWORD_LENGTH) {
      showError(`Your password needs at least ${MIN_VAULT_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== again) {
      showError("Those passwords didn't match. Try once more 🌸");
      return;
    }
    onDone(password);
  }

  return (
    <SheetFrame s={s} title={title} subtitle={subtitle} onCancel={onCancel}>
      <div className="space-y-2.5">
        <input
          type="password"
          autoFocus
          value={password}
          disabled={busy}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={`At least ${MIN_VAULT_PASSWORD_LENGTH} characters`}
          className={`w-full px-4 py-3 rounded-2xl text-sm outline-none transition-all ${s.input}`}
        />
        <input
          type="password"
          value={again}
          disabled={busy}
          onChange={(e) => setAgain(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="Type it again"
          className={`w-full px-4 py-3 rounded-2xl text-sm outline-none transition-all ${s.input}`}
        />
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className={`px-5 py-3 rounded-2xl text-xs font-bold transition-colors ${s.secondary}`}>
          {cancelLabel}
        </button>
        <button
          disabled={busy || !password || !again}
          onClick={submit}
          className={`flex-1 py-3 rounded-2xl text-xs font-bold transition-colors disabled:opacity-50 ${s.primary}`}
        >
          {busy ? 'Saving…' : 'Save password'}
        </button>
      </div>
    </SheetFrame>
  );
}
