import { useMemo, useState } from 'react';
import { Check, Heart, User } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotify } from '../../contexts/NotificationContext';
import { useTheme } from '../../theme/ThemeProvider';
import { resolveTheme } from '../../theme/derive';
import { CHAT_PRESETS } from '../../theme/presets';
import { rememberSharedTheme } from '../../theme/sharedChatTheme';
import { themeActions, type ChatTheme } from '../../theme/store';
import { chatThemeLabel, chatThemeTokens, type ResolvedChatTheme } from '../../theme/useChatTheme';
import { TastePreview } from './TastePreview';
import { ThemeSheet } from './ThemeSheet';

interface ChatThemeSheetProps {
  chatId: string;
  /** The other person's name (for the copy and the preview). */
  partnerName: string;
  /** Saved Messages: there's nobody to share with, so only "Just me". */
  isSelfChat: boolean;
  current: ResolvedChatTheme;
  onClose: () => void;
}

/**
 * Same theme? A custom theme shared with a chat is a copy stored WITHOUT its
 * id, so when either side has no id, match on name + the colours it draws
 * (resolved tokens, so key order in the stored data doesn't matter).
 */
function same(a: ChatTheme | null, b: ChatTheme | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'preset') return a.id === (b as typeof a).id;
  const c = b as typeof a;
  if (a.id && c.id) return a.id === c.id;
  return a.name === c.name && JSON.stringify(resolveTheme(a.data)) === JSON.stringify(resolveTheme(c.data));
}

/**
 * Chat theme picker. "Just me" saves a personal theme only this user sees;
 * "Both of us" changes the chat for both people and posts a note in the chat
 * (that note is the other person's notification).
 */
