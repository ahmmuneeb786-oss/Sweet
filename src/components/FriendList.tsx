import { useState, useEffect } from 'react';
import { X, Search, UserPlus, Check, X as XIcon, MessageCircle, Inbox, Users, Heart, SearchX } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { localDB } from '../db';
import { useNotify } from '../contexts/NotificationContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePresence } from '../hooks/usePresence';

interface FriendListProps {
  theme: 'light' | 'dark' | 'sweet';
  onClose: () => void;
  onSelectUser: (user: any) => void;
  setActiveChatId: (id: string) => void;
  /** Which tab to open on. The chat list's "Friends" button opens 'search'
   *  so users can immediately look someone up to add. */
  initialTab?: 'friends' | 'requests' | 'search';
}

interface Friend {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  is_online: boolean;
  last_seen: string;
}

interface FriendRequest {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: string;
  profiles: {
    username: string;
    display_name: string;
    avatar_url: string | null;
  };
}

// Shared sweet empty-state — same silhouette across tabs (soft gradient
// badge, heading, subtitle) but each tab passes its own icon/copy so the
// three read as distinct moods rather than the same "person +" everywhere.
function EmptyState({
  icon: Icon,
  accent,
  title,
  subtitle,
  theme,
}: {
  icon: typeof UserPlus;
  accent: React.ReactNode;
  title: string;
  subtitle: string;
  theme: 'light' | 'dark' | 'sweet';
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[16rem] text-center px-6 animate-in fade-in duration-300">
      <div className="relative mb-4">
        <div className={`w-20 h-20 rounded-[28px] flex items-center justify-center rotate-3 ${
          theme === 'sweet'
            ? 'bg-gradient-to-br from-[#FFD1DC] to-[#FF9EC0] shadow-lg shadow-pink-200/60'
            : 'bg-gradient-to-br from-pink-400 to-rose-500 shadow-lg'
        }`}>
          <Icon className="w-9 h-9 text-white" strokeWidth={1.75} />
        </div>
        {/* Little floating accent for extra sweetness */}
        <div className="absolute -top-1.5 -right-1.5 w-7 h-7 rounded-full bg-white shadow-md flex items-center justify-center">
          {accent}
        </div>
      </div>
      <h3 className={`font-bold text-base ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-800 dark:text-white'}`}>
        {title}
      </h3>
      <p className={`text-sm mt-1 max-w-[230px] leading-relaxed ${theme === 'sweet' ? 'text-[#8B004B]/70' : 'text-gray-400'}`}>
        {subtitle}
      </p>
    </div>
  );
}

