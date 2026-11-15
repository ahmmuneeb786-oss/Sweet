import { useEffect, useState } from 'react';
import { usePerformance } from '../../contexts/PerformanceContext';
// The SAME wording code the push server uses — so the preview can never
// drift from what actually lands on the lock screen.
import {
  friendRequestPayload, messagePayload, type PushPayload,
} from '../../../supabase/functions/send-sweet-push/logic.ts';
import type { Peek } from '../../lib/notificationPrefs';

export type PreviewKind = 'message' | 'locked' | 'friend';

const KINDS: { id: PreviewKind; label: string }[] = [
  { id: 'message', label: '💌 Message' },
  { id: 'locked', label: '🔒 Locked chat' },
  { id: 'friend', label: '🤝 Friend request' },
];

function payloadFor(kind: PreviewKind, peek: Peek, sender: string): PushPayload {
  if (kind === 'friend') return friendRequestPayload(peek, sender, []);
  return messagePayload({
    peek, locked: kind === 'locked', senderName: sender, chatId: 'preview',
    type: 'text', content: 'see you at 8? 💕', vibrate: [],
  });
}

function clock(d: Date) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * A little phone lock screen showing the banner your settings produce.
 * Static at the reduced / minimal effects levels (no entry animation, no
 * blur — the banner is opaque either way so it never relies on blur to read).
 */
export function LockPreview({ peek, senderName, off, extra }: {
  peek: Peek;
  senderName: string;
  /** Notifications are off on this device: show the banner greyed out. */
  off?: boolean;
  /** Overrides the banner (e.g. a Bedtime Jar wake-up), keeps the phone. */
  extra?: PushPayload | null;
}) {
  const { perfLevel } = usePerformance();
  const [kind, setKind] = useState<PreviewKind>('message');
  const [now, setNow] = useState(() => new Date());

  // Minute-level clock: one tick every 30s is plenty, and none while hidden.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') setNow(new Date()); };
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, []);

  const p = extra ?? payloadFor(kind, peek, senderName);
  const animate = perfLevel === 'full';

  return (
    <div className="space-y-2.5">
      <div
        className="relative rounded-[26px] overflow-hidden h-48 px-3 pt-5 select-none"
        style={{
          background: 'linear-gradient(160deg, rgb(var(--th-primary)) 0%, rgb(var(--th-bubble-mine-to)) 100%)',
        }}
        aria-label="Lock screen preview"
        role="img"
      >
        {/* darken a touch so the white clock reads on any theme accent */}
        <div className="absolute inset-0 bg-black/20" aria-hidden="true" />
        <div className="relative text-center text-white">
          <p className="text-4xl font-black tracking-tight leading-none drop-shadow-sm">{clock(now)}</p>
          <p className="text-[11px] font-semibold opacity-90 mt-1">
            {now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>

        {/* Outer layer animates (its keyframes end at opacity 1), inner
            layer dims — on one element the animation would undo the dim. */}
        <div key={`${p.title}|${p.body}|${off ? 1 : 0}`} className={`relative mt-4 ${animate ? 'candy-fade-in' : ''}`}>
          <div
            className={`rounded-2xl bg-white/95 text-gray-900 shadow-lg px-3 py-2.5 flex items-start gap-2.5 ${
              off ? 'opacity-50 grayscale' : ''
            }`}
          >
            <img src="/icon-192.png" alt="" className="w-8 h-8 rounded-lg shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] font-bold truncate">{p.title}</p>
                <span className="text-[10px] text-gray-500 shrink-0">{off ? 'off' : 'now'}</span>
              </div>
              <p className="text-[12px] text-gray-700 truncate">{p.body}</p>
            </div>
          </div>
        </div>
      </div>

      {!extra && (
        <div className="flex gap-1.5 flex-wrap" role="radiogroup" aria-label="Preview">
          {KINDS.map((k) => (
            <button
              key={k.id}
              role="radio"
              aria-checked={kind === k.id}
              onClick={() => setKind(k.id)}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors ${
                kind === k.id ? 'bg-th-primary text-th-on-primary' : 'bg-th-secondary text-th-on-secondary border border-th-border'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
