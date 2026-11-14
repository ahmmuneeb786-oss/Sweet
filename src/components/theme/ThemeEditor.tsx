import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronLeft, Redo2, RotateCcw, Undo2, Wand2 } from 'lucide-react';
import { CONTRAST_PAIRS, findContrastIssues } from '../../theme/contrast';
import { resolveTheme } from '../../theme/derive';
import { MAX_NAME } from '../../theme/store';
import { SIMPLE_FIELDS, TOKEN_GROUPS, type SimpleColors, type ThemeData, type TokenKey, type Tokens } from '../../theme/tokens';
import { ColorSheet } from './ColorSheet';
import { TastePreview } from './TastePreview';
import { SheetAction, ThemeSheet } from './ThemeSheet';

export interface EditorInit {
  /** Set when editing a saved theme; absent for a new one / a remix. */
  id?: string;
  name: string;
  data: ThemeData;
  basedOn: string | null;
}

interface ThemeEditorProps {
  init: EditorInit;
  partner: string;
  /** Save (and optionally switch the app to it). Returns false if it couldn't be saved. */
  onSave: (name: string, data: ThemeData, use: boolean) => boolean;
  onClose: () => void;
}

/** What the colour sheet is editing: one of the 4 base colours, or any token. */
type Target = { kind: 'simple'; key: keyof SimpleColors } | { kind: 'token'; key: TokenKey };

// bg / card / ink ARE base colours: editing them in Advanced edits the base.
const BASE_TOKENS: Partial<Record<TokenKey, keyof SimpleColors>> = { bg: 'bg', card: 'card', ink: 'ink' };
const MAX_HISTORY = 30;

const clone = (d: ThemeData): ThemeData => ({ simple: { ...d.simple }, overrides: { ...(d.overrides ?? {}) } });
const sameData = (a: ThemeData, b: ThemeData) => JSON.stringify(clone(a)) === JSON.stringify(clone(b));

function normalizeTarget(t: Target): Target {
  if (t.kind === 'token' && BASE_TOKENS[t.key]) return { kind: 'simple', key: BASE_TOKENS[t.key]! };
  return t;
}

function setColor(data: ThemeData, t: Target, hex: string): ThemeData {
  const next = clone(data);
  const n = normalizeTarget(t);
  if (n.kind === 'simple') next.simple[n.key] = hex;
  else next.overrides![n.key] = hex;
  return next;
}

function labelFor(t: Target): { label: string; hint?: string } {
  if (t.kind === 'simple') {
    const f = SIMPLE_FIELDS.find((s) => s.key === t.key)!;
    return { label: f.label, hint: f.hint };
  }
  for (const g of TOKEN_GROUPS) {
    const tok = g.tokens.find((x) => x.key === t.key);
    if (tok) return { label: tok.label, hint: g.label };
  }
  return { label: t.key };
}

