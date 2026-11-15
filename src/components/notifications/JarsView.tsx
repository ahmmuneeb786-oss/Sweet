import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { usePerformance } from '../../contexts/PerformanceContext';
import { useNotify } from '../../contexts/NotificationContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import {
  DAY_LABELS, JAR_KINDS, MAX_JARS, deleteJar, describeJar, hm, jarCounts, jarErrorMessage, jarIsActive,
  kindInfo, listJars, saveJar, suggestKind, type Jar, type JarDraft,
} from '../../lib/jars';
import type { Peek } from '../../lib/notificationPrefs';
import { digestPayload } from '../../../supabase/functions/send-sweet-push/logic.ts';
import { Loading, TabBody, TabHeader } from '../storage/parts';
import type { Tokens } from '../storage/tokens';
import { LockPreview } from './LockPreview';
import { SectionLabel, Switch } from './parts';
import type { Person } from './people';

const CANDY_COLOURS = ['#FF5C93', '#A06BFF', '#FFB547', '#3DD6A3', '#5CC8FF', '#FF8A5C'];

/**
 * A little glass jar that fills with candies, one per held message (drawn up
 * to 14). The candies only bob at the full effects level; the `candy-float`
 * class is frozen by index.css at reduced/minimal.
 */
export function MiniJar({ count, quiet, size = 56 }: { count: number; quiet: boolean; size?: number }) {
  const { perfLevel } = usePerformance();
  const shown = Math.min(count, 14);
  const candies = Array.from({ length: shown }, (_, i) => {
    const row = Math.floor(i / 4);
    const col = i % 4;
    // 4 per row, centred in the jar (x 18–46), alternate rows nudged like a real pile
    return { x: 20 + col * 8 + (row % 2 ? 4 : 0), y: 52 - row * 7, c: CANDY_COLOURS[i % CANDY_COLOURS.length] };
  });
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="20" y="4" width="24" height="7" rx="3" style={{ fill: 'rgb(var(--th-primary))' }} />
      <path
        d="M16 12 h32 a4 4 0 0 1 4 4 v36 a8 8 0 0 1 -8 8 h-24 a8 8 0 0 1 -8 -8 v-36 a4 4 0 0 1 4 -4z"
        style={{ fill: 'rgb(var(--th-card) / 0.85)', stroke: 'rgb(var(--th-primary))' }}
        strokeWidth="2.5"
      />
      {candies.map((k, i) => (
        <circle
          key={i}
          cx={k.x}
          cy={k.y}
          r="3.6"
          fill={k.c}
          className={perfLevel === 'full' ? 'candy-float' : undefined}
          style={perfLevel === 'full' ? { animationDelay: `${(i % 5) * 0.4}s` } : undefined}
        />
      ))}
      {quiet && shown === 0 && <text x="32" y="44" textAnchor="middle" fontSize="16">🌙</text>}
    </svg>
  );
}

// ---------------------------------------------------------------- list

