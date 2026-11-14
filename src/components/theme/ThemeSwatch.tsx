import { MoreHorizontal, Check } from 'lucide-react';
import type { Tokens } from '../../theme/tokens';

interface ThemeSwatchProps {
  name: string;
  emoji?: string;
  tokens: Tokens;
  /** The theme the app is using right now. */
  inUse: boolean;
  /** The theme shown in the preview (not served yet). */
  tasting: boolean;
  onSelect: () => void;
  /** Hover on desktop: taste without selecting. */
  onHover?: (on: boolean) => void;
  onMore?: () => void;
}

/**
 * A theme card: a mini app drawn in that theme's own colours (background,
 * a card, their bubble and your gradient bubble), plus its name. Uses inline
 * colours, not th-* classes — each card shows its OWN theme, not the app's.
 */
export function ThemeSwatch({ name, emoji, tokens: c, inUse, tasting, onSelect, onHover, onMore }: ThemeSwatchProps) {
  return (
    <div
      className={`relative rounded-2xl p-1.5 transition-all duration-200 ${
        tasting ? 'bg-th-primary/15 ring-2 ring-th-primary scale-[1.02]' : 'bg-th-card border border-th-border hover:border-th-primary/50'
      }`}
      onPointerEnter={(e) => e.pointerType === 'mouse' && onHover?.(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && onHover?.(false)}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={tasting}
        aria-label={`${name}${inUse ? ' (in use)' : ''}`}
        className="block w-full text-left rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-th-primary"
      >
        <div className="rounded-xl overflow-hidden h-20 p-2 flex flex-col gap-1.5" style={{ background: c.bg }} aria-hidden="true">
          <div className="h-2 w-2/3 rounded-full" style={{ background: `linear-gradient(90deg, ${c.chatHeader}, ${c.chatHeaderTo})` }} />
          <div className="rounded-lg px-1.5 py-1 w-3/5" style={{ background: c.bubbleTheirs, boxShadow: `0 0 0 1px ${c.border}` }}>
            <div className="h-1 w-full rounded-full" style={{ background: c.onBubbleTheirs, opacity: 0.7 }} />
          </div>
          <div className="self-end rounded-lg px-1.5 py-1 w-1/2" style={{ background: `linear-gradient(135deg, ${c.bubbleMine}, ${c.bubbleMineTo})` }}>
            <div className="h-1 w-full rounded-full" style={{ background: c.onBubbleMine, opacity: 0.85 }} />
          </div>
          <div className="mt-auto flex items-center gap-1">
            <div className="flex-1 h-2 rounded-full" style={{ background: c.input, boxShadow: `0 0 0 1px ${c.border}` }} />
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: c.primary }} />
          </div>
        </div>
        <div className={`flex items-center gap-1.5 px-1 pt-1.5 pb-0.5 min-w-0 ${onMore ? 'pr-7' : ''}`}>
          {emoji && <span className="text-sm leading-none" aria-hidden="true">{emoji}</span>}
          <span className="text-xs font-bold text-th-ink truncate">{name}</span>
        </div>
      </button>

      {inUse && (
        <span className="absolute top-2.5 left-2.5 flex items-center gap-0.5 rounded-full bg-th-primary text-th-on-primary text-[9px] font-black px-1.5 py-0.5 shadow">
          <Check className="w-2.5 h-2.5" /> In use
        </span>
      )}
      {onMore && (
        <button
          type="button"
          onClick={onMore}
          aria-label={`More options for ${name}`}
          className="absolute bottom-1.5 right-1.5 p-1 rounded-lg text-th-ink-soft hover:bg-th-card-hover hover:text-th-ink transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
