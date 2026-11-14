import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, MoreVertical, MessageSquarePlus, Users, User as UserIcon, Settings, Lock, LogOut, Heart, Bookmark } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { localDB } from '../db';
import { usePresence } from '../hooks/usePresence';
import { markChatsReady } from '../hooks/useChatsReady';
import { useNotify } from '../contexts/NotificationContext';
import { usePerformance } from '../contexts/PerformanceContext';
import { formatMessagePreview } from '../lib/messagePreview';
import { loadHiddenMessageIds } from '../lib/hiddenMessages';
import { onChatListRefresh } from '../hooks/chatListRefresh';
import { OfflineBadge } from './OfflineBadge';
import { useTheme } from '../theme/ThemeProvider';
import { chatAccentFor } from '../theme/useChatTheme';
import { prefetchSharedThemes, useSharedThemesVersion } from '../theme/sharedChatTheme';
import { ensureSelfChat, isSelfChatId, SELF_CHAT_NAME } from '../lib/selfChat';
import { FloatingHearts } from './FloatingHearts';
import { useAppIsSweet } from '../theme/sweetHearts';

// Account id whose Saved Messages chat was already ensured this session.
let selfChatEnsuredFor: string | null = null;

interface Chat {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  avatar_url: string | null;
  theme: string;
  lastMessage?: {
    id?: string;
    content: string | null;
    created_at: string;
    type?: string | null;
    is_deleted?: boolean;
  };
  unreadCount?: number;
  otherUser?: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    last_seen: string | null;
  };
}

interface ChatListProps {
  selectedChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onShowProfile: () => void;
  onShowFriends: () => void;
  onShowSettings: () => void;
  onShowCreateChat: () => void;
  theme: 'light' | 'dark' | 'sweet';
  onShowLockedChats: () => void;
}

