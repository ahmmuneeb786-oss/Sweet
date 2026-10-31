import { useEffect, useState, type ReactNode } from 'react';
import { AlertCircle, Fingerprint, ShieldAlert, Timer } from 'lucide-react';
import { verifyFingerprint } from '../lib/fingerprint';
import { attemptsLeftText, formatLockout } from '../lib/vaultAttempts';

// Building blocks shared by the two lock screens: VaultGate (Locked Chats)
// and AppLockGate (the App Lock when Sweet opens).

export interface SwitchOption {
  key: string;
  label: string;
}

// Pinned to the bottom over whichever prompt is showing: "Use another way"
// buttons for the other allowed locks, plus any extra links (e.g. Sign out).
export function LockFooter({ options, onPick, children }: {
  options: SwitchOption[];
  onPick: (key: string) => void;
  children?: ReactNode;
}) {
  if (options.length === 0 && !children) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-[10000] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 bg-gradient-to-t from-[#FFF0F3] via-[#FFF0F3]/95 to-transparent">
      {options.length > 0 && (
        <>
          <p className="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-pink-400 mb-2">Use another way</p>
          <div className="flex flex-wrap justify-center gap-2">
            {options.map((o) => (
              <button
                key={o.key}
                onClick={() => onPick(o.key)}
                className="px-4 py-2 rounded-full bg-white border border-[#FFB6C1] text-[#4B004B] text-xs font-bold shadow-sm hover:border-[#FF69B4] active:scale-95 transition-all"
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
      {children && <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 mt-3">{children}</div>}
    </div>
  );
}

// A button rather than prompting on mount: some browsers (Safari) only
// allow the fingerprint prompt from a direct user tap.
export function FingerprintPrompt({ credentialId, title, onUnlock, onFailedAttempt, onCancel }: {
  credentialId: string;
  title: string;
  onUnlock: () => void;
  onFailedAttempt: () => number;
  onCancel?: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  async function handleVerify() {
    if (checking) return;
    setChecking(true);
    setError('');
    if (await verifyFingerprint(credentialId)) {
      onUnlock();
      return;
    }
    // WebAuthn reports a cancelled prompt and a failed match the same way
    // (privacy), so both count as an attempt.
    const attemptsLeft = onFailedAttempt();
    setError(`Not recognised. ${attemptsLeftText(attemptsLeft)}`);
    setChecking(false);
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-[#FFF0F3] flex flex-col items-center justify-center p-8">
      <div className="absolute top-10 flex items-center gap-2 bg-white/50 px-4 py-2 rounded-full backdrop-blur-md border border-white">
        <Fingerprint className="w-4 h-4 text-pink-500" />
        <span className="text-pink-600 text-xs font-bold uppercase tracking-widest">{title}</span>
      </div>

      <div className="bg-white/80 backdrop-blur-sm p-6 rounded-[32px] shadow-xl border border-white max-w-xs w-full text-center space-y-4">
        <Fingerprint className="w-14 h-14 text-pink-500 mx-auto" />
        {error && (
          <div className="flex items-center gap-2 text-red-500 text-xs font-bold justify-center">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}
        <div className="flex gap-2">
          <button
            disabled={checking}
            onClick={handleVerify}
            className="flex-1 py-2 rounded-xl text-xs font-bold text-white bg-[#FF1493] hover:bg-[#FF69B4] transition-colors disabled:opacity-50"
          >
            {checking ? 'Waiting...' : 'Use fingerprint'}
          </button>
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function LockoutScreen({ remainingMs, message, onCancel }: {
  remainingMs: number;
  message: string;
  onCancel?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[9999] bg-[#FFF0F3] flex flex-col items-center justify-center p-8">
      <div className="bg-white/80 backdrop-blur-sm p-6 rounded-[32px] shadow-xl border border-white max-w-xs w-full text-center space-y-3">
        <Timer className="w-12 h-12 text-pink-500 mx-auto" />
        <h3 className="font-bold text-[#4B004B]">Too many failed attempts</h3>
        <p className="text-sm text-[#8B004B]">{message}</p>
        <p className="text-2xl font-black text-pink-600 tabular-nums">{formatLockout(remainingMs)}</p>
        {onCancel && (
          <button
            onClick={onCancel}
            className="px-5 py-2 rounded-xl text-xs font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// opaque: at app start nothing behind the lock may show through.
export function GateNotice({ theme, title, body, onClose, closeLabel = 'Got it', opaque = false }: {
  theme: 'light' | 'dark' | 'sweet';
  title: string;
  body: string;
  onClose?: () => void;
  closeLabel?: string;
  opaque?: boolean;
}) {
  return (
    <div className={`fixed inset-0 z-[9999] flex items-center justify-center p-6 ${opaque ? 'bg-[#FFF0F3]' : 'bg-black/40'}`}>
      <div
        className={`max-w-sm w-full rounded-2xl p-6 text-center space-y-3 ${
          theme === 'sweet' || opaque ? 'bg-white/80 border border-white shadow-xl' : 'bg-white dark:bg-gray-900'
        }`}
      >
        <ShieldAlert className="w-10 h-10 text-pink-500 mx-auto" />
        <h3 className={`font-bold ${theme === 'sweet' || opaque ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>
          {title}
        </h3>
        <p className={`text-sm ${theme === 'sweet' || opaque ? 'text-[#8B004B]' : 'text-gray-500'}`}>
          {body}
        </p>
        {onClose && (
          <button
            onClick={onClose}
            className="mt-2 px-5 py-2 rounded-xl bg-pink-500 text-white text-sm font-bold hover:bg-pink-600 transition-colors"
          >
            {closeLabel}
          </button>
        )}
      </div>
    </div>
  );
}

// Loading cover — only appears if loading is actually slow, so a quick
// device read doesn't flash a full-screen overlay.
export function DelayedSpinner({ delayMs = 300, opaque = false }: { delayMs?: number; opaque?: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);
  if (!show && !opaque) return null;
  return (
    <div className="fixed inset-0 z-[9999] bg-[#FFF0F3] flex items-center justify-center">
      {show && <div className="w-8 h-8 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />}
    </div>
  );
}
