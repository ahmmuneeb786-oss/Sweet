import { useState, useEffect } from 'react';
import { Search, MoreVertical, MessageSquarePlus, Users, User as UserIcon, Settings, Lock, LogOut, Heart } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { FloatingHearts } from './FloatingHearts';
import { localDB } from '../db';

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
  const [chats, setChats] = useState<Chat[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine); // 🌐 Track network variations

  // Listen to network status modifications live
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      loadChats(); // 🔄 Quietly refresh and upgrade metadata the second connection returns
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
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
            
            setChats((currentChats) => {
              return currentChats.map((chat) => {
                if (chat.id === newMessage.chat_id) {
                  return {
                    ...chat,
                    lastMessage: {
                      content: newMessage.content,
                      created_at: newMessage.created_at
                    }
                  };
                }
                return chat;
              });
            });
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'profiles' },
          (payload) => {
            const updatedProfile = payload.new;

            setChats((currentChats) => {
              return currentChats.map((chat) => {
                if (chat.type === 'direct' && chat.otherUser && chat.otherUser.id === updatedProfile.id) {
                  return {
                    ...chat,
                    otherUser: {
                      ...chat.otherUser,
                      last_seen: updatedProfile.last_seen
                    }
                  };
                }
                return chat;
              });
            });
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  useEffect(() => {
    const tickerInterval = setInterval(() => {
      setChats(currentChats => [...currentChats]);
    }, 10000);
    return () => clearInterval(tickerInterval);
  }, []);

  async function loadChats() {
    if (!user) return;

    try {
      // PHASE 1: Read internal phone storage instantly
      const cachedChats = await localDB.chats.toArray();
      if (cachedChats.length > 0) {
        const formattedCache = cachedChats.map(c => ({
          id: c.id,
          type: c.type,
          name: c.name,
          avatar_url: c.avatar_url,
          theme: c.theme,
          lastMessage: c.last_message_content ? {
            content: c.last_message_content,
            created_at: c.last_message_time || ''
          } : undefined,
          otherUser: c.other_user_id ? {
            id: c.other_user_id,
            display_name: c.other_user_name || '',
            avatar_url: c.other_user_avatar || null,
            last_seen: c.other_user_last_seen || null
          } : undefined
        }));
        
        setChats(formattedCache);
        setLoading(false);
      } else {
        setLoading(true);
      }

      // PHASE 2: Quietly ask Supabase if there are new changes over the network
      if (navigator.onLine) {
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
          return;
        }

        if (!participants || participants.length === 0) {
          setChats([]);
          await localDB.chats.clear();
          return;
        }

        const chatIds = participants.map(p => p.chat_id);

        const { data: messages } = await supabase
          .from('messages')
          .select('chat_id, content, created_at')
          .in('chat_id', chatIds)
          .order('created_at', { ascending: false });

        const freshLocalChats: any[] = [];

        for (const p of participants) {
          const chatData = Array.isArray(p.chats) ? p.chats[0] : p.chats;
          if (!chatData) continue;

          const lastMsg = messages?.find(m => m.chat_id === p.chat_id);
          
          let otherUserObj: any = null;
          if (chatData.type === 'direct') {
            const { data: otherParticipant } = await supabase
              .from('chat_participants')
              .select(`profiles:user_id ( id, display_name, avatar_url, last_seen )`)
              .eq('chat_id', chatData.id)
              .neq('user_id', user.id)
              .maybeSingle();

            if (otherParticipant && otherParticipant.profiles) {
              otherUserObj = Array.isArray(otherParticipant.profiles) 
                ? otherParticipant.profiles[0] 
                : otherParticipant.profiles;
            }
          }

          freshLocalChats.push({
            id: chatData.id,
            type: chatData.type,
            name: chatData.name,
            avatar_url: chatData.avatar_url,
            theme: chatData.theme,
            last_message_content: lastMsg?.content,
            last_message_time: lastMsg?.created_at,
            other_user_id: otherUserObj?.id,
            other_user_name: otherUserObj?.display_name,
            other_user_avatar: otherUserObj?.avatar_url,
            other_user_last_seen: otherUserObj?.last_seen
          });
        }

        // PHASE 3: Write data back into local User Data memory files
        await localDB.chats.bulkPut(freshLocalChats);

        const finalChats = freshLocalChats.map(c => ({
          id: c.id,
          type: c.type,
          name: c.name,
          avatar_url: c.avatar_url,
          theme: c.theme,
          lastMessage: c.last_message_content ? { content: c.last_message_content, created_at: c.last_message_time || '' } : undefined,
          otherUser: c.other_user_id ? { id: c.other_user_id, display_name: c.other_user_name || '', avatar_url: c.other_user_avatar || null, last_seen: c.other_user_last_seen || null } : undefined
        }));
        setChats(finalChats);
      }
    } catch (error) {
      console.error('Logic Error loading chats:', error);
    } finally {
      setLoading(false);
    }
  }

  const filteredChats = chats.filter(chat => {
    const chatName = chat.type === 'direct'
      ? chat.otherUser?.display_name || ''
      : chat.name || '';
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

  function checkIsOnline(lastSeenTimestamp: string | null | undefined): boolean {
    if (!lastSeenTimestamp) return false;
    
    const lastSeen = new Date(lastSeenTimestamp).getTime();
    const now = new Date().getTime();
    const diffInSeconds = Math.abs(now - lastSeen) / 1000;
    
    return diffInSeconds <= 60;
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
    <div className={`w-full md:w-96 h-full p-4 border-b sticky top-0 z-10 bg-[#FFE4E1]/90 backdrop-blur-md flex-shrink-0 ${theme === 'sweet' ? 'bg-[#FFF0F5] border-[#FFB6C1]' : 'bg-white dark:bg-gray-900 border-gray-200'}`}>
      <div className="md:hidden absolute inset-0 overflow-hidden pointer-events-none z-0">
        <FloatingHearts />
      </div>
      <div className={`p-4 border-b ${theme === 'sweet' ? 'border-[#FFB6C1]' : 'border-gray-200 dark:border-gray-700'}`}>
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
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white font-medium text-lg uppercase">
                  {profile?.display_name?.[0] || profile?.username?.[0] || 'U'}
                </div>
              )}
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2 whitespace-nowrap">
                <Heart className="w-5 h-5 text-pink-500 fill-pink-500 shrink-0" />
                Sweet
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">@{profile?.username}</p>
            </div>
          </div>

          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className={`p-2 rounded-full transition-colors outline-none ${
                theme === 'dark'
                  ? 'hover:bg-gray-800 text-white'
                  : theme === 'sweet'
                    ? 'hover:bg-[#FAD1D1] text-[#4B004B]'
                    : 'hover:bg-gray-100 text-gray-700'
              }`}
            >
              <MoreVertical className={`w-5 h-5 ${theme === 'dark' ? 'text-gray-200' : theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-700'}`} />
            </button>

            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMenu(false)}
                />
                <div className={`absolute right-0 top-full mt-2 w-64 rounded-xl shadow-lg py-2 z-20 border ${
                  theme === 'sweet'
                    ? 'bg-[#FFE4E1] border-[#FFB6C1]'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                }`}>
                  <button
                    onClick={() => {
                      onShowProfile();
                      setShowMenu(false);
                    }}
                    className={`w-full px-4 py-2 text-left flex items-center gap-3 transition-colors ${
                      theme === 'sweet'
                        ? 'text-[#8B004B] hover:bg-white'
                        : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <UserIcon className="w-5 h-5" />
                    <span>Profile</span>
                  </button>
                  <button
                    onClick={() => {
                      onShowSettings();
                      setShowMenu(false);
                    }}
                    className={`w-full px-4 py-2 text-left flex items-center gap-3 transition-colors ${
                      theme === 'sweet'
                        ? 'text-[#8B004B] hover:bg-white'
                        : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <Settings className="w-5 h-5" />
                    <span>Settings</span>
                  </button>
                  <button
                    onClick={() => {
                      onShowLockedChats();
                      setShowMenu(false);
                    }}
                    className={`w-full px-4 py-2 text-left flex items-center gap-3 transition-colors ${
                      theme === 'sweet'
                        ? 'text-[#8B004B] hover:bg-white'
                        : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <Lock className="w-5 h-5" />
                    <span>Locked Chats</span>
                  </button>
                  <div className={`border-t my-2 ${theme === 'sweet' ? 'border-[#FFB6C1]' : 'border-gray-200 dark:border-gray-700'}`} />
                  <button
                    onClick={() => {
                      signOut();
                      setShowMenu(false);
                    }}
                    className={`w-full px-4 py-2 text-left flex items-center gap-3 transition-colors ${
                      theme === 'sweet'
                        ? 'text-rose-600 hover:bg-white'
                        : 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30'
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
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-400'}`} />
          <input
            type="text"
            placeholder="Search chats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full pl-10 pr-4 py-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 transition-colors border ${
              theme === 'sweet'
                ? 'bg-white border-[#FFB6C1] text-[#8B004B] placeholder:text-[#8B004B]'
                : 'bg-gray-100 dark:bg-gray-700 border-transparent text-gray-900 dark:text-white dark:placeholder-gray-400'
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
              theme === 'sweet'
                ? 'bg-white border-[#FFB6C1] text-[#8B004B] hover:bg-[#FFE4E1]'
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
            {filteredChats.map((chat) => {
              return (
                <button
                  key={chat.id}
                  onClick={() => onSelectChat(chat.id)}
                  className={`w-full p-4 flex items-start gap-3 transition-all active:scale-[0.98] ${
                    selectedChatId === chat.id
                      ? theme === 'sweet' ? 'bg-[#FFC0CB]/40' : 'bg-pink-50 dark:bg-pink-900/30'
                      : theme === 'sweet' ? 'hover:bg-[#FFC0CB]/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
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
                            {chat.otherUser.display_name[0] || 'U'}
                          </div>
                        )}
                        <span
                          className={`absolute bottom-0 right-0 block h-3.5 w-3.5 rounded-full border-2 ${
                            theme === 'sweet' ? 'border-[#FFF0F5]' : 'border-white dark:border-gray-900'
                          } ${
                            checkIsOnline(chat.otherUser.last_seen) ? 'bg-green-500' : 'bg-gray-400'
                          }`}
                        />
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
                      {chat.lastMessage?.created_at && (
                        <span className="text-xs text-gray-500 ml-2">
                          {formatTime(chat.lastMessage.created_at)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                      {chat.lastMessage ? chat.lastMessage.content : "No messages yet... 👋"}
                    </p>
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