import { useState, useEffect } from 'react';
import { X, Search, MessageCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { localDB } from '../db';
import { useNotify } from '../contexts/NotificationContext';
import { usePresence } from '../hooks/usePresence';

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
      await localDB.chats.put({
        id: consistentRoomId,
        type: 'direct',
        name: existingChat.name || (targetedFriend ? targetedFriend.display_name : 'Chat'),
        avatar_url: existingChat.avatar_url || targetedFriend?.avatar_url || null,
        theme: existingChat.theme || 'light',
        last_message_content: "No messages yet... 👋",
        last_message_time: new Date().toISOString(),
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
  theme === 'sweet' 
    ? 'bg-[#FFF0F5] border-l border-[#FFB6C1]' 
    : 'bg-white dark:bg-gray-900'
}`}>
        <div className={`p-6 border-b flex items-center justify-between ${theme === 'sweet' ? 'border-[#FFB6C1]' : 'border-gray-200'}`}>
          <h2 className={`text-2xl font-bold ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>Start Chat</h2>
          <button onClick={onClose} className={`p-2 rounded-full transition-colors ${theme === 'sweet' ? 'hover:bg-[#FFB6C1]/40 text-[#8B004B]' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className={`p-4 border-b ${theme === 'sweet' ? 'border-[#FFB6C1]/30' : 'border-gray-200 dark:border-gray-800'}`}>
          <div className="relative">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${theme === 'sweet' ? 'text-[#8B004B]/50' : 'text-gray-400'}`} />
            <input
              type="text"
              placeholder="Search friends..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full pl-10 pr-4 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 transition-colors ${
  theme === 'sweet'
    ? 'bg-white border border-[#FFB6C1] text-[#4B004B] placeholder:text-[#8B004B]/50'
    : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
}`}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-8 h-8 border-3 border-pink-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredFriends.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center px-4">
              <MessageCircle className={`w-16 h-16 mb-3 ${theme === 'sweet' ? 'text-[#FFB6C1]' : 'text-gray-300'}`} />
              <p className={`font-medium ${theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-500'}`}>
                {friends.length === 0 ? 'No friends yet' : 'No matching friends'}
              </p>
            </div>
          ) : (
            filteredFriends.map((friend) => (
              <button
  key={friend.id}
  onClick={() => handleCreateChat(friend.id)}
  className={`w-full p-4 flex items-center gap-3 border-b transition-colors text-left ${
    theme === 'sweet'
      ? 'hover:bg-[#FFB6C1]/20 border-[#FFB6C1]/30'
      : 'hover:bg-gray-50 border-gray-100 dark:border-gray-800'
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
      <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-medium ${
        theme === 'sweet' ? 'bg-[#FF69B4]' : 'bg-gradient-to-br from-pink-400 to-purple-500'
      }`}>
        {friend.display_name[0]}
      </div>
    )}
    {isOnline(friend.id) && (
      <div className={`absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 rounded-full ${
        theme === 'sweet' ? 'border-[#FFF0F5]' : 'border-white'
      }`} />
    )}
  </div>

  <div className="flex-1 min-w-0">
    <h3 className={`font-semibold truncate ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>
      {friend.display_name}
    </h3>
    <p className={`text-sm truncate ${theme === 'sweet' ? 'text-[#8B004B]/60' : 'text-gray-500'}`}>
      @{friend.username}
    </p>
  </div>

  <MessageCircle className={`w-5 h-5 flex-shrink-0 ${theme === 'sweet' ? 'text-[#FF69B4]' : 'text-pink-500'}`} />
</button>
            ))
          )}
        </div>
      </div>
    </>
  );
}