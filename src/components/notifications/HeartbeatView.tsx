import { useEffect, useRef, useState } from 'react';
import { Play, Trash2 } from 'lucide-react';
import { usePerformance } from '../../contexts/PerformanceContext';
import { useNotify } from '../../contexts/NotificationContext';
import {
  HEARTBEAT_PRESETS, buzz, canFeelHere, describePattern, isValidPattern, patternFromPresses, patternLength,
} from '../../lib/heartbeat';
import type { NotificationPrefs } from '../../lib/notificationPrefs';
import { runSweetPulse } from '../../lib/sweetPulse';
import { TabBody, TabHeader } from '../storage/parts';
import type { Tokens } from '../storage/tokens';
import { SectionLabel } from './parts';
import { nameOf, type Person } from './people';

/** Stop recording this long after the last tap. */
const IDLE_STOP_MS = 1600;

/** The pattern drawn as a row of pills: filled = buzz, gap = pause. */
function PatternBar({ pattern, lit }: { pattern: number[]; lit: number }) {
  const total = Math.max(1, patternLength(pattern));
  return (
    <div className="flex items-center h-5 w-full rounded-full overflow-hidden bg-th-secondary border border-th-border px-1" aria-hidden="true">
      {pattern.map((ms, i) => (
        <div
          key={i}
          style={{ width: `${(ms / total) * 100}%` }}
          className={i % 2 === 0
            ? `h-3 rounded-full ${i === lit ? 'bg-th-link' : 'bg-th-primary'}`
            : 'h-3'}
        />
      ))}
    </div>
  );
}

