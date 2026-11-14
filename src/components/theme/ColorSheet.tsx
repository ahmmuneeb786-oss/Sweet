import { useEffect, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { Pipette, RotateCcw } from 'lucide-react';
import { readStorage, writeStorage } from '../../lib/safeStorage';
import { contrast, normalizeHex } from '../../theme/color';
import { ThemeSheet } from './ThemeSheet';

const RECENT_KEY = 'sweet_recent_colors';
const MAX_RECENT = 8;

export function readRecentColors(): string[] {
  try {
    const list = JSON.parse(readStorage(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.map((c) => normalizeHex(c)).filter((c): c is string => !!c).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function pushRecentColor(hex: string) {
  const list = [hex, ...readRecentColors().filter((c) => c !== hex)].slice(0, MAX_RECENT);
  writeStorage(RECENT_KEY, JSON.stringify(list));
}

// The EyeDropper API (Chromium desktop). Not in TypeScript's DOM lib yet.
type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
const EyeDropper = (typeof window !== 'undefined' ? (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper : undefined);

export interface ColorSheetProps {
  label: string;
  hint?: string;
  value: string;
  /** Called live while dragging/typing — the preview follows. */
  onChange: (hex: string) => void;
  /** Closing the sheet (Done, backdrop, Escape). */
  onClose: () => void;
  /** Colours already in this theme, offered as one-tap swatches. */
  themeColors: string[];
  /** What this colour is read against, for the "Aa" readability badge. */
  contrastWith?: { hex: string; min: number; textIsThis: boolean } | null;
  /** Shown when the colour is pinned and can go back to the calculated one. */
  onReset?: () => void;
}

function Swatch({ hex, selected, onPick }: { hex: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={hex}
      aria-pressed={selected}
      className={`w-7 h-7 rounded-full shrink-0 transition-transform hover:scale-110 ${selected ? 'ring-2 ring-offset-2 ring-th-ink ring-offset-th-card' : 'ring-1 ring-th-border'}`}
      style={{ background: hex }}
    />
  );
}

/** Hex field + colour wheel + recent / theme colours + eyedropper. */
export function ColorSheet({ label, hint, value, onChange, onClose, themeColors, contrastWith, onReset }: ColorSheetProps) {
  const [text, setText] = useState(value);
  const [recent] = useState(readRecentColors);
  const typing = useRef(false);
  const startValue = useRef(value);

  // Keep the field in step with the wheel, but not while the user types in it.
  useEffect(() => {
    if (!typing.current) setText(value);
  }, [value]);

  const valid = normalizeHex(text) !== null;

  const close = () => {
    if (value !== startValue.current) pushRecentColor(value);
    onClose();
  };

  const pickWithEyedropper = async () => {
    if (!EyeDropper) return;
    try {
      const { sRGBHex } = await new EyeDropper().open();
      const hex = normalizeHex(sRGBHex);
      if (hex) onChange(hex);
    } catch {
      // cancelled
    }
  };

  const uniqueTheme = [...new Set(themeColors)].filter((c) => !recent.includes(c)).slice(0, 8);
  const ratio = contrastWith ? contrast(value, contrastWith.hex) : null;
  const readable = ratio !== null && contrastWith ? ratio >= contrastWith.min : true;

  return (
    <ThemeSheet title={label} subtitle={hint} onClose={close}>
      <div className="theme-color-picker">
        <HexColorPicker color={value} onChange={(c) => onChange(c.toUpperCase())} />
      </div>

      <div className="flex items-center gap-2">
        <div className="w-11 h-11 rounded-2xl shrink-0 ring-1 ring-th-border" style={{ background: value }} aria-hidden="true" />
        <label className="flex-1 min-w-0">
          <span className="sr-only">Hex colour</span>
          <span className={`flex items-center rounded-2xl px-3 py-2.5 bg-th-input border-2 transition-colors ${valid ? 'border-th-border focus-within:border-th-primary' : 'border-th-danger'}`}>
            <span className="text-sm font-bold text-th-ink-faint">#</span>
            <input
              value={text.replace(/^#/, '')}
              onFocus={() => { typing.current = true; }}
              onBlur={() => { typing.current = false; setText(value); }}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
                setText(raw);
                const hex = normalizeHex(raw.length === 3 || raw.length === 6 ? raw : '');
                if (hex) onChange(hex);
              }}
              inputMode="text"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={6}
              aria-invalid={!valid}
              className="w-full bg-transparent outline-none text-sm font-bold uppercase tracking-wider text-th-ink ml-0.5"
            />
          </span>
        </label>
        {EyeDropper && (
          <button type="button" onClick={pickWithEyedropper} aria-label="Pick a colour from the screen" className="w-11 h-11 rounded-2xl shrink-0 flex items-center justify-center bg-th-secondary text-th-on-secondary hover:bg-th-card-hover">
            <Pipette className="w-4 h-4" />
          </button>
        )}
      </div>
      {!valid && <p className="text-[11px] -mt-2 text-th-danger">Use 3 or 6 hex digits, like FF1493.</p>}

      {ratio !== null && contrastWith && (
        <div className={`flex items-center gap-2.5 rounded-2xl px-3 py-2 ${readable ? 'bg-th-secondary' : 'bg-th-danger/10'}`}>
          <span
            className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-black shrink-0"
            style={contrastWith.textIsThis ? { color: value, background: contrastWith.hex } : { color: contrastWith.hex, background: value }}
            aria-hidden="true"
          >
            Aa
          </span>
          <p className={`text-[11px] font-bold ${readable ? 'text-th-on-secondary' : 'text-th-danger'}`}>
            {readable ? '✓ Easy to read' : '⚠ Hard to read'} · {ratio.toFixed(1)}:1
            <span className="font-normal opacity-75"> (needs {contrastWith.min}:1)</span>
          </p>
        </div>
      )}

      {recent.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-th-ink-soft">Recent</p>
          <div className="flex gap-2 flex-wrap">
            {recent.map((c) => <Swatch key={c} hex={c} selected={c === value} onPick={() => onChange(c)} />)}
          </div>
        </div>
      )}
      {uniqueTheme.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-th-ink-soft">In this theme</p>
          <div className="flex gap-2 flex-wrap">
            {uniqueTheme.map((c) => <Swatch key={c} hex={c} selected={c === value} onPick={() => onChange(c)} />)}
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        {onReset && (
          <button type="button" onClick={onReset} className="flex items-center gap-1.5 px-4 py-3 rounded-2xl text-sm font-bold bg-th-secondary text-th-on-secondary hover:bg-th-card-hover">
            <RotateCcw className="w-4 h-4" /> Auto
          </button>
        )}
        <button type="button" onClick={close} className="flex-1 py-3 rounded-2xl text-sm font-black bg-th-primary text-th-on-primary hover:opacity-90">
          Done
        </button>
      </div>
    </ThemeSheet>
  );
}