export function FriendList({ theme, onClose, onSelectUser, setActiveChatId, initialTab = 'friends' }: FriendListProps) {
  const { user } = useAuth();
  const { showSuccess, showError } = useNotify();
  const confirm = useConfirm();
  const { isOnline } = usePresence(user?.id);
  const [activeTab, setActiveTab] = useState<'friends' | 'requests' | 'search'>(initialTab);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [sentRequests, setSentRequests] = useState<FriendRequest[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      loadFriends();
      loadFriendRequests();
    }
  }, [user]);

  useEffect(() => {
    if (searchQuery && activeTab === 'search') {
      const timeoutId = setTimeout(() => {
        searchUsers();
      }, 500);
      return () => clearTimeout(timeoutId);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery, activeTab]);

  async function loadFriends() {
    if (!user) return;
    try {
      // 1. ALWAYS LOAD LOCAL DEVICE CACHE FIRST (Instant & Works Offline!)
      const localProfiles = await localDB.profiles.toArray();
      if (localProfiles && localProfiles.length > 0) {
        setFriends(
          localProfiles
            .filter((p) => p.id !== user.id) // own cached profile isn't a friend
            .map((p) => ({
              id: p.id,
              username: p.username,
              display_name: p.display_name,
              avatar_url: p.avatar_url,
              is_online: false, // Default to offline when device is offline
              last_seen: new Date().toISOString()
            }))
        );
      }

      // 2. ONLINE REFRESH: If connected, get fresh updates from Supabase
      if (navigator.onLine) {
        const { data: friendsData, error } = await supabase
          .from('friends')
          .select(`
            friend_id,
            profiles!friends_friend_id_fkey (
              id,
              username,
              display_name,
              avatar_url,
              is_online,
              last_seen
            )
          `)
          .eq('user_id', user.id);

        if (error) throw error;

        if (friendsData) {
          const friendsList = friendsData
            .map((f: any) => f.profiles)
            .filter(Boolean);

          setFriends(friendsList);

          // 3. Keep local cache up-to-date for future offline sessions.
          // Deliberately NOT clearing the table first — profiles.clear()
          // wipes EVERY cached profile, including the current user's own
          // (face_descriptor/face_lock_enabled live in this same table),
          // every single time this panel loaded online. Just upsert the
          // current friends instead; a removed friend lingering briefly in
          // cache is a much smaller issue than silently wiping own face data.
          for (const friend of friendsList) {
            await localDB.saveUserProfile(friend.id, {
              username: friend.username,
              display_name: friend.display_name,
              avatar_url: friend.avatar_url,
              bio: ''
            });
          }
        }
      }
    } catch (error) {
      console.error('Error loading friends list sync:', error);
    }
  }

  async function loadFriendRequests() {
    if (!user) return;
    try {
      const { data: received } = await supabase
        .from('friend_requests')
        .select(`
          *,
          profiles!friend_requests_sender_id_fkey (
            username,
            display_name,
            avatar_url
          )
        `)
        .eq('receiver_id', user.id)
        .eq('status', 'pending');

      const { data: sent } = await supabase
        .from('friend_requests')
        .select(`
          *,
          profiles!friend_requests_receiver_id_fkey (
            username,
            display_name,
            avatar_url
          )
        `)
        .eq('sender_id', user.id)
        .eq('status', 'pending');

      setFriendRequests(received || []);
      setSentRequests(sent || []);
    } catch (error) {
      console.error('Error loading friend requests:', error);
    }
  }

  async function searchUsers() {
    if (!user || !searchQuery) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url, is_online, last_seen')
        .ilike('username', `%${searchQuery}%`)
        .neq('id', user.id)
        .limit(10);

      setSearchResults(data || []);
    } catch (error) {
      console.error('Error searching users:', error);
    } finally {
      setLoading(false);
    }
  }

  async function sendFriendRequest(userId: string) {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('friend_requests')
        .insert({
          sender_id: user.id,
          receiver_id: userId,
          status: 'pending'
        });

      if (error) throw error;

      showSuccess("Request sent successfully!");
      loadFriendRequests();
    } catch (error: any) {
      console.error('Error sending friend request:', error);
      showError(error.message || "Failed to send request");
    }
  }

  async function acceptFriendRequest(requestId: string, senderId: string) {
    if (!user) return;
    try {
      await supabase
        .from('friend_requests')
        .update({ status: 'accepted' })
        .eq('id', requestId);

      const { error: friendError } = await supabase
        .from('friends')
        .upsert([
          { user_id: user.id, friend_id: senderId },
          { user_id: senderId, friend_id: user.id }
        ], { onConflict: 'user_id, friend_id' });

      if (friendError) throw friendError;

      await loadFriends();
      await loadFriendRequests();

      showSuccess("Friendship confirmed!");
    } catch (error: any) {
      showError("Error: " + error.message);
    }
  }

  async function rejectFriendRequest(requestId: string) {
    try {
      await supabase
        .from('friend_requests')
        .delete()
        .eq('id', requestId);

      loadFriendRequests();
    } catch (error) {
      console.error('Error rejecting friend request:', error);
    }
  }

  async function removeFriend(friendId: string) {
    if (!user) return;
    const confirmed = await confirm({
      title: 'Remove friend?',
      message: "You'll need to send a new friend request to reconnect.",
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await supabase
        .from('friends')
        .delete()
        .or(`user_id.eq.${user.id},user_id.eq.${friendId}`)
        .or(`friend_id.eq.${user.id},friend_id.eq.${friendId}`);

      loadFriends();
    } catch (error) {
      console.error('Error removing friend:', error);
      showError("Couldn't remove this friend. Please try again.");
    }
  }

  function isRequestSent(userId: string) {
    return sentRequests.some(r => r.receiver_id === userId);
  }

  function isFriend(userId: string) {
    return friends.some(f => f.id === userId);
  }

  async function handleStartChat(friendId: string) {
    if (!user) return;

    const sortedIds = [user.id, friendId].sort();
    const consistentRoomId = `${sortedIds[0]}_${sortedIds[1]}`;

    try {
      const targetFriend = friends.find(f => f.id === friendId);

      // OFFLINE FIRST LAYER
      await localDB.chats.put({
        id: consistentRoomId,
        type: 'direct',
        name: targetFriend?.display_name || 'Direct Chat',
        avatar_url: targetFriend?.avatar_url || null,
        theme: 'sweet',
        last_message_content: "No messages yet... 👋",
        last_message_time: new Date().toISOString(),
        other_user_id: targetFriend?.id,
        other_user_name: targetFriend?.display_name,
        other_user_avatar: targetFriend?.avatar_url,
        other_user_last_seen: targetFriend?.last_seen,
      });

      // Navigate into the chat window immediately
      setActiveChatId(consistentRoomId);

      // BACKGROUND ONLINE LAYER
      if (navigator.onLine) {
        const { data: existingChat } = await supabase
          .from('chats')
          .select('id')
          .eq('id', consistentRoomId)
          .maybeSingle();

        if (!existingChat) {
          const { error: chatError } = await supabase
            .from('chats')
            .insert({
              id: consistentRoomId,
              type: 'direct',
              theme: 'sweet'
            });

          if (chatError) throw chatError;

          await supabase.from('chat_participants').insert([
            { chat_id: consistentRoomId, user_id: user.id },
            { chat_id: consistentRoomId, user_id: friendId }
          ]);
        }
      }

    } catch (err: any) {
      console.warn("Background server syncing failed, continuing on local offline cache:", err);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
      <div className={`fixed right-0 top-0 h-full w-full md:w-96 shadow-2xl z-50 flex flex-col transition-colors duration-300 ${
        theme === 'sweet'
          ? 'bg-[#FFF0F5] border-l border-[#FFB6C1]'
          : 'bg-white dark:bg-gray-900'
      }`}>
        <div className={`p-6 border-b ${theme === 'sweet' ? 'border-[#FFB6C1]' : 'border-gray-200'}`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className={`text-xl font-bold ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>Friends</h2>
            <button
              onClick={onClose}
              className={`p-2 rounded-full transition-colors ${theme === 'sweet' ? 'hover:bg-[#FFC0CB]/40' : 'hover:bg-gray-100'}`}
            >
              <X className={`w-5 h-5 ${theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-600'}`} />
            </button>
          </div>

          <div className={`flex gap-2 p-1 rounded-xl ${theme === 'sweet' ? 'bg-[#FFC0CB]/40' : 'bg-gray-100 dark:bg-gray-800'}`}>
            <button
              onClick={() => setActiveTab('search')}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'search'
                  ? (theme === 'sweet' ? 'bg-[#FFF0F5] text-[#8B004B] shadow-sm' : 'bg-white text-pink-600 shadow-sm')
                  : (theme === 'sweet' ? 'text-[#8B004B]/60 hover:text-[#8B004B]' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white')
              }`}
            >
              Search
            </button>
            <button
              onClick={() => setActiveTab('requests')}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all relative ${
                activeTab === 'requests'
                  ? (theme === 'sweet' ? 'bg-[#FFF0F5] text-[#8B004B] shadow-sm' : 'bg-white text-pink-600 shadow-sm')
                  : (theme === 'sweet' ? 'text-[#8B004B]/60 hover:text-[#8B004B]' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white')
              }`}
            >
              Requests
              {friendRequests.length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-pink-500 text-white text-xs rounded-full flex items-center justify-center">
                  {friendRequests.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('friends')}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'friends'
                  ? (theme === 'sweet' ? 'bg-[#FFF0F5] text-[#8B004B] shadow-sm' : 'bg-white text-pink-600 shadow-sm')
                  : (theme === 'sweet' ? 'text-[#8B004B]/60 hover:text-[#8B004B]' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white')
              }`}
            >
              Friends ({friends.length})
            </button>
          </div>

          {activeTab === 'search' && (
            <div className="mt-4 relative">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${theme === 'sweet' ? 'text-[#8B004B]/50' : 'text-gray-400'}`} />
              <input
                type="text"
                placeholder="Search by username..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full pl-10 pr-4 py-2 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all border ${
                  theme === 'sweet' ? 'bg-[#FFF0F5] border-[#FFB6C1] text-[#4B004B]' : 'bg-white border-gray-300'
                }`}
              />
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {activeTab === 'friends' && (
            <div className="min-h-full flex flex-col">
              {user && (
                <div
                  className={`p-4 border-b cursor-pointer transition-colors flex items-center gap-3 ${
                    theme === 'sweet'
                      ? 'border-[#FFB6C1]/20 hover:bg-[#FFC0CB]/20'
                      : 'border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
                  onClick={() => {
                    onSelectUser({
                      id: user.id,
                      username: user.user_metadata?.username || 'me',
                      display_name: 'Saved Messages',
                      avatar_url: user.user_metadata?.avatar_url,
                      is_self_chat: true
                    });
                    onClose();
                  }}
                >
                  <div className="relative">
                    {user.user_metadata?.avatar_url ? (
                      <img
                        src={user.user_metadata.avatar_url}
                        className={`w-12 h-12 rounded-full object-cover border-2 ${theme === 'sweet' ? 'border-[#FF69B4]' : 'border-blue-400'}`}
                        alt="You"
                      />
                    ) : (
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-medium ${theme === 'sweet' ? 'bg-[#FF69B4]' : 'bg-blue-500'}`}>
                        You
                      </div>
                    )}
                    <div className={`absolute bottom-0 right-0 w-3 h-3 border-2 border-white dark:border-gray-900 rounded-full ${theme === 'sweet' ? 'bg-[#FF69B4]' : 'bg-blue-500'}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-center">
                      <h3 className={`font-bold ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>
                        Saved Messages
                      </h3>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-bold ${theme === 'sweet' ? 'bg-[#FFD1DC] text-[#8B004B]' : 'bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400'}`}>
                        You
                      </span>
                    </div>
                    <p className={`text-xs ${theme === 'sweet' ? 'text-[#8B004B]/70' : 'text-gray-500'}`}>Note to self</p>
                  </div>
                </div>
              )}

              {friends.length === 0 ? (
                <EmptyState
                  icon={Users}
                  accent={<Heart className="w-3.5 h-3.5 text-pink-500 fill-pink-500" />}
                  title="Your circle is empty"
                  subtitle="Add friends to start sharing sweet moments together."
                  theme={theme}
                />
              ) : (
                friends.map((friend) => {
                  return (
                    <div
                      key={friend.id}
                      className={`p-4 border-b transition-colors ${
                        theme === 'sweet'
                          ? 'border-[#FFB6C1]/20 hover:bg-[#FFC0CB]/20'
                          : 'border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          {friend.avatar_url ? (
                            <img src={friend.avatar_url} alt={friend.display_name} className="w-12 h-12 rounded-full object-cover" />
                          ) : (
                            <div className={`w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center text-white font-medium ${theme === 'sweet' ? 'from-[#FF69B4] to-[#FF1493]' : 'from-pink-400 to-purple-500'}`}>
                              {friend.display_name[0]}
                            </div>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <h3 className={`font-semibold truncate ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>
                            {friend.display_name}
                          </h3>
                          <p className={`text-sm truncate ${theme === 'sweet' ? 'text-[#8B004B]/70' : 'text-gray-500'}`}>@{friend.username}</p>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              handleStartChat(friend.id);
                              onClose();
                            }}
                            className={`p-2 rounded-full transition-colors ${
                              theme === 'sweet'
                                ? 'bg-[#FFB6C1] text-white hover:bg-[#FF69B4]'
                                : 'bg-pink-100 text-pink-600 hover:bg-pink-200'
                            }`}
                          >
                            <MessageCircle className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => removeFriend(friend.id)}
                            className="p-2 bg-red-100 text-red-600 rounded-full hover:bg-red-200 transition-colors"
                          >
                            <XIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {activeTab === 'requests' && (
            <div className="min-h-full flex flex-col">
              {friendRequests.length === 0 ? (
                <EmptyState
                  icon={Inbox}
                  accent={<span className="text-[13px] leading-none">💌</span>}
                  title="No requests yet"
                  subtitle="When someone wants to connect, their friend request will land right here."
                  theme={theme}
                />
              ) : (
                friendRequests.map((request) => (
                  <div
                    key={request.id}
                    className={`p-4 border-b ${theme === 'sweet' ? 'border-[#FFB6C1]/20' : 'border-gray-100'}`}
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        {request.profiles.avatar_url ? (
                          <img
                            src={request.profiles.avatar_url}
                            alt={request.profiles.display_name}
                            className="w-12 h-12 rounded-full object-cover"
                          />
                        ) : (
                          <div className={`w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center text-white font-medium ${theme === 'sweet' ? 'from-[#FF69B4] to-[#FF1493]' : 'from-pink-400 to-purple-500'}`}>
                            {request.profiles.display_name[0]}
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <h3 className={`font-semibold truncate ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>
                          {request.profiles.display_name}
                        </h3>
                        <p className={`text-sm truncate ${theme === 'sweet' ? 'text-[#8B004B]/70' : 'text-gray-500'}`}>
                          @{request.profiles.username}
                        </p>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => acceptFriendRequest(request.id, request.sender_id)}
                          className="p-2 bg-green-100 text-green-600 rounded-full hover:bg-green-200 transition-colors"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => rejectFriendRequest(request.id)}
                          className="p-2 bg-red-100 text-red-600 rounded-full hover:bg-red-200 transition-colors"
                        >
                          <XIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'search' && (
            <div className="min-h-full flex flex-col">
              {loading ? (
                <div className="flex items-center justify-center h-32">
                  <div className="w-8 h-8 border-3 border-pink-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : searchResults.length === 0 && searchQuery ? (
                <EmptyState
                  icon={SearchX}
                  accent={<span className="text-[13px] leading-none">🥺</span>}
                  title="No users found"
                  subtitle="We couldn't find anyone with that username. Try a different one."
                  theme={theme}
                />
              ) : searchResults.length === 0 ? (
                <EmptyState
                  icon={UserPlus}
                  accent={<Search className="w-3.5 h-3.5 text-pink-500" />}
                  title="Find your connections"
                  subtitle="Search any user in the app by their username to add them as a friend."
                  theme={theme}
                />
              ) : (
                searchResults.map((result) => {
                  return (
                    <div
                      key={result.id}
                      className={`p-4 border-b ${theme === 'sweet' ? 'border-[#FFB6C1]/20' : 'border-gray-100'}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          {result.avatar_url ? (
                            <img
                              src={result.avatar_url}
                              alt={result.display_name}
                              className="w-12 h-12 rounded-full object-cover"
                            />
                          ) : (
                            <div className={`w-12 h-12 rounded-full bg-gradient-to-br flex items-center justify-center text-white font-medium ${theme === 'sweet' ? 'from-[#FF69B4] to-[#FF1493]' : 'from-pink-400 to-purple-500'}`}>
                              {result.display_name[0]}
                            </div>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <h3 className={`font-semibold truncate ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>
                            {result.display_name}
                          </h3>
                          <p className={`text-sm truncate ${theme === 'sweet' ? 'text-[#8B004B]/70' : 'text-gray-500'}`}>
                            @{result.username}
                          </p>
                        </div>

                        {isFriend(result.id) ? (
                          <span className={`text-sm px-3 py-1 rounded-full ${theme === 'sweet' ? 'bg-[#FFD1DC] text-[#8B004B]' : 'bg-gray-100 text-gray-600'}`}>
                            Friend
                          </span>
                        ) : isRequestSent(result.id) ? (
                          <span className={`text-sm px-3 py-1 rounded-full ${theme === 'sweet' ? 'bg-[#FFD1DC] text-[#8B004B]' : 'bg-gray-100 text-gray-600'}`}>
                            Pending
                          </span>
                        ) : (
                          <button
                            onClick={() => sendFriendRequest(result.id)}
                            className="p-2 bg-pink-100 text-pink-600 rounded-full hover:bg-pink-200 transition-colors"
                          >
                            <UserPlus className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}