export function ChatThemeSheet({ chatId, partnerName, isSelfChat, current, onClose }: ChatThemeSheetProps) {
  const { user } = useAuth();
  const { data: appData, tokens: appTokens, library } = useTheme();
  const { showSuccess, showError } = useNotify();

  const [scope, setScope] = useState<'mine' | 'both'>(isSelfChat || current.source !== 'shared' ? 'mine' : 'both');
  const [selected, setSelected] = useState<ChatTheme | null>((scope === 'mine' ? current.mine : current.shared) ?? current.mine ?? current.shared);
  const [busy, setBusy] = useState(false);
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;

  const options: { theme: ChatTheme | null; label: string; emoji: string; swatch: [string, string] }[] = useMemo(() => [
    { theme: null, label: 'Default', emoji: '✨', swatch: [appTokens.bubbleMine, appTokens.bubbleMineTo] },
    ...CHAT_PRESETS.map((p) => ({ theme: { kind: 'preset', id: p.id } as ChatTheme, label: p.name, emoji: p.emoji, swatch: [p.accent, p.to] as [string, string] })),
    ...library.themes.map((t) => {
      const tk = chatThemeTokens({ kind: 'custom', id: t.id, name: t.name, data: t.data }, appData, library.themes);
      return { theme: { kind: 'custom', id: t.id, name: t.name, data: t.data } as ChatTheme, label: t.name, emoji: '🎨', swatch: [tk.bubbleMine, tk.bubbleMineTo] as [string, string] };
    }),
  ], [appData, appTokens, library.themes]);

  // What the chat would look like after Apply.
  const previewTokens = useMemo(() => {
    if (selected) return chatThemeTokens(selected, appData, library.themes);
    // "Default" just for me = drop my theme, so the shared one (if any) shows.
    if (scope === 'mine' && current.shared) return chatThemeTokens(current.shared, appData, library.themes);
    return appTokens;
  }, [selected, scope, current.shared, appData, appTokens, library.themes]);

  const unchanged = scope === 'mine' ? same(selected, current.mine) : same(selected, current.shared);

  const apply = async () => {
    if (busy) return;
    if (scope === 'mine') {
      themeActions.setChatOverride(chatId, selected);
      showSuccess(selected ? `${chatThemeLabel(selected)} — just for you` : 'Personal chat theme removed');
      onClose();
      return;
    }
    setBusy(true);
    const { error } = await themeActions.setSharedChatTheme(chatId, selected);
    setBusy(false);
    if (error) return showError(error);
    const shared = selected?.kind === 'custom' ? { kind: 'custom', name: selected.name, data: selected.data } : selected;
    rememberSharedTheme(chatId, shared, user?.id ?? null);
    showSuccess(`${chatThemeLabel(selected)} for both of you 💞`);
    onClose();
  };

  const sectionLabel = 'text-[10px] font-bold uppercase tracking-[0.2em] text-th-ink-soft';

  return (
    <ThemeSheet title="Chat theme" subtitle={isSelfChat ? 'Saved Messages' : `With ${partnerName}`} onClose={onClose}>
      <TastePreview tokens={previewTokens} otherName={isSelfChat ? 'You' : partnerName} />

      {!isSelfChat && (
        <div className="space-y-1.5">
          <p className={sectionLabel}>Apply for</p>
          <div className="grid grid-cols-2 gap-1 rounded-2xl p-1 bg-th-secondary" role="radiogroup" aria-label="Who sees this theme">
            {([
              { id: 'mine', label: 'Just me', icon: <User className="w-3.5 h-3.5" /> },
              { id: 'both', label: 'Both of us', icon: <Heart className="w-3.5 h-3.5" /> },
            ] as const).map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={scope === o.id}
                onClick={() => {
                  setScope(o.id);
                  setSelected((o.id === 'mine' ? current.mine : current.shared) ?? null);
                }}
                className={`flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-bold transition-colors ${
                  scope === o.id ? 'bg-th-card text-th-ink shadow-sm' : 'text-th-on-secondary opacity-75'
                }`}
              >
                {o.icon} {o.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-th-ink-soft">
            {scope === 'mine'
              ? `Only you see it. ${partnerName} keeps their own look.`
              : `Changes it for ${partnerName} too — they'll get a note in the chat.`}
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <p className={sectionLabel}>Themes</p>
        <div className="grid grid-cols-2 gap-2">
          {options.map((o) => {
            const isSel = same(o.theme, selected);
            return (
              <button
                key={o.theme ? (o.theme.kind === 'preset' ? o.theme.id : o.theme.id ?? o.label) : 'default'}
                type="button"
                onClick={() => setSelected(o.theme)}
                aria-pressed={isSel}
                className={`relative flex items-center gap-2 rounded-2xl p-2 text-left transition-colors ${
                  isSel ? 'ring-2 ring-th-primary bg-th-primary/10' : 'bg-th-card border border-th-border hover:bg-th-card-hover'
                }`}
              >
                <span className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center text-sm" style={{ background: `linear-gradient(135deg, ${o.swatch[0]}, ${o.swatch[1]})` }} aria-hidden="true">
                  {o.emoji}
                </span>
                <span className="text-xs font-bold text-th-ink truncate">{o.label}</span>
                {isSel && <Check className="absolute top-1.5 right-1.5 w-3.5 h-3.5 text-th-link" />}
              </button>
            );
          })}
        </div>
        {scope === 'mine' && !selected && current.shared && (
          <p className="text-[11px] text-th-ink-soft">You’ll see the chat’s shared theme, {chatThemeLabel(current.shared)}.</p>
        )}
      </div>

      {scope === 'both' && !online && (
        <p className="text-[11px] text-th-danger">You’re offline — connect to change it for both of you.</p>
      )}

      <button
        type="button"
        onClick={() => void apply()}
        disabled={busy || unchanged || (scope === 'both' && !online)}
        className="w-full py-3 rounded-2xl text-sm font-black bg-th-primary text-th-on-primary hover:opacity-90 disabled:opacity-40"
      >
        {busy ? 'Applying…' : scope === 'both' ? 'Apply for both of us 💞' : 'Apply just for me'}
      </button>

      {current.mine && (
        <button
          type="button"
          onClick={() => {
            themeActions.setChatOverride(chatId, null);
            showSuccess('Personal chat theme removed');
            onClose();
          }}
          className="w-full text-xs font-bold text-th-link hover:opacity-80"
        >
          Remove my personal theme
        </button>
      )}
    </ThemeSheet>
  );
}
