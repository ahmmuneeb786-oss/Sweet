import { useState, useEffect } from 'react';
import { X, Search, Eye, Lock, Unlock, Trash2, BellOff, MoreVertical, Palette } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { localDB } from '../db';
import { requestChatListRefresh } from '../hooks/chatListRefresh';
import { useNotify } from '../contexts/NotificationContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePerformance } from '../contexts/PerformanceContext';
import { isSelfChatId } from '../lib/selfChat';
import { usePanelThemeStyle } from '../theme/panelTheme';
import { readMute, muteLeftLabel, setChatMute, type MuteDuration, type MuteState } from '../lib/chatMute';

interface ChatMenuProps {
  theme: 'light' | 'dark' | 'sweet'
  chatId: string;
  onClose: () => void;
  onViewProfile?: () => void;
  /** Opens the per-chat theme sheet ("Just me" / "Both of us"). */
  onOpenTheme?: () => void;
}

// Colours come from the chat's theme (th-* CSS variables). `theme` stays in
// the props for callers but no longer picks colours here.
export function ChatMenu({ chatId, onClose, onViewProfile, onOpenTheme }: ChatMenuProps) {
  const { user } = useAuth();
  const { showSuccess, showError } = useNotify();
  const confirm = useConfirm();
  const { isLowPerfMode } = usePerformance();
  // The search window is a panel: chat theme on a phone, app theme on desktop.
  // (The menu itself stays in the chat's colours — it hangs off the chat header.)
  const panelStyle = usePanelThemeStyle();
  const [showMenu, setShowMenu] = useState(false);
  // Loaded from the server each time the menu opens (it used to always
  // start as 'not muted', so a muted chat still offered 'Mute Chat').
  const [mute, setMute] = useState<MuteState>({ muted: false, until: null });
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    if (user && showMenu) {
      checkLockStatus();
    }
  }, [user, showMenu, chatId]);

  async function checkLockStatus() {
    try {
      const { data, error } = await supabase
        .from('chat_participants')
        .select('is_locked, is_muted, muted_until')
        .eq('chat_id', chatId)
        .eq('user_id', user?.id)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setIsLocked(!!data.is_locked);
        setMute(readMute(data.is_muted, data.muted_until));
      }
    } catch (error) {
      console.error('Error checking lock status:', error);
    }
  }

  async function handleMuteChat(duration: MuteDuration | null) {
    if (!user) return;
    try {
      const next = await setChatMute(chatId, user.id, duration);
      setMute(next);
      showSuccess(duration === null
        ? 'Notifications are back on for this chat 🔔'
        : duration === 'forever'
          ? 'Chat muted until you unmute it 🔕'
          : `Chat muted for ${duration === '8h' ? '8 hours' : '1 week'} 🔕`);
    } catch (error) {
      console.error('Error muting chat:', error);
      showError('Could not change mute — check your connection and try again.');
    }
  }

  async function handleLockChat() {
    if (!user) return;

    const newLockState = !isLocked;
    
    try {
      const { error } = await supabase
        .from('chat_participants')
        .update({ is_locked: newLockState })
        .eq('chat_id', chatId)
        .eq('user_id', user.id);

      if (error) throw error;

      // Flip the flag on the cached row instead of deleting it — the vault
      // reads this same row offline, and ChatList filters on it.
      await localDB.chats.update(chatId, { is_locked: newLockState });
      requestChatListRefresh();

      showSuccess(newLockState
        ? 'Conversation moved to your secure Locked Chats vault! 🔒'
        : 'Conversation restored to your main chat feed! 🔓');

      setIsLocked(newLockState);
      setShowMenu(false);
      onClose();
    } catch (error) {
      console.error('Error locking conversation:', error);
      showError(newLockState ? 'Failed to lock conversation.' : 'Failed to unlock conversation.');
    }
  }

  async function handleClearChat() {
    if (!user) return;
    const confirmed = await confirm({
      title: 'Clear chat history?',
      message: 'Clear all messages in this chat? This cannot be undone.',
      confirmLabel: 'Clear',
      danger: true,
    });
    if (!confirmed) return;

    try {
      // 1. Tell Supabase server
      await supabase
        .from('messages')
        .update({ is_deleted: true })
        .eq('chat_id', chatId)
        .eq('sender_id', user.id);

      // 2. 🔴 SYNC SYSTEM: Instantly wipe preview text out of internal memory cache
      const cachedRecord = await localDB.chats.get(chatId);
      if (cachedRecord) {
        await localDB.chats.update(chatId, {
          last_message_content: undefined,
          last_message_time: undefined
        });
      }

      showSuccess('Chat history cleared locally! 🧹');
      window.location.reload();
    } catch (error) {
      console.error('Error clearing chat:', error);
    }
  }

  const isSelf = isSelfChatId(chatId);
  const menuItems = [
    { icon: Search, label: 'Search Messages', action: () => setShowSearch(true) },
    // No profile to view in Saved Messages / groups, and nothing to mute in your own notes.
    ...(onViewProfile ? [{ icon: Eye, label: 'View Profile', action: () => onViewProfile() }] : []),
    ...(onOpenTheme ? [{ icon: Palette, label: 'Chat Theme', action: () => onOpenTheme() }] : []),
    // Unmute lives in the list; muting uses the duration buttons below.
    ...(!isSelf && mute.muted ? [{ icon: BellOff, label: `Unmute Chat (${muteLeftLabel(mute)})`, action: () => handleMuteChat(null) }] : []),
    { icon: isLocked ? Unlock : Lock, 
      label: isLocked ? 'Unlock Chat' : 'Lock Chat', 
      action: handleLockChat 
    },
    { icon: Trash2, label: 'Clear Chat', action: handleClearChat, danger: true }
  ];

  return (
    <div className="relative inline-block">
      {/* 1. MENU TRIGGER BUTTON */}
      <button
        onClick={() => setShowMenu(!showMenu)}
        aria-label="Chat options"
        className="p-2 hdr-hover rounded-full transition-colors active:scale-90"
      >
        {/* Inherits the header's text colour, so it reads on any header. */}
        <MoreVertical className="w-5 h-5" />
      </button>

      {/* 2. MENU DROPDOWN / BOTTOM SHEET */}
      {showMenu && (
        <>
          {/* Background Overlay */}
          <div
            className={`fixed inset-0 z-40 bg-black/20 ${isLowPerfMode ? '' : 'backdrop-blur-[1px]'}`}
            onClick={() => { setShowMenu(false); onClose(); }}
          />
          
          {/* Main Menu Container */}
          <div className={`
            /* Mobile: a compact floating card — rounded on ALL corners, sitting
               above the bottom edge with side margins (not a full-width sheet),
               height-capped so it never covers half the screen. */
            fixed bottom-4 left-3 right-3 z-50 rounded-3xl p-2 max-h-[70vh] overflow-y-auto scrollbar-hide
            /* Desktop: small dropdown anchored under the trigger. */
            md:absolute md:top-full md:bottom-auto md:left-auto md:right-0 md:w-56 md:rounded-2xl md:p-1.5 md:max-h-none md:overflow-visible
            shadow-2xl border transition-all animate-in slide-in-from-bottom-4 md:slide-in-from-top-2 duration-300
            bg-gradient-to-b from-th-card to-th-panel border-th-border text-th-ink
          `}>

            {/* Loop through Menu Items */}
            {menuItems.map((item, idx) => {
              const Icon = item.icon;
              return (
                <button
                  key={idx}
                  onClick={() => {
                    item.action();
                    setShowMenu(false);
                    onClose();
                  }}
                  className={`w-full px-4 py-3 md:py-2 text-left flex items-center gap-3 rounded-2xl md:rounded-lg transition-colors active:scale-[0.98] ${
                    'hover:bg-th-card-hover text-th-ink'
                  } ${item.danger ? '!text-th-danger' : ''}`}
                >
                  <Icon className="w-5 h-5 md:w-4 md:h-4 flex-shrink-0" />
                  <span className="text-[15px] md:text-sm font-medium">{item.label}</span>
                </button>
              );
            })}

            {/* Mute Section — not for your own notes, and replaced by the
                "Unmute Chat" item above while the chat is muted. */}
            {!isSelf && !mute.muted && (<>
            <div className="border-t my-1.5 mx-2 border-th-border" />

            <div className="px-4 md:px-2 py-1.5">
              <p className="text-[10px] font-bold uppercase tracking-widest mb-2 text-th-ink-soft">
                Mute Notifications
              </p>

              <div className="flex gap-2 md:flex-col">
                {([
                  { label: '8h', value: '8h' },
                  { label: '1w', value: '1w' },
                  { label: 'Always', value: 'forever' }
                ] as { label: string; value: MuteDuration }[]).map((option) => (
                  <button
                    key={option.value}
                    onClick={() => { handleMuteChat(option.value); setShowMenu(false); onClose(); }}
                    className={`flex-1 md:w-full px-3 py-2.5 md:py-1.5 text-center md:text-left text-xs font-bold rounded-xl transition-colors active:scale-95 ${
                      'bg-th-secondary text-th-on-secondary hover:bg-th-card-hover'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            </>)}
          </div>
        </>
      )}

      {/* 3. SEARCH MESSAGES MODAL */}
      {showSearch && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-20" style={panelStyle}>
          <div 
            className={`fixed inset-0 bg-black/60 ${isLowPerfMode ? '' : 'backdrop-blur-sm'}`} 
            onClick={() => { setShowSearch(false); onClose(); }} 
          />
          
          <div className={`relative w-full max-w-lg rounded-2xl shadow-2xl p-4 border animate-in zoom-in-95 duration-200 ${
            'bg-th-card border-th-border text-th-ink'
          }`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-th-ink">
                Search Messages
              </h3>
              <button
                onClick={() => { setShowSearch(false); onClose(); }}
                aria-label="Close search"
                className="p-1 hover:bg-th-card-hover rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in conversation..."
              autoFocus
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-th-primary/50 transition-colors bg-th-input border-th-border text-th-ink placeholder:text-th-ink-faint"
            />
          </div>
        </div>
      )}
    </div>
  );
}