export function JarsView({ t, userId, onBack, onEdit }: {
  t: Tokens; userId: string; onBack: () => void; onEdit: (jar: Jar | null) => void;
}) {
  const { showError } = useNotify();
  const [jars, setJars] = useState<Jar[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    Promise.all([listJars(userId), jarCounts().catch(() => ({}))])
      .then(([j, c]) => { setJars(j); setCounts(c); })
      .catch(() => { setFailed(true); setJars([]); });
  }, [userId]);
  useEffect(load, [load]);

  async function toggle(jar: Jar, enabled: boolean) {
    setJars((prev) => prev?.map((j) => (j.id === jar.id ? { ...j, enabled } : j)) ?? null);
    try {
      await saveJar(userId, { ...jar, enabled });
    } catch (err) {
      setJars((prev) => prev?.map((j) => (j.id === jar.id ? jar : j)) ?? null);
      showError(jarErrorMessage(err));
    }
  }

  return (
    <TabBody t={t}>
      <TabHeader t={t} onBack={onBack} label="Bedtime Jars" />
      <div className={`rounded-2xl p-4 flex items-center gap-3 ${t.intro}`}>
        <MiniJar count={3} quiet size={52} />
        <p className={`text-[11px] ${t.sub}`}>
          During a jar’s hours, messages wait quietly inside instead of buzzing. When it ends you get one sweet wake-up note with everything that waited.
        </p>
      </div>

      {jars === null && <Loading t={t} text="Opening your jars…" />}
      {failed && (
        <p className={`text-[12px] text-center ${t.sub}`}>
          Could not load jars. <button onClick={load} className={`font-bold ${t.action}`}>Try again</button>
        </p>
      )}

      {jars && jars.map((j) => {
        const quiet = jarIsActive(j);
        const waiting = counts[j.id] ?? 0;
        return (
          <div key={j.id} className={`rounded-2xl p-4 flex items-center gap-3 ${quiet ? t.cardSelected : t.card}`}>
            <MiniJar count={waiting} quiet={quiet} />
            <button onClick={() => onEdit(j)} className="flex-1 min-w-0 text-left">
              <h4 className="text-sm font-bold truncate">{kindInfo(j.kind).emoji} {j.name}</h4>
              <p className={`text-[11px] mt-0.5 ${t.sub}`}>{describeJar(j)}</p>
              <p className="text-[11px] mt-0.5 font-bold text-th-link">
                {!j.enabled ? 'Paused' : quiet ? `Quiet now${waiting ? ` · ${waiting} waiting` : ''}` : waiting ? `${waiting} waiting` : 'Waiting for its hours'}
              </p>
            </button>
            <Switch on={j.enabled} onChange={(v) => toggle(j, v)} label={`${j.name} on`} />
          </div>
        );
      })}

      {jars && jars.length < MAX_JARS && (
        <button onClick={() => onEdit(null)} className={`w-full rounded-2xl p-4 flex items-center justify-center gap-2 text-sm font-bold border-2 border-dashed border-th-border text-th-link hover:bg-th-card-hover`}>
          <Plus className="w-4 h-4" /> New jar
        </button>
      )}
      {jars && jars.length >= MAX_JARS && (
        <p className={`text-[11px] text-center ${t.sub}`}>That’s the full set of 3 jars 🍬</p>
      )}
    </TabBody>
  );
}

// ---------------------------------------------------------------- editor

const NEW_JAR: JarDraft = {
  name: 'Sleepy jar', kind: 'night', start_time: '22:00:00', end_time: '07:00:00',
  days: [1, 2, 3, 4, 5, 6, 7], break_through: [], enabled: true,
};