export function ThemeEditor({ init, partner, onSave, onClose }: ThemeEditorProps) {
  const [name, setName] = useState(init.name);
  const [data, setData] = useState<ThemeData>(() => clone(init.data));
  const [past, setPast] = useState<ThemeData[]>([]);
  const [future, setFuture] = useState<ThemeData[]>([]);
  const [mode, setMode] = useState<'simple' | 'advanced'>(
    Object.keys(init.data.overrides ?? {}).length > 0 ? 'advanced' : 'simple',
  );
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ base: true });
  const [editing, setEditing] = useState<Target | null>(null);
  const [leaving, setLeaving] = useState(false);
  // Snapshot when the colour sheet opened: the whole drag is ONE undo step.
  const beforeSheet = useRef<ThemeData | null>(null);

  const tokens: Tokens = useMemo(() => resolveTheme(data), [data]);
  // One row per text colour (your bubble text is checked on both gradient
  // ends — show the worse one, its fix already covers both).
  const issues = useMemo(() => {
    const worst = new Map<TokenKey, ReturnType<typeof findContrastIssues>[number]>();
    for (const i of findContrastIssues(tokens)) {
      const cur = worst.get(i.fg);
      if (!cur || i.ratio < cur.ratio) worst.set(i.fg, i);
    }
    return [...worst.values()];
  }, [tokens]);
  const issueTokens = useMemo(() => new Set(issues.map((i) => i.fg)), [issues]);
  const pins = data.overrides ?? {};

  const changed = name.trim() !== init.name || !sameData(data, init.data);
  const nameOk = name.trim().length > 0;

  // ---- history ----
  const commit = useCallback((before: ThemeData, after: ThemeData) => {
    if (sameData(before, after)) return;
    setPast((p) => [...p, before].slice(-MAX_HISTORY));
    setFuture([]);
  }, []);

  const apply = (next: ThemeData) => {
    commit(data, next);
    setData(next);
  };

  const undo = useCallback(() => {
    if (past.length === 0) return;
    setFuture([data, ...future].slice(0, MAX_HISTORY));
    setData(past[past.length - 1]);
    setPast(past.slice(0, -1));
  }, [past, future, data]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    setPast([...past, data].slice(-MAX_HISTORY));
    setData(future[0]);
    setFuture(future.slice(1));
  }, [past, future, data]);

  // Ctrl/Cmd+Z, Ctrl+Y / Ctrl+Shift+Z — not while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || editing) return;
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, editing]);

  // ---- colour sheet ----
  const openSheet = (t: Target) => {
    beforeSheet.current = data;
    setEditing(normalizeTarget(t));
  };

  const closeSheet = () => {
    if (beforeSheet.current) commit(beforeSheet.current, data);
    beforeSheet.current = null;
    setEditing(null);
  };

  const valueOf = (t: Target) => (t.kind === 'simple' ? data.simple[t.key] : tokens[t.key]);

  /** The text/background pair this colour is judged by, for the sheet's "Aa" badge. */
  const contrastFor = (t: Target) => {
    const key: TokenKey = t.kind === 'simple' ? (t.key === 'accent' ? 'primary' : t.key) : t.key;
    const asText = CONTRAST_PAIRS.find((p) => p.fg === key);
    if (asText) return { hex: tokens[asText.bg], min: asText.min, textIsThis: true };
    const asBg = CONTRAST_PAIRS.find((p) => p.bg === key);
    if (asBg) return { hex: tokens[asBg.fg], min: asBg.min, textIsThis: false };
    return null;
  };

  const unpin = (key: TokenKey) => {
    const next = clone(data);
    delete next.overrides![key];
    apply(next);
  };

  // ---- save / leave ----
  const save = (use: boolean) => {
    if (!nameOk) return;
    if (onSave(name.trim().slice(0, MAX_NAME), clone(data), use)) onClose();
  };

  const back = () => (changed ? setLeaving(true) : onClose());

  const sectionLabel = 'text-[10px] font-bold uppercase tracking-[0.2em] text-th-ink-soft';

  // A plain render helper (not a component), so rows aren't remounted on
  // every colour change while dragging.
  const row = ({ target, label, hint, pinned, onUnpin, warn }: {
    target: Target; label: string; hint?: string; pinned?: boolean; onUnpin?: () => void; warn?: boolean;
  }) => {
    const hex = valueOf(target);
    const id = target.kind === 'simple' ? `s-${target.key}` : `t-${target.key}`;
    return (
      <div key={id} className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => openSheet(target)}
          className="flex-1 min-w-0 flex items-center gap-3 rounded-2xl px-3 py-2.5 bg-th-card border border-th-border hover:bg-th-card-hover transition-colors text-left"
        >
          <span className="w-8 h-8 rounded-xl shrink-0 ring-1 ring-th-border" style={{ background: hex }} aria-hidden="true" />
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-bold text-th-ink">
              <span className="truncate">{label}</span>
              {pinned && <span className="w-1.5 h-1.5 rounded-full bg-th-primary shrink-0" title="Set by you" aria-label="set by you" />}
              {warn && <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-th-danger" aria-label="hard to read" />}
            </span>
            {hint && <span className="block text-[11px] text-th-ink-soft truncate">{hint}</span>}
          </span>
          <span className="text-[11px] font-bold tracking-wider text-th-ink-faint">{hex}</span>
        </button>
        {onUnpin && pinned && (
          <button type="button" onClick={onUnpin} aria-label={`Set ${label} back to automatic`} title="Back to automatic" className="p-2 rounded-xl text-th-ink-soft hover:bg-th-card-hover hover:text-th-ink">
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-full bg-th-panel text-th-ink candy-fade-in flex flex-col">
      <div className="p-6 space-y-5 flex-1">
        {/* Header: back + name */}
        <div className="flex items-center gap-3">
          <button onClick={back} aria-label="Back" className="p-1 -ml-1 rounded-lg text-th-link hover:opacity-80">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <label className="flex-1 min-w-0">
            <span className="sr-only">Theme name</span>
            <input
              value={name}
              maxLength={MAX_NAME}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name your theme"
              className={`w-full rounded-xl px-3 py-2 text-base font-black bg-th-input border-2 outline-none text-th-ink placeholder:text-th-ink-faint transition-colors ${nameOk ? 'border-th-border focus:border-th-primary' : 'border-th-danger'}`}
            />
          </label>
        </div>

        {/* Preview — tap a part to change it */}
        <div className="md:sticky md:top-0 md:z-10 md:-mx-6 md:px-6 md:pt-1 md:pb-2 md:bg-th-panel">
          <TastePreview
            tokens={tokens}
            otherName={partner}
            onPickToken={(key) => openSheet({ kind: 'token', key })}
            caption="Tap any part to change it"
          />
        </div>

        {/* Undo/redo + mode */}
        <div className="flex items-center gap-2">
          <button type="button" onClick={undo} disabled={past.length === 0} aria-label="Undo" title="Undo (Ctrl+Z)" className="p-2 rounded-xl bg-th-secondary text-th-on-secondary disabled:opacity-35 hover:bg-th-card-hover">
            <Undo2 className="w-4 h-4" />
          </button>
          <button type="button" onClick={redo} disabled={future.length === 0} aria-label="Redo" title="Redo (Ctrl+Y)" className="p-2 rounded-xl bg-th-secondary text-th-on-secondary disabled:opacity-35 hover:bg-th-card-hover">
            <Redo2 className="w-4 h-4" />
          </button>
          <div className="ml-auto flex rounded-xl p-1 bg-th-secondary" role="radiogroup" aria-label="Editor mode">
            {(['simple', 'advanced'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors ${mode === m ? 'bg-th-card text-th-ink shadow-sm' : 'text-th-on-secondary opacity-75'}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Readability guard */}
        {issues.length > 0 && (
          <div className="rounded-2xl p-3 space-y-2 bg-th-danger/10 border border-th-danger/30" role="status">
            {issues.map((i) => (
              <div key={i.fg} className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-th-danger" aria-hidden="true" />
                <p className="flex-1 text-xs text-th-ink">
                  <b>{i.label}</b> is hard to read <span className="text-th-ink-soft">({i.ratio.toFixed(1)}:1)</span>
                  {!i.fixable && <span className="block mt-0.5 text-th-ink-soft">{i.advice}</span>}
                </p>
                {i.fixable && (
                  <button
                    type="button"
                    onClick={() => apply(setColor(data, { kind: 'token', key: i.fg }, i.fix))}
                    className="flex items-center gap-1 shrink-0 px-2.5 py-1.5 rounded-xl text-[11px] font-black bg-th-primary text-th-on-primary hover:opacity-90"
                  >
                    <Wand2 className="w-3 h-3" /> Fix it
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {mode === 'simple' ? (
          <section className="space-y-2" aria-label="Colours">
            {SIMPLE_FIELDS.map((f) => row({ target: { kind: 'simple', key: f.key }, label: f.label, hint: f.hint, warn: f.key === 'ink' && issueTokens.has('ink') }))}
            <p className="text-[11px] text-th-ink-faint text-center pt-1">Everything else is matched to these. Switch to Advanced to fine-tune any part.</p>
          </section>
        ) : (
          <section className="space-y-3" aria-label="All colours">
            {[{ id: 'base', label: 'Base colours' }, ...TOKEN_GROUPS.map((g) => ({ id: g.id, label: g.label }))].map((g) => {
              const open = !!openGroups[g.id];
              const group = TOKEN_GROUPS.find((x) => x.id === g.id);
              const pinnedCount = group ? group.tokens.filter((t) => pins[t.key] && !BASE_TOKENS[t.key]).length : 0;
              return (
                <div key={g.id} className="rounded-2xl bg-th-card/50 border border-th-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenGroups((o) => ({ ...o, [g.id]: !open }))}
                    aria-expanded={open}
                    className="w-full flex items-center justify-between px-4 py-3"
                  >
                    <span className={sectionLabel}>{g.label}</span>
                    <span className="flex items-center gap-2">
                      {pinnedCount > 0 && <span className="text-[10px] font-bold text-th-link">{pinnedCount} custom</span>}
                      <ChevronDown className={`w-4 h-4 text-th-ink-soft transition-transform ${open ? 'rotate-180' : ''}`} />
                    </span>
                  </button>
                  {open && (
                    <div className="px-2 pb-2 space-y-1.5">
                      {g.id === 'base'
                        ? SIMPLE_FIELDS.map((f) => row({ target: { kind: 'simple', key: f.key }, label: f.label, hint: f.hint, warn: f.key === 'ink' && issueTokens.has('ink') }))
                        : group!.tokens.map((t) =>
                            BASE_TOKENS[t.key]
                              ? row({ target: { kind: 'token', key: t.key }, label: t.label, hint: 'Base colour', warn: issueTokens.has(t.key) })
                              : row({
                                  target: { kind: 'token', key: t.key },
                                  label: t.label,
                                  pinned: !!pins[t.key],
                                  onUnpin: () => unpin(t.key),
                                  warn: issueTokens.has(t.key),
                                }),
                          )}
                    </div>
                  )}
                </div>
              );
            })}
            <p className="text-[11px] text-th-ink-faint text-center">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-th-primary align-middle mr-1" />
              = set by you · ↺ goes back to automatic
            </p>
          </section>
        )}
      </div>

      {/* Save bar */}
      <div className="sticky bottom-0 z-10 px-6 py-3 bg-th-panel/95 border-t border-th-border flex items-center gap-3">
        <button
          type="button"
          onClick={() => save(false)}
          disabled={!nameOk}
          className="px-4 py-2.5 rounded-2xl text-sm font-bold bg-th-secondary text-th-on-secondary hover:bg-th-card-hover disabled:opacity-40"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => save(true)}
          disabled={!nameOk}
          className="flex-1 px-4 py-2.5 rounded-2xl text-sm font-black bg-th-primary text-th-on-primary shadow-md hover:opacity-90 disabled:opacity-40"
        >
          Save &amp; serve 🍭
        </button>
      </div>

      {editing && (
        <ColorSheet
          label={labelFor(editing).label}
          hint={labelFor(editing).hint}
          value={valueOf(editing)}
          onChange={(hex) => setData((d) => setColor(d, editing, hex))}
          onClose={closeSheet}
          themeColors={[data.simple.accent, tokens.bg, tokens.card, tokens.ink, tokens.bubbleMineTo, tokens.chatHeader, ...Object.values(pins)]}
          contrastWith={contrastFor(editing)}
          onReset={editing.kind === 'token' && pins[editing.key] ? () => {
            setData((d) => { const n = clone(d); delete n.overrides![(editing as { key: TokenKey }).key]; return n; });
          } : undefined}
        />
      )}

      {leaving && (
        <ThemeSheet title="Save your changes?" subtitle={nameOk ? `“${name.trim()}” has changes that aren’t saved.` : 'Your theme has changes that aren’t saved.'} onClose={() => setLeaving(false)}>
          <div className="space-y-2">
            <SheetAction primary label="Save" onClick={() => { setLeaving(false); save(false); }} />
            <SheetAction danger label="Discard changes" onClick={() => { setLeaving(false); onClose(); }} />
            <SheetAction label="Keep editing" onClick={() => setLeaving(false)} />
          </div>
        </ThemeSheet>
      )}
    </div>
  );
}
