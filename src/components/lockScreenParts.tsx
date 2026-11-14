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
    <div className="fixed inset-x-0 bottom-0 z-[10000] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 bg-gradient-to-t from-th-bg via-th-bg/95 to-transparent">
      {options.length > 0 && (
        <>
          <p className="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-th-ink-soft mb-2">Use another way</p>
          <div className="flex flex-wrap justify-center gap-2">
            {options.map((o) => (
              <button
                key={o.key}
                onClick={() => onPick(o.key)}
                className="px-4 py-2 rounded-full bg-th-card border border-th-border text-th-ink text-xs font-bold shadow-sm hover:border-th-primary active:scale-95 transition-all"
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
    <div className="fixed inset-0 z-[9999] bg-th-bg flex flex-col items-center justify-center p-8">
      <div className="absolute top-10 flex items-center gap-2 bg-th-card/60 px-4 py-2 rounded-full backdrop-blur-md border border-th-border">
        <Fingerprint className="w-4 h-4 text-th-primary" />
        <span className="text-th-link text-xs font-bold uppercase tracking-widest">{title}</span>
      </div>

      <div className="bg-th-card/95 text-th-ink backdrop-blur-sm p-6 rounded-[32px] shadow-xl border border-th-border max-w-xs w-full text-center space-y-4">
        <Fingerprint className="w-14 h-14 text-th-primary mx-auto" />
        {error && (
          <div className="flex items-center gap-2 text-red-500 text-xs font-bold justify-center">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}
        <div className="flex gap-2">
          <button
            disabled={checking}
            onClick={handleVerify}
            className="flex-1 py-2 rounded-xl text-xs font-bold text-th-on-primary bg-th-primary hover:opacity-90 transition-colors disabled:opacity-50"
          >
            {checking ? 'Waiting...' : 'Use fingerprint'}
          </button>
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-xl text-xs font-bold text-th-on-secondary bg-th-secondary hover:bg-th-card-hover transition-colors"
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
    <div className="fixed inset-0 z-[9999] bg-th-bg flex flex-col items-center justify-center p-8">
      <div className="bg-th-card/95 text-th-ink backdrop-blur-sm p-6 rounded-[32px] shadow-xl border border-th-border max-w-xs w-full text-center space-y-3">
        <Timer className="w-12 h-12 text-th-primary mx-auto" />
        <h3 className="font-bold text-th-ink">Too many failed attempts</h3>
        <p className="text-sm text-th-ink-soft">{message}</p>
        <p className="text-2xl font-black text-th-link tabular-nums">{formatLockout(remainingMs)}</p>
        {onCancel && (
          <button
            onClick={onCancel}
            className="px-5 py-2 rounded-xl text-xs font-bold text-th-on-secondary bg-th-secondary hover:bg-th-card-hover transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// opaque: at app start nothing behind the lock may show through.
// `theme` is still accepted from callers; colours come from the th-* theme variables.
export function GateNotice({ title, body, onClose, closeLabel = 'Got it', opaque = false }: {
  theme?: 'light' | 'dark' | 'sweet';
  title: string;
  body: string;
  onClose?: () => void;
  closeLabel?: string;
  opaque?: boolean;
}) {
  return (
    <div className={`fixed inset-0 z-[9999] flex items-center justify-center p-6 ${opaque ? 'bg-th-bg' : 'bg-black/40'}`}>
      <div
        className={`max-w-sm w-full rounded-2xl p-6 text-center space-y-3 ${
          'bg-th-card/95 text-th-ink border border-th-border shadow-xl'
        }`}
      >
        <ShieldAlert className="w-10 h-10 text-th-primary mx-auto" />
        <h3 className="font-bold text-th-ink">
          {title}
        </h3>
        <p className="text-sm text-th-ink-soft">
          {body}
        </p>
        {onClose && (
          <button
            onClick={onClose}
            className="mt-2 px-5 py-2 rounded-xl bg-th-primary text-th-on-primary text-sm font-bold hover:opacity-90 transition-colors"
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
    <div className="fixed inset-0 z-[9999] bg-th-bg flex items-center justify-center">
      {show && <div className="w-8 h-8 border-2 border-th-primary border-t-transparent rounded-full animate-spin" />}
    </div>
  );
}
