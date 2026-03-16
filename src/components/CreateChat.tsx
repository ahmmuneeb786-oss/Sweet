import { useState, useEffect } from 'react';
import { X, Search, MessageCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

interface CreateChatProps {
  theme: 'light' | 'dark' | 'romantic';
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
      const { data: friends } = await supabase
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

      if (friends) {
        const friendsList = friends
          .map((f: any) => f.profiles)
          .filter(Boolean);
        setFriends(friendsList);
      }
    } catch (error) {
      console.error('Error loading friends:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleStartChat(friendId: string) {
  if (!user) return;

  try {
    const chatId = `chat-${[user.id, friendId].sort().join('-')}`;

    const { data: existingChat } = await supabase
      .from('chats')
      .select('id')
      .eq('id', chatId)
      .maybeSingle();

    if (existingChat) {
      onChatCreated(existingChat.id);
      return;
    }

    const { error: chatError } = await supabase
      .from('chats')
      .insert({
        id: chatId,
        type: 'direct',
        created_by: user.id
      });

    if (chatError) throw chatError;

    await supabase.from('chat_participants').insert([
      { chat_id: chatId, user_id: user.id, role: 'member' },
      { chat_id: chatId, user_id: friendId, role: 'member' }
    ]);

    onChatCreated(chatId);
  } catch (error) {
    console.error('Error creating chat:', error);
  }
}

  const filteredFriends = friends.filter(f =>
    f.display_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className={`fixed right-0 top-0 h-full w-96 shadow-2xl z-50 flex flex-col transition-colors duration-300 ${
  theme === 'romantic' 
    ? 'bg-[#FFF0F5] border-l border-[#FFB6C1]' 
    : 'bg-white dark:bg-gray-900'
}`}>
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h2 className={`text-2xl font-bold ${theme === 'romantic' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>Start Chat</h2>
          <button onClick={onClose} className={`p-2 rounded-full transition-colors ${theme === 'romantic' ? 'hover:bg-[#FFB6C1]/40 text-[#8B004B]' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className={`p-4 border-b ${theme === 'romantic' ? 'border-[#FFB6C1]/30' : 'border-gray-200 dark:border-gray-800'}`}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search friends..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full pl-10 pr-4 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 transition-colors ${
  theme === 'romantic'
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
              <MessageCircle className="w-16 h-16 text-gray-300 mb-3" />
              <p className="text-gray-500 font-medium">
                {friends.length === 0 ? 'No friends yet' : 'No matching friends'}
              </p>
            </div>
          ) : (
            filteredFriends.map((friend) => (
              <button
  key={friend.id}
  onClick={() => handleStartChat(friend.id)}
  className={`w-full p-4 flex items-center gap-3 border-b transition-colors text-left ${
    theme === 'romantic'
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
        theme === 'romantic' ? 'bg-[#FF69B4]' : 'bg-gradient-to-br from-pink-400 to-purple-500'
      }`}>
        {friend.display_name[0]}
      </div>
    )}
    {friend.is_online && (
      <div className={`absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 rounded-full ${
        theme === 'romantic' ? 'border-[#FFF0F5]' : 'border-white'
      }`} />
    )}
  </div>

  <div className="flex-1 min-w-0">
    <h3 className={`font-semibold truncate ${theme === 'romantic' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>
      {friend.display_name}
    </h3>
    <p className={`text-sm truncate ${theme === 'romantic' ? 'text-[#8B004B]/60' : 'text-gray-500'}`}>
      @{friend.username}
    </p>
  </div>

  <MessageCircle className={`w-5 h-5 flex-shrink-0 ${theme === 'romantic' ? 'text-[#FF69B4]' : 'text-pink-500'}`} />
</button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
