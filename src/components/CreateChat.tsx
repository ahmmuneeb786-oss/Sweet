import { useState, useEffect } from 'react';
import { X, Search, MessageCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { localDB } from '../db';
import { useNotify } from '../contexts/NotificationContext';
import { usePresence } from '../hooks/usePresence';
import { OfflineBadge } from './OfflineBadge';

interface CreateChatProps {
  theme: 'light' | 'dark' | 'sweet';
  onClose: () => void;
  onChatCreated: (chatId: string) => void;
}

interface Friend {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_online: boolean;
}

export function CreateChat({ theme, onClose, onChatCreated }: CreateChatProps) {
  const { user } = useAuth();
  const { showError } = useNotify();
  const { isOnline } = usePresence(user?.id);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      loadFriends();
    }
  }, [user]);

  async function loadFriends() {
    if (!user) return;

    try {
      setLoading(true);

      // 1. If we are offline, load instantly from your local Dexie database!
      if (!navigator.onLine) {
        const localProfiles = await localDB.profiles.toArray();
        const fallbackList = localProfiles.map(p => ({
          id: p.id,
          username: p.username,
          display_name: p.display_name,
          avatar_url: p.avatar_url,
          is_online: false // Default to offline status when device is offline
        }));
        setFriends(fallbackList);
        return;
      }

      // 2. If online, fetch fresh data from Supabase
      const { data: friendsData } = await supabase
        .from('friends')
        .select(`
          friend_id,
          profiles!friends_friend_id_fkey (
            id,
            username,
            display_name,
            avatar_url,
            is_online
          )
        `)
        .eq('user_id', user.id);

      if (friendsData) {
        const friendsList = friendsData
          .map((f: any) => f.profiles)
          .filter(Boolean)
          .map((p: any) => ({
            id: p.id,
            username: p.username,
            display_name: p.display_name,
            avatar_url: p.avatar_url,
            is_online: p.is_online
          }));

        setFriends(friendsList);

        // 3. Cache them into local storage so they are ready next time you go offline!
        for (const friend of friendsList) {
          await localDB.saveUserProfile(friend.id, {
            username: friend.username,
            display_name: friend.display_name,
            avatar_url: friend.avatar_url,
            bio: ''
          });
        }
      }
    } catch (error) {
      console.error('Error loading friends:', error);
      // Extra fallback protection if the network throws an unexpected error midway
      const localProfiles = await localDB.profiles.toArray();
      setFriends(localProfiles.map(p => ({
        id: p.id,
        username: p.username,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
        is_online: false
      })));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateChat(friendId: string) {
    if (!user) return;

    try {
      const sortedIds = [user.id, friendId].sort();
      const consistentRoomId = `${sortedIds[0]}_${sortedIds[1]}`;

      // 🛑 STEP A: ADD THIS NEW LINE TO CAPTURE FRIEND INFORMATION FROM LIVE STATE
      const targetedFriend = friends.find(f => f.id === friendId);

      let { data: existingChat } = await supabase
        .from('chats')
        .select('*')
        .eq('id', consistentRoomId)
        .maybeSingle();

      if (!existingChat) {
        const { data: newChat, error: chatError } = await supabase
          .from('chats')
          .insert({
            id: consistentRoomId,
            type: 'direct',
            updated_at: new Date().toISOString()
          })
          .select()
          .single();

        if (chatError) throw chatError;

        await supabase.from('chat_participants').insert([
          { chat_id: consistentRoomId, user_id: sortedIds[0] },
          { chat_id: consistentRoomId, user_id: sortedIds[1] }
        ]);

        existingChat = newChat;
      }

      // This tells your phone's memory to cache the conversation layout row.
      // Flattened to match LocalChat — a nested `otherUser` object here
      // silently corrupts this exact cache, same bug pattern found and
      // fixed in ChatWindow/ChatList/LockedChatsPanel earlier.
      // Carry over an existing chat's real last message, type and unread
      // count — the placeholder preview is only for a brand-new chat.
      const existingRow = await localDB.chats.get(consistentRoomId);
      await localDB.upsertChat({
        ...existingRow,
        id: consistentRoomId,
        type: 'direct',
        name: existingChat.name || (targetedFriend ? targetedFriend.display_name : 'Chat'),
        avatar_url: existingChat.avatar_url || targetedFriend?.avatar_url || null,
        theme: existingChat.theme || 'light',
        ...(existingRow?.last_message_time
          ? {}
          : { last_message_content: "No messages yet... 👋", last_message_time: new Date().toISOString() }),
        other_user_id: targetedFriend?.id,
        other_user_name: targetedFriend?.display_name,
        other_user_avatar: targetedFriend?.avatar_url,
        other_user_last_seen: new Date().toISOString(),
      });

      // This is your original code that follows right after:
      onChatCreated(consistentRoomId);
      onClose();
    } catch (error) {
      console.error('Error creating chat:', error);
      showError("Couldn't start this chat. Please try again.");
    }
  }

  const filteredFriends = friends.filter(f =>
    f.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className={`fixed right-0 top-0 h-full w-full md:w-96 shadow-2xl z-50 flex flex-col transition-colors duration-300 ${
  'bg-th-panel text-th-ink border-l border-th-border'
}`}>
        <div className="p-6 border-b flex items-center justify-between border-th-border">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-th-ink">Start Chat</h2>
            <OfflineBadge theme={theme} mobileOnly />
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-full transition-colors hover:bg-th-card-hover text-th-ink-soft">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 border-b border-th-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-th-ink-faint" />
            <input
              type="text"
              placeholder="Search friends..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full pl-10 pr-4 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-th-primary/50 transition-colors bg-th-input border border-th-border text-th-ink placeholder:text-th-ink-faint`}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-8 h-8 border-3 border-th-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredFriends.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center px-4">
              <MessageCircle className="w-16 h-16 mb-3 text-th-border" />
              <p className="font-medium text-th-ink-soft">
                {friends.length === 0 ? 'No friends yet' : 'No matching friends'}
              </p>
            </div>
          ) : (
            filteredFriends.map((friend) => (
              <button
  key={friend.id}
  onClick={() => handleCreateChat(friend.id)}
  className={`w-full p-4 flex items-center gap-3 border-b transition-colors text-left ${
    'hover:bg-th-card-hover border-th-border/60'
  }`}
>
                <div className="relative">
    {friend.avatar_url ? (
      <img
        src={friend.avatar_url}
        alt={friend.display_name}
        className="w-12 h-12 rounded-full object-cover border-2 border-transparent"
      />
    ) : (
      <div className="w-12 h-12 rounded-full flex items-center justify-center font-medium bg-gradient-to-br from-th-bubble-mine to-th-bubble-mine-to text-th-on-bubble-mine">
        {friend.display_name[0]}
      </div>
    )}
    {isOnline(friend.id) && (
      <div className="absolute bottom-0 right-0 w-3 h-3 bg-th-online border-2 rounded-full border-th-panel" />
    )}
  </div>

  <div className="flex-1 min-w-0">
    <h3 className="font-semibold truncate text-th-ink">
      {friend.display_name}
    </h3>
    <p className="text-sm truncate text-th-ink-soft">
      @{friend.username}
    </p>
  </div>

  <MessageCircle className="w-5 h-5 flex-shrink-0 text-th-link" />
</button>
            ))
          )}
        </div>
      </div>
    </>
  );
}