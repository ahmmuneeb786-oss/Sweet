import { ChevronLeft } from 'lucide-react';
import { CANDY, candyTint, type CandyKey, type Tokens } from './tokens';

/** Same header as the App Lock / Locked Chats tabs. */
export function TabHeader({ t, onBack, backLabel = 'Back', label }: { t: Tokens; onBack: () => void; backLabel?: string; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <button onClick={onBack} className={`flex items-center gap-1.5 text-sm font-medium transition-colors ${t.action}`}>
        <ChevronLeft className="w-4 h-4" />
        {backLabel}
      </button>
      <span className={t.sectionLabel}>{label}</span>
    </div>
  );
}

/** Rounded icon box (like LockCard's) tinted with a candy flavour. */
export function CandyIcon({ k, dark, emoji }: { k: CandyKey; dark: boolean; emoji?: string }) {
  return (
    <div
      className="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-lg"
      style={{ background: candyTint(k, dark), boxShadow: `inset 0 0 0 1.5px ${CANDY[k].base}55` }}
      aria-hidden="true"
    >
      {emoji ?? CANDY[k].emoji}
    </div>
  );
}

/** Wraps a sub-screen with the standard tab padding and entry fade. */
export function TabBody({ t, children }: { t: Tokens; children: React.ReactNode }) {
  return <div className={`p-6 space-y-6 candy-fade-in ${t.title}`}>{children}</div>;
}

export function Loading({ t, text }: { t: Tokens; text: string }) {
  return (
    <div className="flex items-center gap-2 py-6 justify-center">
      <div className="w-5 h-5 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
      <span className={`text-xs font-bold ${t.sub}`}>{text}</span>
    </div>
  );
}