export function HeartbeatView({ t, userId, prefs, people, update, onBack }: {
  t: Tokens;
  userId: string;
  prefs: NotificationPrefs;
  people: Person[];
  /** Resolves false when saving failed (the tab already showed why). */
  update: (patch: Partial<NotificationPrefs>) => Promise<boolean>;
  onBack: () => void;
}) {
  const { perfLevel } = usePerformance();
  const { showSuccess, showError, showInfo } = useNotify();
  const feel = canFeelHere();

  const [pattern, setPattern] = useState<number[] | null>(null);
  const [recording, setRecording] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [lit, setLit] = useState(-1); // segment playing right now
  const [personId, setPersonId] = useState('');
  const [sending, setSending] = useState(false);

  const presses = useRef<[number, number][]>([]);
  const downAt = useRef<number | null>(null);
  const idleTimer = useRef<number | undefined>(undefined);
  const playTimers = useRef<number[]>([]);

  const stopPlayback = () => {
    playTimers.current.forEach((id) => clearTimeout(id));
    playTimers.current = [];
    setLit(-1);
  };

  useEffect(() => () => {
    clearTimeout(idleTimer.current);
    stopPlayback();
    buzz(0);
  }, []);

  /** Plays a pattern: real vibration where possible + the bar lights up. */
  function play(p: number[]) {
    stopPlayback();
    buzz(p);
    // Lighting each buzz segment is a handful of timers (≤ 12), cheap on any device.
    let at = 0;
    p.forEach((ms, i) => {
      if (i % 2 === 0) playTimers.current.push(window.setTimeout(() => setLit(i), at));
      at += ms;
    });
    playTimers.current.push(window.setTimeout(() => setLit(-1), at));
  }

  function finishRecording() {
    clearTimeout(idleTimer.current);
    setRecording(false);
    const p = patternFromPresses(presses.current);
    presses.current = [];
    if (isValidPattern(p)) {
      setPattern(p);
      play(p);
    }
  }

  function onDown(e: React.PointerEvent) {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    clearTimeout(idleTimer.current);
    if (!recording) {
      presses.current = [];
      setPattern(null);
      stopPlayback();
      setRecording(true);
    }
    downAt.current = performance.now();
    setPressed(true);
    buzz(1000); // feel your own tap while you hold it
  }

  function onUp() {
    if (downAt.current === null) return;
    presses.current.push([downAt.current, performance.now()]);
    downAt.current = null;
    setPressed(false);
    buzz(0);
    idleTimer.current = window.setTimeout(finishRecording, IDLE_STOP_MS);
  }

  async function saveDefault(p: number[]) {
    if (await update({ vibration: p })) showSuccess('Saved as your heartbeat for everyone 💓');
  }

  async function saveForPerson(p: number[]) {
    if (!personId) return showInfo('Pick who this heartbeat is for first.');
    if (await update({ vibration_by_sender: { ...prefs.vibration_by_sender, [personId]: p } })) showSuccess(`Now you’ll feel ${nameOf(people, personId)} without looking 💓`);
  }

  async function removePerson(id: string) {
    const next = { ...prefs.vibration_by_sender };
    delete next[id];
    await update({ vibration_by_sender: next });
  }

  /** Sends a real test push carrying this pattern — feel it on the lock screen. */
  async function tryOnLockScreen(p: number[]) {
    setSending(true);
    let fix = '';
    const ok = await runSweetPulse(userId, (_id, patch) => { if (patch.fix) fix = patch.fix; }, p);
    setSending(false);
    if (ok) showSuccess('Sent! Lock your phone to feel it next time 💓');
    else showError(fix || 'Could not send the test — try Sweet Pulse on the main screen.');
  }

  const peopleWithBeats = Object.keys(prefs.vibration_by_sender ?? {});
  const glow = perfLevel === 'full';

  return (
    <TabBody t={t}>
      <TabHeader t={t} onBack={onBack} label="Heartbeat Tap" />

      <div className={`rounded-2xl p-3 text-[11px] ${t.intro} ${t.sub}`}>
        {feel
          ? '💓 Tap a rhythm on the candy. Each person can buzz differently, so you know who wrote without looking.'
          : '📱 This device can’t vibrate, but you can still make heartbeats here — your phone will feel them.'}
      </div>

      {/* Composer */}
      <div className="flex flex-col items-center gap-3 py-2">
        <button
          type="button"
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onContextMenu={(e) => e.preventDefault()}
          aria-label="Tap a rhythm"
          className={`w-36 h-36 rounded-full select-none touch-none flex items-center justify-center text-5xl
            bg-gradient-to-br from-th-bubble-mine to-th-bubble-mine-to text-th-on-bubble-mine
            transition-transform duration-100 ${pressed || lit >= 0 ? 'scale-95' : 'scale-100'}
            ${glow ? 'shadow-[0_10px_30px_rgb(var(--th-primary)/0.45)]' : 'shadow-md'}`}
        >
          <span aria-hidden="true">{pressed || lit >= 0 ? '💗' : '💓'}</span>
        </button>
        <p className={`text-[11px] font-bold ${t.sub}`} aria-live="polite">
          {recording ? 'Listening… stop tapping to finish' : pattern ? describePattern(pattern) : 'Hold for a long buzz, tap for a short one'}
        </p>
        {recording && (
          <button onClick={finishRecording} className={`text-xs font-bold ${t.action}`}>Done</button>
        )}
      </div>

      {pattern && !recording && (
        <div className={`rounded-2xl p-4 space-y-3 ${t.card}`}>
          <div className="flex items-center gap-2">
            <button onClick={() => play(pattern)} aria-label="Play" className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center ${t.secondary}`}>
              <Play className="w-3.5 h-3.5" />
            </button>
            <PatternBar pattern={pattern} lit={lit} />
          </div>
          <button onClick={() => saveDefault(pattern)} className={`w-full py-2 rounded-xl text-xs font-bold ${t.primary}`}>
            Use for everyone
          </button>
          {people.length > 0 && (
            <div className="flex gap-2">
              <select
                value={personId}
                onChange={(e) => setPersonId(e.target.value)}
                className={`flex-1 min-w-0 rounded-xl px-2 py-2 text-xs ${t.input}`}
                aria-label="Person"
              >
                <option value="">Just for…</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button onClick={() => saveForPerson(pattern)} className={`px-3 rounded-xl text-xs font-bold ${t.secondary}`}>Save</button>
            </div>
          )}
          <button onClick={() => tryOnLockScreen(pattern)} disabled={sending} className={`w-full text-xs font-bold disabled:opacity-50 ${t.action}`}>
            {sending ? 'Sending…' : '📲 Feel it as a real notification'}
          </button>
        </div>
      )}

      {/* Presets */}
      <div className="space-y-2.5">
        <SectionLabel t={t}>Ready-made</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {HEARTBEAT_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => { setPattern(p.pattern); play(p.pattern); }}
              className={`text-[12px] font-bold px-3 py-1.5 rounded-full ${t.secondary}`}
            >
              {p.emoji} {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* What's saved */}
      <div className="space-y-2.5">
        <SectionLabel t={t}>Your heartbeats</SectionLabel>
        <div className={`rounded-2xl p-4 flex items-center gap-3 ${t.card}`}>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-bold">Everyone</h4>
            <p className={`text-[11px] mt-0.5 ${t.sub}`}>{describePattern(prefs.vibration)}</p>
          </div>
          <button onClick={() => play(prefs.vibration ?? [100, 50, 100])} aria-label="Play your default heartbeat" className={`w-8 h-8 rounded-full flex items-center justify-center ${t.secondary}`}>
            <Play className="w-3.5 h-3.5" />
          </button>
          {prefs.vibration && (
            <button onClick={() => update({ vibration: null })} aria-label="Back to the soft default" className={`w-8 h-8 rounded-full flex items-center justify-center ${t.danger}`}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {peopleWithBeats.map((id) => (
          <div key={id} className={`rounded-2xl p-4 flex items-center gap-3 ${t.card}`}>
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold truncate">{nameOf(people, id)}</h4>
              <p className={`text-[11px] mt-0.5 ${t.sub}`}>{describePattern(prefs.vibration_by_sender[id])}</p>
            </div>
            <button onClick={() => play(prefs.vibration_by_sender[id])} aria-label="Play" className={`w-8 h-8 rounded-full flex items-center justify-center ${t.secondary}`}>
              <Play className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => removePerson(id)} aria-label="Remove" className={`w-8 h-8 rounded-full flex items-center justify-center ${t.danger}`}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </TabBody>
  );
}
