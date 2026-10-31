import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Lock, MessageSquare } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { localDB } from '../db';
import { VaultGate } from './VaultGate';
import { OfflineBadge } from './OfflineBadge';
import { useNotify } from '../contexts/NotificationContext';
import { grantChatAccess } from '../lib/vault';
import { onChatListRefresh } from '../hooks/chatListRefresh';

interface LockedChatsPanelProps {
  theme: 'light' | 'dark' | 'sweet';
  onClose: () => void;
  onSelectChat: (chatId: string) => void;
}

interface Chat {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  avatar_url: string | null;
  theme: string;
  otherUser?: {
    display_name: string;
    avatar_url: string | null;
  };
}

export function LockedChatsPanel({ theme, onClose, onSelectChat }: LockedChatsPanelProps) {
  const { user } = useAuth();
  const { showError } = useNotify();
  const [lockedChats, setLockedChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  // Chat being verified — the panel stays open behind the gate so
  // cancelling lands back here, not on the main list.
  const [verifyingChatId, setVerifyingChatId] = useState<string | null>(null);

  // Overlapping reloads (e.g. realtime + reconnect at once) — only the
  // newest one may update the list.
  const loadSeqRef = useRef(0);

  useEffect(() => {
    if (!user) return;
    loadLockedChats();

    // Keep the list current while the panel is open: a chat locked or
    // unlocked here (ChatMenu fires the chat-list refresh) or on another
    // device (realtime), or a reconnect after being offline.
    const unsubscribeRefresh = onChatListRefresh(() => loadLockedChats());
    const onReconnect = () => loadLockedChats();
    window.addEventListener('online', onReconnect);
    const channel = supabase
      .channel(`locked-chats-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_participants', filter: `user_id=eq.${user.id}` },
        () => loadLockedChats()
      )
      .subscribe();

    return () => {
      unsubscribeRefresh();
      window.removeEventListener('online', onReconnect);
      supabase.removeChannel(channel);
    };
  }, [user]);

  async function loadLockedChats() {
    if (!user) return;

    const seq = ++loadSeqRef.current;
    const isLatest = () => seq === loadSeqRef.current;
    let hadCache = false;

    try {
      // No setLoading(true) here: the first load starts with the spinner
      // already on, and background refreshes shouldn't blank the list.

      // =========================================================
      // STEP 1: OFFLINE CACHE LAYER (Load from localDB instantly!)
      // =========================================================
      // In a strict offline system, we fetch all local chats.
      // Since locked chats are hidden from the main screen, we find them here.
      const allLocalChats = await localDB.chats.toArray();
      
      // Let's look up which chat IDs belong to this user and are flagged as locked.
      // If your localDB doesn't have an explicit 'is_locked' property on the chat yet, 
      // it will fall back to the online sync below. If it does, we map them immediately:
      const cachedLockedChats = allLocalChats
        .filter((c) => c.is_locked === true)
        .map((chat) => ({
          id: chat.id,
          type: chat.type,
          name: chat.name || 'Private Chat',
          avatar_url: chat.avatar_url || null,
          theme: chat.theme,
          otherUser: chat.other_user_id ? {
            display_name: chat.other_user_name || '',
            avatar_url: chat.other_user_avatar || null,
          } : undefined
        }));

      if (cachedLockedChats.length > 0) {
        hadCache = true;
        if (isLatest()) setLockedChats(cachedLockedChats);
      }

      // =========================================================
      // STEP 2: ONLINE REFRESH & BACKGROUND SYNC LAYER
      // =========================================================
      if (navigator.onLine) {
        const { data: participants, error: pError } = await supabase
          .from('chat_participants')
          .select(`
            chat_id,
            chats:chat_id (
              id,
              type,
              name,
              avatar_url,
              theme
            )
          `)
          .eq('user_id', user.id)
          .eq('is_locked', true)
          .is('left_at', null);

        if (pError) throw pError;

        if (participants) {
          const formattedChats: Chat[] = [];

          for (const p of participants) {
            const chatData = p.chats as any;
            if (!chatData) continue;

            const structuredChat: Chat = {
              id: chatData.id,
              type: chatData.type,
              name: chatData.name,
              avatar_url: chatData.avatar_url,
              theme: chatData.theme,
            };

            // If it's a 1-on-1 private DM chat, pull the other user's identity profile details
            let otherUserId: string | undefined;
            if (chatData.type === 'direct') {
              const { data: otherPart } = await supabase
                .from('chat_participants')
                .select('user_id')
                .eq('chat_id', chatData.id)
                .neq('user_id', user.id)
                .maybeSingle();

              if (otherPart?.user_id) {
                otherUserId = otherPart.user_id;
                const { data: profile } = await supabase
                  .from('profiles')
                  .select('display_name, avatar_url')
                  .eq('id', otherPart.user_id)
                  .maybeSingle();

                if (profile) {
                  structuredChat.otherUser = {
                    display_name: profile.display_name,
                    avatar_url: profile.avatar_url,
                  };
                }
              }
            }

            formattedChats.push(structuredChat);

            // Cache the locked conversation locally for the offline fallback
            // above. is_locked keeps it out of ChatList. Merged onto the
            // existing row so the real last-message preview/time/unread
            // survive — this panel doesn't fetch messages itself.
            const existing = await localDB.chats.get(structuredChat.id);
            await localDB.chats.put({
              ...existing,
              id: structuredChat.id,
              type: structuredChat.type,
              name: structuredChat.name || (structuredChat.otherUser?.display_name ?? 'Private Chat'),
              avatar_url: structuredChat.avatar_url || (structuredChat.otherUser?.avatar_url ?? null),
              theme: structuredChat.theme || 'sweet',
              is_locked: true,
              other_user_id: otherUserId,
              other_user_name: structuredChat.otherUser?.display_name,
              other_user_avatar: structuredChat.otherUser?.avatar_url,
            });
          }

          // This panel owns the locked rows in the shared cache (ChatList
          // owns the rest): drop ones the server no longer has as locked —
          // unlocked or left elsewhere. An unlocked one gets re-cached by
          // ChatList's own refresh.
          const freshIds = new Set(formattedChats.map(c => c.id));
          const goneIds = allLocalChats
            .filter(c => c.is_locked && !freshIds.has(c.id))
            .map(c => c.id);
          if (goneIds.length > 0) {
            await localDB.chats.bulkDelete(goneIds);
          }

          if (isLatest()) setLockedChats(formattedChats);
        }
      }
    } catch (err) {
      console.error('Failed to sync or load secure locked vault panel:', err);
      // Without this, a genuine fetch failure with no cache looked
      // identical to "your vault is empty" — actively misleading.
      if (!hadCache) {
        showError("Couldn't load your locked chats. Check your connection.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Background Overlay Backdrop */}
      <div 
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]" 
        onClick={onClose} 
      />

      {/* Sliding Sidebar Body Panel */}
      <div className={`fixed top-0 left-0 bottom-0 z-50 w-full md:max-w-sm h-full flex flex-col shadow-2xl border-r animate-in slide-in-from-left duration-300 ${
        theme === 'sweet' ? 'bg-[#FFF0F5] border-[#FFB6C1]' : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800'
      }`}>
        {/* Header */}
        <div className={`p-4 border-b flex items-center gap-3 ${
          theme === 'sweet' ? 'border-[#FFB6C1]' : 'border-gray-200 dark:border-gray-800'
        }`}>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
            <ArrowLeft className={`w-5 h-5 ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-700 dark:text-gray-300'}`} />
          </button>
          {/* flex-wrap: on narrow phones the badge drops below the long title
              instead of squeezing it. Not mobileOnly: on desktop this panel
              slides in from the left over ChatList, hiding ChatList's badge. */}
          <div className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0">
            <Lock className="w-4 h-4 text-pink-500" />
            <h2 className={`font-bold text-lg ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>
              Locked Conversations
            </h2>
            <OfflineBadge theme={theme} />
          </div>
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : lockedChats.length === 0 ? (
            <div className={`flex flex-col items-center justify-center h-full text-center p-6 ${theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-400'}`}>
              <Lock className="w-12 h-12 mb-2 stroke-[1.5]" />
              <p className="font-medium text-sm">Your vault is empty</p>
              <p className="text-xs max-w-[200px] mt-1">Use the chat options menu to add private threads here.</p>
            </div>
          ) : (
            <div className={`divide-y ${theme === 'sweet' ? 'divide-[#FFD1DC]' : 'divide-gray-100 dark:divide-gray-800'}`}>
              {lockedChats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => setVerifyingChatId(chat.id)}
                  className={`w-full p-4 flex items-center gap-3 text-left transition-colors ${
                    theme === 'sweet' ? 'hover:bg-[#FFC0CB]/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${theme === 'sweet' ? 'bg-[#FFD1DC] text-[#FF1493]' : 'bg-pink-100 dark:bg-pink-900/30 text-pink-600'}`}>
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold text-sm truncate ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>
                      {chat.type === 'direct' ? chat.otherUser?.display_name : chat.name}
                    </p>
                    <p className={`text-xs ${theme === 'sweet' ? 'text-[#8B004B]/70' : 'text-gray-400'}`}>Protected Conversation</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Verification gate — chat only opens after onUnlock fires. The
          grant tells ChatWindow this open was already verified, so it
          doesn't ask a second time. */}
      {verifyingChatId && user && (
        <VaultGate
          theme={theme}
          userId={user.id}
          onUnlock={() => {
            const chatId = verifyingChatId;
            setVerifyingChatId(null);
            grantChatAccess(chatId);
            onSelectChat(chatId);
            onClose();
          }}
          onCancel={() => setVerifyingChatId(null)}
        />
      )}
    </>
  );
}