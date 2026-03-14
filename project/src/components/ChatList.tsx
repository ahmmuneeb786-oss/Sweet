import { useState, useEffect } from 'react';
import { Search, MoreVertical, MessageSquarePlus, Users, User as UserIcon, Settings, Lock, LogOut, Heart } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

interface Chat {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  avatar_url: string | null;
  theme: string;
  lastMessage?: {
    content: string;
    created_at: string;
  };
  otherUser?: {
    display_name: string;
    avatar_url: string | null;
    is_online: boolean;
  };
}

interface ChatListProps {
  selectedChatId: string | null;
  onSelectChat: (chatId: string) => void;
  onShowProfile: () => void;
  onShowFriends: () => void;
  onShowSettings: () => void;
  onShowCreateChat: () => void;
  theme: 'light' | 'dark' | 'romantic';
}

export function ChatList({ selectedChatId, onSelectChat, onShowProfile, onShowFriends, onShowSettings, onShowCreateChat, theme }: ChatListProps) {
  const { user, profile, signOut } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadChats();
      subscribeToChats();
    }
  }, [user]);

  async function loadChats() {
    if (!user) return;

    try {
      const { data: participants } = await supabase
        .from('chat_participants')
        .select(`
          chat_id,
          chats (
            id,
            type,
            name,
            avatar_url,
            theme,
            created_at
          )
        `)
        .eq('user_id', user.id)
        .is('left_at', null);

      if (!participants) return;

      const chatIds = participants.map(p => p.chat_id);

      const { data: messages } = await supabase
        .from('messages')
        .select('chat_id, content, created_at')
        .in('chat_id', chatIds)
        .order('created_at', { ascending: false });

      const chatMap = new Map();
      participants.forEach(p => {
        const chat = (p as any).chats;
        if (chat) {
          chatMap.set(chat.id, {
            ...chat,
            lastMessage: messages?.find(m => m.chat_id === chat.id)
          });
        }
      });

      for (const [chatId, chat] of chatMap.entries()) {
        if (chat.type === 'direct') {
          const { data: otherParticipant } = await supabase
            .from('chat_participants')
            .select(`
              user_id,
              profiles (
                display_name,
                avatar_url,
                is_online
              )
            `)
            .eq('chat_id', chatId)
            .neq('user_id', user.id)
            .maybeSingle();

          if (otherParticipant) {
            chat.otherUser = (otherParticipant as any).profiles;
          }
        }
      }

      setChats(Array.from(chatMap.values()));
    } catch (error) {
      console.error('Error loading chats:', error);
    } finally {
      setLoading(false);
    }
  }

  function subscribeToChats() {
    const channel = supabase
      .channel('chats-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages'
        },
        () => {
          loadChats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  const filteredChats = chats.filter(chat => {
    const chatName = chat.type === 'direct'
      ? chat.otherUser?.display_name || ''
      : chat.name || '';
    return chatName.toLowerCase().includes(searchQuery.toLowerCase());
  });

  function formatTime(timestamp: string) {
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

  function getThemeColor(theme: string) {
    switch (theme) {
      case 'love': return 'border-l-4 border-pink-500';
      case 'best_friend': return 'border-l-4 border-purple-500';
      case 'friend': return 'border-l-4 border-blue-500';
      default: return 'border-l-4 border-transparent';
    }
  }

  return (
    <div className={`w-96 flex flex-col transition-colors duration-300 border-r ${
  theme === 'dark' 
    ? 'bg-gray-900 border-gray-700' 
    : theme === 'romantic' 
    ? 'bg-[#FFF0F5] border-[#FFB6C1]' 
    : 'bg-white border-gray-200'
}`}>
      <div className={`p-4 border-b ${theme === 'romantic' ? 'border-[#FFB6C1]' : 'border-gray-200 dark:border-gray-700'}`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={profile.display_name}
                  className="w-12 h-12 rounded-full object-cover"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white font-medium text-lg">
                  {profile?.display_name?.[0] || 'U'}
                </div>
              )}
              {profile?.is_online && (
                <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
              )}
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Heart className="w-5 h-5 text-pink-500 fill-pink-500" />
                Sweet
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">@{profile?.username}</p>
            </div>
          </div>

          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <MoreVertical className="w-5 h-5 text-gray-600" />
            </button>

            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMenu(false)}
                />
                  <div className={`absolute right-0 top-full mt-2 w-64 rounded-xl shadow-lg py-2 z-20 border ${
  theme === 'romantic' 
    ? 'bg-[#FFE4E1] border-[#FFB6C1]' 
    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
}`}>                  <button
                    onClick={() => {
                      onShowProfile();
                      setShowMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-3 text-gray-700"
                  >
                    <UserIcon className="w-5 h-5" />
                    <span>Profile</span>
                  </button>
                  <button
                    onClick={() => {
                      onShowSettings();
                      setShowMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-3 text-gray-700"
                  >
                    <Settings className="w-5 h-5" />
                    <span>Settings</span>
                  </button>
                  <button
                    onClick={() => {
                      setShowMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-3 text-gray-700"
                  >
                    <Lock className="w-5 h-5" />
                    <span>Locked Chats</span>
                  </button>
                  <div className="border-t border-gray-200 my-2" />
                  <button
                    onClick={() => {
                      signOut();
                      setShowMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-3 text-red-600"
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search chats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full pl-10 pr-4 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 transition-colors ${
  theme === 'romantic'
    ? 'bg-white border-[#FFB6C1] text-[#4B004B] placeholder:text-[#8B004B]/50'
    : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white dark:placeholder-gray-400'
}`}
          />
        </div>

        <div className="flex gap-2 mt-3">
          <button
            onClick={onShowFriends}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-xl hover:from-pink-600 hover:to-rose-600 transition-all"
          >
            <Users className="w-4 h-4" />
            <span className="text-sm font-medium">Friends</span>
          </button>
          <button
  onClick={onShowCreateChat}
  className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl transition-all border ${
    theme === 'romantic'
      ? 'bg-white border-[#FFB6C1] text-[#FF69B4] hover:bg-[#FFE4E1]' 
      /* Uses your --border-color and --primary-color */
      : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-transparent hover:bg-gray-200'
  }`}
>
  <MessageSquarePlus className="w-4 h-4" />
</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-8 h-8 border-3 border-pink-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredChats.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <MessageSquarePlus className="w-16 h-16 text-gray-300 mb-3" />
            <p className="text-gray-500 font-medium">No chats yet</p>
            <p className="text-gray-400 text-sm mt-1">
              Start a conversation with your friends
            </p>
          </div>
        ) : (
          <div>
            {filteredChats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => onSelectChat(chat.id)}
                className={`w-full p-4 flex items-start gap-3 transition-all ${
  selectedChatId === chat.id 
    ? theme === 'romantic' ? 'bg-[#FFC0CB]/40' : 'bg-pink-50 dark:bg-pink-900/30' 
    : theme === 'romantic' ? 'hover:bg-[#FFC0CB]/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
} ${getThemeColor(chat.theme)}`}
              >
                <div className="relative flex-shrink-0">
                  {chat.type === 'direct' && chat.otherUser ? (
                    <>
                      {chat.otherUser.avatar_url ? (
                        <img
                          src={chat.otherUser.avatar_url}
                          alt={chat.otherUser.display_name}
                          className="w-12 h-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white font-medium">
                          {chat.otherUser.display_name[0]}
                        </div>
                      )}
                      {chat.otherUser.is_online && (
                        <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
                      )}
                    </>
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white">
                      <Users className="w-6 h-6" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {chat.type === 'direct' ? chat.otherUser?.display_name : chat.name}
                    </h3>
                    {chat.lastMessage && (
                      <span className="text-xs text-gray-500 ml-2">
                        {formatTime(chat.lastMessage.created_at)}
                      </span>
                    )}
                  </div>
                  {chat.lastMessage && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                      {chat.lastMessage.content}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
