import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { Send } from 'lucide-react';
import { tokensToVars } from '../../theme/apply';
import type { TokenKey, Tokens } from '../../theme/tokens';

interface TastePreviewProps {
  tokens: Tokens;
  otherName: string;
  /** Step 4 (editor): tap a part of the preview to edit that colour. */
  onPickToken?: (key: TokenKey) => void;
  caption?: ReactNode;
}

/**
 * "Taste Test": a tiny fake chat painted with any theme. Its own root carries
 * the theme as CSS variables, so the th-* classes inside resolve to THESE
 * colours — the rest of the app is untouched. Every one of the 28 tokens is
 * visible somewhere, so any change can be seen.
 */
export function TastePreview({ tokens, otherName, onPickToken, caption }: TastePreviewProps) {
  const style = useMemo(() => tokensToVars(tokens) as CSSProperties, [tokens]);
  // Header text has to read on both ends of the header gradient (same rule as the chat).
  const headerInk = tokens.onChatHeader;

  // Picking is optional: without onPickToken the parts are plain elements.
  const pick = (key: TokenKey) =>
    onPickToken
      ? {
          role: 'button',
          tabIndex: 0,
          'data-token': key,
          onClick: (e: React.MouseEvent) => { e.stopPropagation(); onPickToken(key); },
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPickToken(key); }
          },
          className: 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-th-ink/50',
        }
      : { className: '' };

  const initial = (n: string) => n.trim().charAt(0).toUpperCase() || '?';

  return (
    <figure style={style} className="rounded-3xl p-3 bg-th-bg border border-th-border transition-colors duration-300" aria-label="Theme preview">
      <div className="rounded-2xl overflow-hidden border border-th-border shadow-sm">
        {/* Chat header */}
        <div {...pick('chatHeader')} className={`flex items-center gap-2.5 px-3 py-2.5 bg-gradient-to-r from-th-chat-header to-th-chat-header-to ${pick('chatHeader').className}`}>
          <div className="relative">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black" style={{ color: headerInk, background: `${headerInk}40` }}>
              {initial(otherName)}
            </div>
            <span {...pick('online')} className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-th-online ring-2 ring-th-chat-header ${pick('online').className}`} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold truncate" style={{ color: headerInk }}>{otherName}</p>
            <p className="text-[10px] opacity-80" style={{ color: headerInk }}>online</p>
          </div>
        </div>

        {/* Messages on the wallpaper */}
        <div {...pick('wallpaper')} className={`bg-th-wallpaper px-3 py-3 space-y-2 ${pick('wallpaper').className}`}>
          <div {...pick('bubbleTheirs')} className={`max-w-[78%] w-fit rounded-2xl rounded-bl-md px-3 py-1.5 bg-th-bubble-theirs text-th-on-bubble-theirs text-xs shadow-sm ${pick('bubbleTheirs').className}`}>
            hiii 🍬 look <span {...pick('link')} className={`font-semibold underline text-th-link ${pick('link').className}`}>sweet.link</span>
          </div>
          <div className="flex justify-end">
            <div {...pick('bubbleMine')} className={`max-w-[78%] w-fit rounded-2xl rounded-br-md px-3 py-1.5 bg-gradient-to-br from-th-bubble-mine to-th-bubble-mine-to text-th-on-bubble-mine text-xs shadow-sm ${pick('bubbleMine').className}`}>
              missed you 💕
            </div>
          </div>
          <div className="flex justify-end">
            <div {...pick('bubbleMineTo')} className={`max-w-[78%] w-fit rounded-2xl rounded-br-md px-3 py-1.5 bg-gradient-to-br from-th-bubble-mine to-th-bubble-mine-to text-th-on-bubble-mine text-xs shadow-sm ${pick('bubbleMineTo').className}`}>
              come over? 🍰
            </div>
          </div>
          <div className="w-fit rounded-2xl rounded-bl-md px-3 py-2 bg-th-bubble-theirs flex gap-1" aria-label="typing">
            {[0, 1, 2].map((i) => (
              <span key={i} {...pick('inkFaint')} className={`w-1.5 h-1.5 rounded-full bg-th-ink-faint ${pick('inkFaint').className}`} />
            ))}
          </div>
        </div>

        {/* Input bar */}
        <div {...pick('panel')} className={`flex items-center gap-2 px-2.5 py-2 bg-th-panel border-t border-th-border ${pick('panel').className}`}>
          <div {...pick('input')} className={`flex-1 rounded-full px-3 py-1.5 bg-th-input border border-th-border text-[11px] text-th-ink-faint ${pick('input').className}`}>
            Type a message…
          </div>
          <div {...pick('primary')} className={`w-7 h-7 rounded-full bg-th-primary text-th-on-primary flex items-center justify-center ${pick('primary').className}`}>
            <Send className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>

      {/* A settings row + controls: the non-chat colours */}
      <div className="mt-2.5 space-y-1.5">
        <div {...pick('card')} className={`flex items-center gap-2.5 rounded-xl px-3 py-2 bg-th-card border border-th-border ${pick('card').className}`}>
          <div className="flex-1 min-w-0">
            <p {...pick('ink')} className={`text-xs font-bold text-th-ink ${pick('ink').className}`}>Notifications</p>
            <p {...pick('inkSoft')} className={`text-[10px] text-th-ink-soft ${pick('inkSoft').className}`}>Sounds and badges</p>
          </div>
          <span {...pick('badge')} className={`min-w-[18px] h-[18px] px-1 rounded-full bg-th-badge text-th-on-primary text-[10px] font-black flex items-center justify-center ${pick('badge').className}`}>3</span>
          <span {...pick('toggleOn')} className={`w-8 h-[18px] rounded-full bg-th-toggle-on p-0.5 flex justify-end ${pick('toggleOn').className}`}>
            <span className="w-3.5 h-3.5 rounded-full bg-white shadow" />
          </span>
        </div>
        <div {...pick('cardHover')} className={`flex items-center gap-2.5 rounded-xl px-3 py-2 bg-th-card-hover border border-th-border ${pick('cardHover').className}`}>
          <p className="flex-1 text-xs font-bold text-th-ink">Read receipts</p>
          <span {...pick('toggleOff')} className={`w-8 h-[18px] rounded-full bg-th-toggle-off p-0.5 flex ${pick('toggleOff').className}`}>
            <span className="w-3.5 h-3.5 rounded-full bg-white shadow" />
          </span>
        </div>
        <div className="flex gap-1.5">
          <span {...pick('secondary')} className={`flex-1 text-center rounded-lg py-1.5 bg-th-secondary text-th-on-secondary text-[11px] font-bold ${pick('secondary').className}`}>Maybe later</span>
          <span {...pick('danger')} className={`flex-1 text-center rounded-lg py-1.5 border border-th-danger/40 text-th-danger text-[11px] font-bold ${pick('danger').className}`}>Delete</span>
        </div>
      </div>
      {caption && <figcaption className="mt-2 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-th-ink-soft">{caption}</figcaption>}
    </figure>
  );
}
