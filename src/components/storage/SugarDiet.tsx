import { useState } from 'react';
import { Check } from 'lucide-react';
import { useConfirm } from '../../contexts/ConfirmContext';
import { planMediaPolicy, enforceMediaPolicy } from '../../lib/mediaCache';
import {
  getStoragePrefs, setStoragePrefs, KEEP_DAY_OPTIONS, MAX_PHOTO_MB_OPTIONS,
  type AutoDownload, type StoragePrefs,
} from '../../lib/storage/prefs';
import { formatBytes } from '../../lib/storage/forecast';
import { TabBody, TabHeader } from './parts';
import type { Tokens } from './tokens';

const AUTO_OPTIONS: { id: AutoDownload; emoji: string; label: string; hint: string }[] = [
  { id: 'always', emoji: '🍬', label: 'Always', hint: 'Photos are ready the moment you open a chat, even offline.' },
  { id: 'wifi', emoji: '📶', label: 'Wi-Fi only', hint: 'Skips background downloads on mobile data. Photos still load when you open them.' },
  { id: 'never', emoji: '🥗', label: 'Never', hint: 'Photos download only when you open them. Lightest on data and space.' },
];

const keepLabel = (d: number) => (d === 0 ? 'Forever' : d === 7 ? '1 week' : d === 30 ? '1 month' : '3 months');
const capLabel = (mb: number) => (mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`);

interface SugarDietProps {
  t: Tokens;
  onBack: () => void;
  /** Called after photos were removed by applying a stricter setting. */
  onFreed: (r: { count: number; bytes: number }) => void;
}

export function SugarDiet({ t, onBack, onFreed }: SugarDietProps) {
  const confirm = useConfirm();
  const [prefs, setPrefs] = useState<StoragePrefs>(getStoragePrefs);
  const [busy, setBusy] = useState(false);

  // Keep / limit changes are dry-run first: if they'd remove photos right
  // away, say exactly how many before applying.
  const choose = async (patch: Partial<StoragePrefs>) => {
    if (busy) return;
    if (patch.autoDownload) {
      setPrefs(setStoragePrefs(patch));
      return;
    }
    setBusy(true);
    try {
      const plan = await planMediaPolicy({ ...prefs, ...patch });
      if (plan.count > 0) {
        const ok = await confirm({
          title: 'Trim your jar now? 🍬',
          message: `${plan.count.toLocaleString()} photo${plan.count === 1 ? '' : 's'} (${formatBytes(plan.bytes)}) will be unwrapped to fit this setting. Keepsakes stay.`,
          confirmLabel: `Free ${formatBytes(plan.bytes)}`,
          cancelLabel: 'Never mind',
        });
        if (!ok) return;
      }
      setPrefs(setStoragePrefs(patch));
      if (plan.count > 0) onFreed(await enforceMediaPolicy());
    } finally {
      setBusy(false);
    }
  };

  return (
    <TabBody t={t}>
      <TabHeader t={t} onBack={onBack} backLabel="Candy Jar" label="Sugar Diet 🥗" />

      <div className={`p-5 rounded-3xl ${t.intro}`}>
        <h2 className="text-lg font-black">How much candy goes in? 🥗</h2>
        <p className={`text-xs leading-relaxed mt-1 ${t.sub}`}>
          Sweet tidies your jar in the background using these rules. Keepsakes and unsent messages are never touched.
        </p>
      </div>

      {/* Auto-download: option cards, like the lock pickers */}
      <div className="space-y-3">
        <p className={`${t.sectionLabel} px-1`}>Auto-download photos</p>
        {AUTO_OPTIONS.map((o) => {
          const on = prefs.autoDownload === o.id;
          return (
            <button
              key={o.id}
              onClick={() => choose({ autoDownload: o.id })}
              role="radio"
              aria-checked={on}
              className={`w-full rounded-2xl p-4 flex items-center gap-3 text-left transition-all ${on ? t.cardSelected : t.card}`}
            >
              <div className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-lg ${t.iconBox}`}>{o.emoji}</div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold">{o.label}</h4>
                <p className={`text-[11px] mt-0.5 ${t.sub}`}>{o.hint}</p>
              </div>
              <span className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${on ? t.radioOn : t.radioOff}`}>
                {on && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="space-y-3">
        <p className={`${t.sectionLabel} px-1`}>Keep unviewed photos for</p>
        <div className={`rounded-2xl p-4 ${t.card}`}>
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Keep unviewed photos for">
            {KEEP_DAY_OPTIONS.map((d) => (
              <button
                key={d}
                role="radio"
                aria-checked={prefs.keepDays === d}
                disabled={busy}
                onClick={() => choose({ keepDays: d })}
                className={`py-2 rounded-xl text-[11px] font-bold transition-colors ${prefs.keepDays === d ? t.pillOn : t.pill}`}
              >
                {keepLabel(d)}
              </button>
            ))}
          </div>
          <p className={`text-[11px] mt-3 leading-snug ${t.sub}`}>⏳ Looking at a photo resets its clock. Keepsakes never expire.</p>
        </div>
      </div>

      <div className="space-y-3">
        <p className={`${t.sectionLabel} px-1`}>Jar size (photo limit)</p>
        <div className={`rounded-2xl p-4 ${t.card}`}>
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Photo storage limit">
            {MAX_PHOTO_MB_OPTIONS.map((mb) => (
              <button
                key={mb}
                role="radio"
                aria-checked={prefs.maxPhotoMB === mb}
                disabled={busy}
                onClick={() => choose({ maxPhotoMB: mb })}
                className={`py-2 rounded-xl text-[11px] font-bold transition-colors ${prefs.maxPhotoMB === mb ? t.pillOn : t.pill}`}
              >
                {capLabel(mb)}
              </button>
            ))}
          </div>
          <p className={`text-[11px] mt-3 leading-snug ${t.sub}`}>🍬 When the jar is full, the photos you looked at longest ago make room for new ones.</p>
        </div>
      </div>
    </TabBody>
  );
}
