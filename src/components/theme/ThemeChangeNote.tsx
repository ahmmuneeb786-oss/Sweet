import { Palette } from 'lucide-react';
import { useNotify } from '../../contexts/NotificationContext';
import { useTheme } from '../../theme/ThemeProvider';
import { themeActions } from '../../theme/store';

interface ThemeChangeNoteProps {
  chatId: string;
  /** The new theme's label as the server wrote it, e.g. "💖 Best Friend". */
  label: string;
  isOwn: boolean;
  senderName: string;
  /** This is the newest theme note and the chat still has a shared theme. */
  canAdopt: boolean;
}

/**
 * The centred note a 'theme_change' message shows as: "Ali changed the chat
 * theme to 💖 Best Friend". If I have my own "Just me" theme for this chat
 * (so I can't see the shared one), the NEWEST note offers "Use it", which
 * drops mine — only while the chat still has a shared theme to show.
 */
export function ThemeChangeNote({ chatId, label, isOwn, senderName, canAdopt }: ThemeChangeNoteProps) {
  const { library } = useTheme();
  const { showSuccess } = useNotify();
  const hiddenByMine = canAdopt && !isOwn && !!library.overrides[chatId];

  return (
    <div className="flex flex-col items-center gap-1.5 my-3 px-4" role="note">
      <div className="flex items-center gap-1.5 max-w-full rounded-full px-3 py-1.5 bg-th-card/80 border border-th-border shadow-sm text-[11px] text-th-ink-soft">
        <Palette className="w-3.5 h-3.5 shrink-0 text-th-link" aria-hidden="true" />
        <span className="truncate">
          <b className="text-th-ink">{isOwn ? 'You' : senderName}</b> changed the chat theme to <b className="text-th-ink">{label || 'Default'}</b>
        </span>
      </div>
      {hiddenByMine && (
        <button
          type="button"
          onClick={() => {
            themeActions.setChatOverride(chatId, null);
            showSuccess(`Now showing ${label || 'the shared theme'}`);
          }}
          className="text-[11px] font-bold text-th-link hover:opacity-80"
        >
          You’re using your own theme here · Use it
        </button>
      )}
    </div>
  );
}