export function JarEditor({ t, userId, jar, people, peek, onDone }: {
  t: Tokens; userId: string; jar: Jar | null; people: Person[]; peek: Peek; onDone: () => void;
}) {
  const { showSuccess, showError } = useNotify();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<JarDraft>(() => (jar ? { ...jar } : { ...NEW_JAR }));
  const [kindTouched, setKindTouched] = useState(!!jar);
  const [saving, setSaving] = useState(false);
  const [showPeople, setShowPeople] = useState(false);

  const set = (patch: Partial<JarDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function rename(name: string) {
    const guess = kindTouched ? null : suggestKind(name);
    set({ name, ...(guess ? { kind: guess } : {}) });
  }

  function toggleDay(d: number) {
    set({ days: draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d] });
  }

  function toggleVip(id: string) {
    set({ break_through: draft.break_through.includes(id) ? draft.break_through.filter((x) => x !== id) : [...draft.break_through, id] });
  }

  // The wake-up note this jar will send — same code as the server.
  const preview = useMemo(() => {
    const sample = people.slice(0, 2);
    const names: Record<string, string> = {};
    sample.forEach((p) => { names[p.id] = p.name.split(' ')[0]; });
    const items = sample.length
      ? sample.map((p, i) => ({ sender_id: p.id, count: i === 0 ? 4 : 2, locked: false }))
      : [{ sender_id: 'x', count: 6, locked: false }];
    return digestPayload({
      jarName: draft.name || 'jar', kind: draft.kind, endTime: draft.end_time, items, names, peek, vibrate: [],
    });
  }, [draft.name, draft.kind, draft.end_time, people, peek]);

  const sameTime = hm(draft.start_time) === hm(draft.end_time);
  const canSave = draft.name.trim().length > 0 && draft.days.length > 0 && !sameTime && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      await saveJar(userId, draft);
      showSuccess(jar ? 'Jar updated 🍬' : `${draft.name.trim()} is ready 🌙`);
      onDone();
    } catch (err) {
      showError(jarErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!jar) return;
    const ok = await confirm({
      title: `Delete ${jar.name}?`,
      message: 'Anything waiting inside is let go — those messages are still in your chats.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteJar(userId, jar.id);
      onDone();
    } catch (err) {
      showError(jarErrorMessage(err));
    }
  }

  return (
    <TabBody t={t}>
      <TabHeader t={t} onBack={onDone} label={jar ? 'Edit jar' : 'New jar'} />

      <div className="space-y-2">
        <SectionLabel t={t}>Name</SectionLabel>
        <input
          value={draft.name}
          onChange={(e) => rename(e.target.value)}
          maxLength={30}
          placeholder="Sleepy jar, Work jar…"
          className={`w-full rounded-xl px-3 py-2.5 text-sm outline-none ${t.input}`}
        />
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind of jar">
          {JAR_KINDS.map((k) => (
            <button
              key={k.id}
              role="radio"
              aria-checked={draft.kind === k.id}
              onClick={() => { setKindTouched(true); set({ kind: k.id }); }}
              className={`text-[12px] font-bold px-2.5 py-1 rounded-full ${draft.kind === k.id ? t.pillOn : t.pill}`}
            >
              {k.emoji} {k.label}
            </button>
          ))}
        </div>
        <p className={`text-[11px] px-1 ${t.sub}`}>The kind sets the mood of the wake-up note; the end time keeps it honest.</p>
      </div>

      <div className="space-y-2">
        <SectionLabel t={t}>Quiet hours</SectionLabel>
        <div className="grid grid-cols-2 gap-2">
          {(['start_time', 'end_time'] as const).map((key) => (
            <label key={key} className={`rounded-xl p-3 ${t.card}`}>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${t.sub}`}>{key === 'start_time' ? 'From' : 'Until'}</span>
              <input
                type="time"
                value={hm(draft[key])}
                onChange={(e) => e.target.value && set({ [key]: `${e.target.value}:00` })}
                className="block w-full bg-transparent text-lg font-black outline-none text-th-ink"
              />
            </label>
          ))}
        </div>
        {sameTime && <p className="text-[11px] text-th-danger px-1">Start and end can’t be the same time.</p>}
        <div className="flex gap-1" role="group" aria-label="Days">
          {DAY_LABELS.map((label, i) => {
            const d = i + 1;
            const on = draft.days.includes(d);
            return (
              <button
                key={d}
                aria-pressed={on}
                onClick={() => toggleDay(d)}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold ${on ? t.pillOn : t.pill}`}
              >
                {label.slice(0, 2)}
              </button>
            );
          })}
        </div>
        <p className={`text-[11px] px-1 ${t.sub}`}>Days are the nights it starts on — a Friday 22:00 jar runs into Saturday morning.</p>
      </div>

      <div className="space-y-2">
        <SectionLabel t={t}>Sweethearts break through</SectionLabel>
        <button onClick={() => setShowPeople((v) => !v)} className={`w-full rounded-2xl p-4 flex items-center gap-3 text-left ${t.card}`}>
          <span className="text-lg" aria-hidden="true">💞</span>
          <span className="flex-1 min-w-0">
            <span className="text-sm font-bold block">
              {draft.break_through.length === 0 ? 'Nobody — total quiet' : `${draft.break_through.length} can still reach you`}
            </span>
            <span className={`text-[11px] ${t.sub}`}>Their messages buzz like normal, even inside the jar</span>
          </span>
          <ChevronRight className={`w-4 h-4 transition-transform ${showPeople ? 'rotate-90' : ''} ${t.faint}`} />
        </button>
        {showPeople && (
          <div className={`rounded-2xl p-2 max-h-56 overflow-y-auto ${t.card}`}>
            {people.length === 0 && <p className={`text-[11px] p-2 ${t.sub}`}>Start a chat first — people you talk to show up here.</p>}
            {people.map((p) => (
              <label key={p.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-th-card-hover cursor-pointer">
                <input type="checkbox" checked={draft.break_through.includes(p.id)} onChange={() => toggleVip(p.id)} className="w-4 h-4 accent-th-primary" />
                <span className="text-sm">{p.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <SectionLabel t={t}>Your wake-up note</SectionLabel>
        <LockPreview peek={peek} senderName="" extra={preview} />
      </div>

      <div className="space-y-2 pt-1">
        <button onClick={save} disabled={!canSave} className={`w-full py-3 rounded-xl text-sm font-bold disabled:opacity-50 ${t.primary}`}>
          {saving ? 'Saving…' : jar ? 'Save jar' : 'Create jar'}
        </button>
        {jar && (
          <button onClick={remove} className={`w-full py-2 text-xs font-bold ${t.danger}`}>Delete this jar</button>
        )}
      </div>
    </TabBody>
  );
}