export function ChatList({ selectedChatId, onSelectChat, onShowProfile, onShowFriends, onShowSettings, onShowCreateChat, theme, onShowLockedChats }: ChatListProps) {
  const { user, profile, signOut } = useAuth();
  const { isOnline: isUserOnline } = usePresence(user?.id);
  const { isLowPerfMode } = usePerformance();
  const appIsSweet = useAppIsSweet();
  const { showError } = useNotify();
  const { library: themeLibrary } = useTheme();
  const [chats, setChats] = useState<Chat[]>([]);
  const sharedThemesVersion = useSharedThemesVersion();
  const [searchQuery, setSearchQuery] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  // The realtime subscription is created once; this ref lets its INSERT handler
  // read the CURRENTLY open chat (so a message for the open chat isn't counted
  // as unread).
  const selectedChatIdRef = useRef(selectedChatId);
  selectedChatIdRef.current = selectedChatId;

  // Own profile (avatar + username shown top-left) — cached so it doesn't
  // flash blank on reload while AuthContext is still fetching it.
  const [myProfile, setMyProfile] = useState<{ display_name: string; username: string; avatar_url: string | null } | null>(null);

  useEffect(() => {
    async function hydrateMyProfile() {
      if (!user?.id) return;

      if (navigator.onLine && profile) {
        const fresh = {
          display_name: profile.display_name || '',
          username: profile.username || '',
          avatar_url: profile.avatar_url || null,
        };
        setMyProfile(fresh);
        await localDB.saveUserProfile(user.id, {
          ...fresh,
          bio: profile.bio,
          created_at: user.created_at,
        });
      } else {
        const cached = await localDB.getUserProfile(user.id);
        if (cached) {
          setMyProfile({
            display_name: cached.display_name,
            username: cached.username,
            avatar_url: cached.avatar_url,
          });
        }
      }
    }
    hydrateMyProfile();
  }, [user?.id, profile]);

  const isSelfChat = (chat: Chat) => isSelfChatId(chat.id);
  const getTitle = (chat: Chat) =>
    isSelfChat(chat) ? SELF_CHAT_NAME
    : chat.type === 'direct' ? chat.otherUser?.display_name || ''
    : chat.name || '';

  // Refresh the list the moment the connection returns. (The "Offline Mode"
  // badge tracks the network state itself — see OfflineBadge.)
  useEffect(() => {
    const handleOnline = () => {
      loadChats(); // 🔄 Quietly refresh and upgrade metadata the second connection returns
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [user]);

  useEffect(() => {
    if (user) {
      // 1. Initial load from internal cache or active link
      loadChats();

      // 2. Flicker-free real-time sync channel
      const channel = supabase
        .channel('sidebar-live-sync')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          (payload) => {
            const newMessage = payload.new;
            // A message the user "deleted for me" shouldn't resurface as the
            // preview (can happen if it arrives while hidden) — skip it.
            if (loadHiddenMessageIds().has(newMessage.id)) return;

            // Count it as unread if it's from the other person AND this chat
            // isn't the one currently open.
            const countsAsUnread =
              newMessage.sender_id !== user.id && newMessage.chat_id !== selectedChatIdRef.current;

            setChats((currentChats) => {
              const idx = currentChats.findIndex((chat) => chat.id === newMessage.chat_id);
              if (idx === -1) return currentChats;

              const updatedChat = {
                ...currentChats[idx],
                lastMessage: {
                  id: newMessage.id,
                  content: newMessage.content,
                  created_at: newMessage.created_at,
                  type: newMessage.type,
                  is_deleted: newMessage.is_deleted
                },
                unreadCount: (currentChats[idx].unreadCount ?? 0) + (countsAsUnread ? 1 : 0)
              };

              // Move the chat with the new message to the top, like a real chat list.
              const next = [...currentChats];
              next.splice(idx, 1);
              next.unshift(updatedChat);
              return next;
            });

            // Persist so the next app open shows this message from cache instantly,
            // instead of only reflecting whatever the last full loadChats() saw.
            localDB.chats.get(newMessage.chat_id).then((c) => {
              localDB.chats.update(newMessage.chat_id, {
                last_message_content: newMessage.content,
                last_message_time: newMessage.created_at,
                last_message_type: newMessage.type,
                last_message_is_deleted: newMessage.is_deleted,
                last_message_id: newMessage.id,
                unread_count: (c?.unread_count ?? 0) + (countsAsUnread ? 1 : 0)
              }).catch(() => {});
            }).catch(() => {});
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'messages' },
          (payload) => {
            const updated = payload.new;
            // Reflect edits and "delete for everyone" (is_deleted flips) on the
            // preview live — but only when the changed row IS the chat's current
            // last message. Bail early (same array reference, no re-render) for
            // the common case of updates to non-last messages, e.g. the flood
            // of delivery_status='read' updates.
            setChats((currentChats) => {
              if (!currentChats.some((c) => c.lastMessage?.id === updated.id)) return currentChats;
              return currentChats.map((chat) => {
                const last = chat.lastMessage;
                if (!last || last.id !== updated.id) return chat;
                return {
                  ...chat,
                  lastMessage: {
                    ...last,
                    content: updated.content,
                    type: updated.type,
                    is_deleted: updated.is_deleted
                  }
                };
              });
            });
            // Cache write keyed by chat_id (the indexed primary key), guarded
            // so we only touch the row when this really is its last message.
            localDB.chats.get(updated.chat_id).then((c) => {
              if (c && c.last_message_id === updated.id) {
                localDB.chats.update(updated.chat_id, {
                  last_message_content: updated.content,
                  last_message_is_deleted: updated.is_deleted,
                  last_message_type: updated.type
                }).catch(() => {});
              }
            }).catch(() => {});
          }
        )
        .subscribe();

      // "Delete for me" in an open chat can't reach us through Supabase (it
      // never touches the server), so ChatWindow pings this bus to have us
      // recompute previews — falling back to the previous visible message.
      const unsubscribeRefresh = onChatListRefresh(() => loadChats());

      return () => {
        supabase.removeChannel(channel);
        unsubscribeRefresh();
      };
    }
  }, [user]);

  // Keep chat partners' cached last_seen fresh. Online/offline itself comes
  // from usePresence — this only stops the "last seen" value going stale.
  // Subscribed to OUR partners only: an unfiltered profiles subscription
  // delivered every visible user's 60s heartbeat to every client.
  // Sorted + joined so re-sorting the list on a new message doesn't resubscribe.
  const partnerIdsKey = Array.from(
    new Set(chats.filter((c) => c.type === 'direct' && c.otherUser).map((c) => c.otherUser!.id))
  ).sort().join(',');

  useEffect(() => {
    if (!user || !partnerIdsKey) return;
    const partnerIds = partnerIdsKey.split(',');

    // Realtime's `in` filter accepts at most 100 values; past that, fall back
    // to the unfiltered stream and ignore non-partners in the handler.
    const filter = partnerIds.length <= 100 ? `id=in.(${partnerIdsKey})` : undefined;
    const partnerSet = new Set(partnerIds);

    const channel = supabase
      .channel('chat-list-partner-profiles')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', ...(filter ? { filter } : {}) },
        (payload) => {
          const updatedProfile = payload.new;
          if (!partnerSet.has(updatedProfile.id)) return;

          setChats((currentChats) =>
            currentChats.map((chat) =>
              chat.type === 'direct' && chat.otherUser && chat.otherUser.id === updatedProfile.id
                ? { ...chat, otherUser: { ...chat.otherUser, last_seen: updatedProfile.last_seen } }
                : chat
            )
          );

          localDB.chats
            .where('other_user_id')
            .equals(updatedProfile.id)
            .modify({ other_user_last_seen: updatedProfile.last_seen })
            .catch(() => {});
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, partnerIdsKey]);

  // Opening a chat clears its unread badge (the messages get marked read in
  // ChatWindow). Reflect that in the list + cache immediately.
  useEffect(() => {
    if (!selectedChatId) return;
    setChats((current) =>
      current.some((c) => c.id === selectedChatId && (c.unreadCount ?? 0) > 0)
        ? current.map((c) => (c.id === selectedChatId ? { ...c, unreadCount: 0 } : c))
        : current
    );
    localDB.chats.update(selectedChatId, { unread_count: 0 }).catch(() => {});
  }, [selectedChatId]);

  // Shared shape conversion: LocalChat (cache row) -> Chat (what the UI renders)
  function toChat(c: any): Chat {
    return {
      id: c.id,
      type: c.type,
      name: c.name,
      avatar_url: c.avatar_url,
      theme: c.theme,
      // Gate on the timestamp, not the content — a photo/gif/voice message has
      // no text content but is still a real "last message" worth previewing.
      lastMessage: c.last_message_time ? {
        id: c.last_message_id,
        content: c.last_message_content ?? null,
        created_at: c.last_message_time,
        type: c.last_message_type ?? 'text',
        is_deleted: c.last_message_is_deleted ?? false
      } : undefined,
      unreadCount: c.unread_count ?? 0,
      otherUser: c.other_user_id ? {
        id: c.other_user_id,
        display_name: c.other_user_name || '',
        avatar_url: c.other_user_avatar || null,
        last_seen: c.other_user_last_seen || null
      } : undefined
    };
  }

  // Most recently active conversation first — a chat list should always feel
  // "sorted by what just happened", not by whatever order the DB returned.
  function byRecency(a: Chat, b: Chat) {
    const aTime = a.lastMessage?.created_at ? new Date(a.lastMessage.created_at).getTime() : 0;
    const bTime = b.lastMessage?.created_at ? new Date(b.lastMessage.created_at).getTime() : 0;
    return bTime - aTime;
  }

  async function loadChats() {
    if (!user) return;

    let hadCache = false;

    try {
      // PHASE 1: Read internal phone storage instantly — this is what makes
      // the list show up immediately on open instead of a blank/loading screen.
      const cachedChats = await localDB.chats.toArray();
      // Locked chats share this cache with the vault — never show them here.
      const visibleCachedChats = cachedChats.filter(c => !c.is_locked);
      // Keyed on the whole cache, not just the visible part: if everything
      // cached is locked, the list must still update (to empty) offline.
      if (cachedChats.length > 0) {
        hadCache = true;
        setChats(visibleCachedChats.map(toChat).sort(byRecency));
        setLoading(false);
        markChatsReady();
      } else {
        setLoading(true);
      }

      // PHASE 2: Quietly ask Supabase if there are new changes over the network
      if (!navigator.onLine) return;

      // Make sure Saved Messages exists (and is visible via its participant
      // row) before fetching — otherwise a missing row means it never shows
      // here, and the prune below would delete its local copy. Once per
      // session per account; failures just retry on the next load.
      if (selfChatEnsuredFor !== user.id) {
        try {
          await ensureSelfChat(user.id);
          selfChatEnsuredFor = user.id;
        } catch (e) {
          console.warn('Saved Messages sync failed:', e);
        }
      }

      const { data: participants, error: pError } = await supabase
        .from('chat_participants')
        .select(`
          chat_id,
          chats:chat_id ( id, type, name, avatar_url, theme, created_at )
        `)
        .eq('user_id', user.id)
        .eq('is_locked', false)
        .is('left_at', null);

      if (pError) {
        console.error('Supabase Error:', pError.message);
        if (!hadCache) {
          showError("Couldn't load your chats. Check your connection.");
        }
        return;
      }

      if (!participants || participants.length === 0) {
        setChats([]);
        // Not clear(): locked rows belong to the vault and must survive for
        // offline use — this query never returns them.
        await localDB.chats.filter(c => !c.is_locked).delete();
        return;
      }

      const chatIds = participants.map(p => p.chat_id);
      const directChatIds = participants
        .filter(p => {
          const c = Array.isArray(p.chats) ? p.chats[0] : p.chats;
          return c?.type === 'direct';
        })
        .map(p => p.chat_id);

      const hidden = loadHiddenMessageIds();

      // Batched instead of one query per chat — this was the N+1 query problem.
      const [{ data: messages }, { data: otherParticipants }] = await Promise.all([
        supabase
          .from('messages')
          .select('id, chat_id, content, created_at, type, is_deleted, sender_id, delivery_status')
          .in('chat_id', chatIds)
          .order('created_at', { ascending: false }),
        directChatIds.length > 0
          ? supabase
              .from('chat_participants')
              .select('chat_id, profiles:user_id ( id, display_name, avatar_url, last_seen )')
              .in('chat_id', directChatIds)
              .neq('user_id', user.id)
          : Promise.resolve({ data: [] as any[] })
      ]);

      const otherUserByChat = new Map<string, any>();
      otherParticipants?.forEach((row: any) => {
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        if (profile) otherUserByChat.set(row.chat_id, profile);
      });

      const freshLocalChats = participants
        .map(p => {
          const chatData = Array.isArray(p.chats) ? p.chats[0] : p.chats;
          if (!chatData) return null;

          // Latest message that ISN'T hidden via "delete for me" — so a
          // locally-hidden last message falls back to the previous one.
          const lastMsg = messages?.find(m => m.chat_id === p.chat_id && !hidden.has(m.id));
          const otherUserObj = otherUserByChat.get(p.chat_id);
          // Unread = received messages in this chat not yet marked read.
          const unreadCount = messages
            ? messages.filter(m => m.chat_id === p.chat_id && m.sender_id !== user.id && m.delivery_status !== 'read' && !hidden.has(m.id)).length
            : 0;

          return {
            id: chatData.id,
            type: chatData.type,
            name: chatData.name,
            avatar_url: chatData.avatar_url,
            theme: chatData.theme,
            last_message_content: lastMsg?.content,
            last_message_time: lastMsg?.created_at,
            last_message_type: lastMsg?.type,
            last_message_is_deleted: lastMsg?.is_deleted,
            last_message_id: lastMsg?.id,
            unread_count: unreadCount,
            other_user_id: otherUserObj?.id,
            other_user_name: otherUserObj?.display_name,
            other_user_avatar: otherUserObj?.avatar_url,
            other_user_last_seen: otherUserObj?.last_seen,
            // Fetched with is_locked = false, so this also clears a stale
            // locked flag on a chat that was unlocked from another device.
            is_locked: false
          };
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);

      // PHASE 3: Write fresh data back to local storage, AND prune anything
      // that's now gone (left/deleted chats) instead of leaving it cached forever.
      const freshIds = new Set(freshLocalChats.map(c => c.id));
      // Locked rows are skipped: this query excludes them on purpose, so
      // "missing" here doesn't mean gone — the vault prunes its own rows.
      const staleIds = cachedChats
        .filter(c => !c.is_locked && !freshIds.has(c.id))
        .map(c => c.id);
      if (staleIds.length > 0) {
        await localDB.chats.bulkDelete(staleIds);
      }
      await localDB.chats.bulkPut(freshLocalChats);

      setChats(freshLocalChats.map(toChat).sort(byRecency));
    } catch (error) {
      console.error('Logic Error loading chats:', error);
      if (!hadCache) {
        showError("Couldn't load your chats. Check your connection.");
      }
    } finally {
      setLoading(false);
      markChatsReady();
    }
  }

  // Shared ("Both of us") themes for every listed chat, in one request, so a
  // chat the other person themed shows its stripe before it's opened here.
  // Sorted: the list reorders on every new message, but only a change in
  // WHICH chats are listed should refetch or recompute.
  const chatIdsKey = chats.map((c) => c.id).sort().join(',');
  useEffect(() => {
    if (chatIdsKey) void prefetchSharedThemes(chatIdsKey.split(','));
  }, [chatIdsKey]);

  // Stripe colour per chat, worked out once per change, not per row per render
  // (presence updates re-render this list often).
  const stripeAccents = useMemo(() => {
    const map = new Map<string, string>();
    for (const id of chatIdsKey ? chatIdsKey.split(',') : []) {
      const accent = chatAccentFor(id, themeLibrary.overrides, themeLibrary.themes);
      if (accent) map.set(id, accent);
    }
    return map;
    // sharedThemesVersion: recompute when a cached shared theme changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatIdsKey, themeLibrary.overrides, themeLibrary.themes, sharedThemesVersion]);

  const filteredChats = chats.filter(chat => {
    const chatName = getTitle(chat);
    return chatName.toLowerCase().includes(searchQuery.toLowerCase());
  });

  function formatTime(timestamp: string) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));

    if (hours < 1) {
      const minutes = Math.floor(diff / (1000 * 60));
      return `${minutes}m ago`;
    } else if (hours < 24) {
      return `${hours}h ago`;
    } else {
      const days = Math.floor(hours / 24);
      return `${days}d ago`;
    }
  }

  // A coloured stripe on chats that have their own theme (mine or the shared
  // one), in that theme's colour. Chats on the app theme get none.
  // Drawn as an inner shadow, not a thicker left border, so themed rows keep
  // exactly the same size and padding as the rest (no 3px content shift).
  function themeStripe(chatId: string, selected: boolean): React.CSSProperties | undefined {
    const accent = stripeAccents.get(chatId);
    if (!accent) return undefined;
    // Inline box-shadow replaces Tailwind's, so keep the selected row's shadow-sm.
    const stripe = `inset 4px 0 0 ${accent}`;
    return { boxShadow: selected ? `${stripe}, 0 1px 2px 0 rgb(0 0 0 / 0.05)` : stripe };
  }

  return (
    <div className={`w-full md:w-96 h-full p-4 border-b sticky top-0 z-10 flex flex-col ${isLowPerfMode ? '' : 'backdrop-blur-md'} flex-shrink-0 bg-th-panel border-th-border text-th-ink`}>
      {/* Mobile only: hearts behind the list. -z-10 inside this root (a
          stacking context: sticky + z-10) paints them above the root's own
          background but under every row and the header. */}
      {appIsSweet && (
        <div className="md:hidden absolute inset-0 overflow-hidden pointer-events-none -z-10">
          <FloatingHearts />
        </div>
      )}
      <div className="p-4 border-b border-th-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              {(profile?.avatar_url || myProfile?.avatar_url) ? (
                <img
                  src={profile?.avatar_url || myProfile?.avatar_url || ''}
                  alt={profile?.display_name || myProfile?.display_name}
                  className="w-12 h-12 rounded-full object-cover"
                />
              ) : (
                <div className={`w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center font-medium text-lg uppercase from-th-bubble-mine to-th-bubble-mine-to text-th-on-bubble-mine`}>
                  {profile?.display_name?.[0] || myProfile?.display_name?.[0] || profile?.username?.[0] || myProfile?.username?.[0] || 'U'}
                </div>
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h1 className={`text-xl font-bold flex items-center gap-2 whitespace-nowrap text-th-ink`}>
                  <Heart className="w-5 h-5 text-th-primary fill-th-primary shrink-0" />
                  Sweet
                </h1>
                <OfflineBadge theme={theme} />
              </div>
              <p className="text-xs text-th-ink-soft">@{profile?.username || myProfile?.username}</p>
            </div>
          </div>

          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              aria-label="Menu"
              className="p-2 rounded-full transition-colors outline-none hover:bg-th-card-hover text-th-ink"
            >
              <MoreVertical className="w-5 h-5" />
            </button>

            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMenu(false)}
                />
                <div className={`absolute right-0 top-full mt-2 w-64 rounded-xl shadow-lg py-2 z-20 border ${
                  'bg-th-card border-th-border'
                }`}>
                  <button
                    onClick={() => {
                      onShowProfile();
                      setShowMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left flex items-center gap-3 transition-colors text-th-ink hover:bg-th-card-hover"
                  >
                    <UserIcon className="w-5 h-5" />
                    <span>Profile</span>
                  </button>
                  <button
                    onClick={() => {
                      onShowSettings();
                      setShowMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left flex items-center gap-3 transition-colors text-th-ink hover:bg-th-card-hover"
                  >
                    <Settings className="w-5 h-5" />
                    <span>Settings</span>
                  </button>
                  <button
                    onClick={() => {
                      onShowLockedChats();
                      setShowMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left flex items-center gap-3 transition-colors text-th-ink hover:bg-th-card-hover"
                  >
                    <Lock className="w-5 h-5" />
                    <span>Locked Chats</span>
                  </button>
                  <div className="border-t my-2 border-th-border" />
                  <button
                    onClick={() => {
                      signOut();
                      setShowMenu(false);
                    }}
                    className={`w-full px-4 py-2 text-left flex items-center gap-3 transition-colors ${
                      'text-th-danger hover:bg-th-danger/10'
                    }`}
                  >
                    <LogOut className="w-5 h-5" />
                    <span>Logout</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-th-ink-faint" />
          <input
            type="text"
            placeholder="Search chats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full pl-10 pr-4 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-th-primary/50 transition-colors border bg-th-input border-th-border text-th-ink placeholder:text-th-ink-faint`}
          />
        </div>

        <div className="flex gap-2 mt-3">
          <button
            onClick={onShowFriends}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-r from-th-bubble-mine to-th-bubble-mine-to text-th-on-bubble-mine rounded-xl hover:opacity-90 transition-all"
          >
            <Users className="w-4 h-4" />
            <span className="text-sm font-medium">Find Friends</span>
          </button>
          <button
            onClick={onShowCreateChat}
            aria-label="New chat"
            className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl transition-all border bg-th-secondary border-th-border text-th-on-secondary hover:bg-th-card-hover"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-8 h-8 border-3 border-th-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredChats.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <MessageSquarePlus className="w-16 h-16 mb-3 text-th-border" />
            <p className="font-medium text-th-ink-soft">No chats yet</p>
            <p className="text-sm mt-1 text-th-ink-faint">
              Start a conversation with your friends
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-1.5">
            {filteredChats.map((chat) => {
              const unread = chat.unreadCount ?? 0;
              return (
                <button
                  key={chat.id}
                  onClick={() => onSelectChat(chat.id)}
                  className={`w-full p-3 rounded-3xl border flex items-start gap-3 transition-all active:scale-[0.98] ${
                    selectedChatId === chat.id
                      ? 'bg-th-primary/15 border-th-primary shadow-sm'
                      : 'bg-th-card/70 border-th-border hover:bg-th-card-hover'
                  }`}
                  style={themeStripe(chat.id, selectedChatId === chat.id)}
                >
                  <div className="relative flex-shrink-0">
                    {isSelfChat(chat) ? (
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center from-th-bubble-mine to-th-bubble-mine-to text-th-on-bubble-mine">
                        <Bookmark className="w-6 h-6" />
                      </div>
                    ) : chat.type === 'direct' && chat.otherUser ? (
                      <>
                        {chat.otherUser.avatar_url ? (
                          <img
                            src={chat.otherUser.avatar_url}
                            alt={chat.otherUser.display_name}
                            className="w-12 h-12 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center font-medium from-th-bubble-mine to-th-bubble-mine-to text-th-on-bubble-mine">
                            {chat.otherUser.display_name[0] || 'U'}
                          </div>
                        )}
                        <span
                          className={`absolute bottom-0 right-0 block h-3.5 w-3.5 rounded-full border-2 ${
                            'border-th-panel'
                          } ${
                            isUserOnline(chat.otherUser.id) ? 'bg-th-online' : 'bg-th-toggle-off'
                          }`}
                        />
                      </>
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center from-th-bubble-mine to-th-bubble-mine-to text-th-on-bubble-mine">
                        <Users className="w-6 h-6" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className={`truncate ${
                        unread > 0 ? 'font-extrabold text-th-ink' : 'font-semibold text-th-ink'
                      }`}>
                        {getTitle(chat)}
                      </h3>
                      {chat.lastMessage?.created_at && (
                        <span className={`text-xs shrink-0 ${unread > 0 ? 'text-th-link font-bold' : 'text-th-ink-soft'}`}>
                          {formatTime(chat.lastMessage.created_at)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-sm truncate flex-1 ${
                        unread > 0 ? 'text-th-ink font-medium' : 'text-th-ink-soft'
                      }`}>
                        {formatMessagePreview(chat.lastMessage)}
                      </p>
                      {unread > 0 && (
                        <span className="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-th-badge text-th-on-primary text-[11px] font-black flex items-center justify-center shadow-sm">
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}