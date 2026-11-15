import type { Tokens } from '../storage/tokens';

/** iOS-style switch, same look as the old Sweet Whispers toggle. */
export function Switch({
  on, onChange, label, disabled,
}: { on: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`w-11 h-6 shrink-0 rounded-full transition-colors duration-200 relative focus:outline-none focus-visible:ring-2 focus-visible:ring-th-primary/50 disabled:opacity-40 ${
        on ? 'bg-th-toggle-on' : 'bg-th-toggle-off'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 bg-white w-5 h-5 rounded-full shadow-md transition-transform duration-200 ${
          on ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export function SectionLabel({ t, children }: { t: Tokens; children: React.ReactNode }) {
  return <p className={`${t.sectionLabel} px-1`}>{children}</p>;
}

/** A setting row: emoji box, title + detail, and a control on the right. */
export function SettingRow({
  t, emoji, title, detail, children, dim,
}: { t: Tokens; emoji: string; title: string; detail: string; children?: React.ReactNode; dim?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 flex items-center gap-3 ${t.card} ${dim ? 'opacity-60' : ''}`}>
      <div className={`w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-lg ${t.iconBox}`} aria-hidden="true">
        {emoji}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-bold">{title}</h4>
        <p className={`text-[11px] mt-0.5 ${t.sub}`}>{detail}</p>
      </div>
      {children}
    </div>
  );
}
