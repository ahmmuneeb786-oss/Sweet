import { useState, useEffect } from 'react';
import { X, Search, UserPlus, Check, X as XIcon, MessageCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

interface FriendListProps {
  theme: 'light' | 'dark' | 'sweet';
  onClose: () => void;
  onSelectUser: (user: any) => void;
  setActiveChatId: (id: string) => void;
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

export function FriendList({ theme, onClose, onSelectUser, setActiveChatId }: FriendListProps) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'friends' | 'requests' | 'search'>('friends');
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
    const { data: friendships, error } = await supabase
      .from('friends')
      .select(`
        friend_id,
        profiles:friend_id (
          id,
          username,
          display_name,
          avatar_url,
          is_online,
          last_seen
        )
      `)
      .eq('user_id', user.id);

    if (error) {
      console.error('Database Error:', error);
      return;
    }

    if (friendships) {
      // We rename the mapping to 'profiles' because of the 'profiles:friend_id' alias above
      const friendsList = friendships.map((f: any) => f.profiles).filter(Boolean);
      setFriends(friendsList);
    }
  } catch (error) {
    console.error('Error loading friends:', error);
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

      alert("Request sent successfully!"); // Added this for feedback
      loadFriendRequests(); // This refreshes your 'sentRequests' state
    } catch (error: any) {
      console.error('Error sending friend request:', error);
      alert(error.message || "Failed to send request");
    }
  }

  async function acceptFriendRequest(requestId: string, senderId: string) {
  if (!user) return;
  try {
    // 1. Mark request as accepted
    await supabase
      .from('friend_requests')
      .update({ status: 'accepted' })
      .eq('id', requestId);

    // 2. Use .upsert instead of .insert
    // This prevents the "duplicate key" error if you click twice
    const { error: friendError } = await supabase
      .from('friends')
      .upsert([
        { user_id: user.id, friend_id: senderId },
        { user_id: senderId, friend_id: user.id }
      ], { onConflict: 'user_id, friend_id' });

    if (friendError) throw friendError;

    // 3. Force the UI to update
    await loadFriends();
    await loadFriendRequests();
    
    alert("Friendship confirmed!");
  } catch (error: any) {
    alert("Error: " + error.message);
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
    try {
      await supabase
        .from('friends')
        .delete()
        .or(`user_id.eq.${user.id},user_id.eq.${friendId}`)
        .or(`friend_id.eq.${user.id},friend_id.eq.${friendId}`);

      loadFriends();
    } catch (error) {
      console.error('Error removing friend:', error);
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

  try {
    // 1. Create the SAME consistent ID we used in other files
    const sortedIds = [user.id, friendId].sort();
    const consistentRoomId = `${sortedIds[0]}_${sortedIds[1]}`;

    // 2. Check if this room exists
    const { data: existingChat } = await supabase
      .from('chats')
      .select('id')
      .eq('id', consistentRoomId)
      .maybeSingle();

    if (existingChat) {
      setActiveChatId(existingChat.id);
      return;
    }

    // 3. If no chat exists, create it with our consistentRoomId
    const { error: chatError } = await supabase
      .from('chats')
      .insert({ 
        id: consistentRoomId, // Use our ID, not a random one!
        type: 'direct', 
        theme: 'sweet' 
      });

    if (chatError) throw chatError;

    // 4. Link both users
    await supabase.from('chat_participants').insert([
      { chat_id: consistentRoomId, user_id: user.id },
      { chat_id: consistentRoomId, user_id: friendId }
    ]);

    setActiveChatId(consistentRoomId);

  } catch (err: any) {
    console.error("Error starting chat:", err);
    alert("Chat room setup failed: " + err.message);
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
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className={`text-xl font-bold ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>Friends</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X className="w-5 h-5 text-gray-600" />
            </button>
          </div>

          <div className={`flex gap-2 p-1 rounded-xl ${theme === 'sweet' ? 'bg-[#FFC0CB]/40' : 'bg-gray-100 dark:bg-gray-800'}`}>
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
              onClick={() => setActiveTab('search')}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'search'
                  ? (theme === 'sweet' ? 'bg-[#FFF0F5] text-[#8B004B] shadow-sm' : 'bg-white text-pink-600 shadow-sm')
                  : (theme === 'sweet' ? 'text-[#8B004B]/60 hover:text-[#8B004B]' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white')
              }`}
            >
              Search
            </button>
          </div>

          {activeTab === 'search' && (
            <div className="mt-4 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search by username..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all"
              />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === 'friends' && (
  <div>
    {/* SAVED MESSAGES (MESSAGE YOURSELF) SECTION */}
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
    is_self_chat: true // This helps the chat know it's a "Saved Messages" chat
  });
  onClose(); 
}}
      >
        <div className="relative">
          {user.user_metadata?.avatar_url ? (
            <img
              src={user.user_metadata.avatar_url}
              className="w-12 h-12 rounded-full object-cover border-2 border-blue-400"
              alt="You"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-blue-500 flex items-center justify-center text-white font-medium">
              You
            </div>
          )}
          <div className="absolute bottom-0 right-0 w-3 h-3 bg-blue-500 border-2 border-white dark:border-gray-900 rounded-full" />
        </div>
        <div className="flex-1">
          <div className="flex justify-between items-center">
            <h3 className={`font-bold ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>
              Saved Messages
            </h3>
            <span className="text-[10px] bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded uppercase font-bold">
              You
            </span>
          </div>
          <p className="text-xs text-gray-500">Note to self</p>
        </div>
      </div>
    )}

    {/* EXISTING FRIENDS LIST LOGIC */}
    {friends.length === 0 ? (
      <div className="flex flex-col items-center justify-center h-64 text-center px-4">
        <UserPlus className="w-16 h-16 text-gray-300 mb-3" />
        <p className="text-gray-500 font-medium">No friends yet</p>
        <p className="text-gray-400 text-sm mt-1">Search for users to add as friends</p>
      </div>
    ) : (
      friends.map((friend) => (
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
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white font-medium">
                  {friend.display_name[0]}
                </div>
              )}
              {friend.is_online && (
                <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <h3 className={`font-semibold truncate ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>
                {friend.display_name}
              </h3>
              <p className="text-sm text-gray-500 truncate">@{friend.username}</p>
            </div>

            <div className="flex gap-2">
              <button 
  onClick={() => {
    // Instead of onSelectUser(friend), call a function that handles the database
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
      ))
    )}
  </div>
)}

          {/* Friend Requests Tab */}
          {activeTab === 'requests' && (
            <div>
              {friendRequests.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 text-center px-4">
                  <UserPlus className="w-16 h-16 text-gray-300 mb-3" />
                  <p className="text-gray-500 font-medium">No friend requests</p>
                </div>
              ) : (
                friendRequests.map((request) => (
                  <div
                    key={request.id}
                    className="p-4 border-b border-gray-100"
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
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white font-medium">
                            {request.profiles.display_name[0]}
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <h3 className={`font-semibold truncate ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>
                          {request.profiles.display_name}
                        </h3>
                        <p className="text-sm text-gray-500 truncate">
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

          {/* Search Tab */}
          {activeTab === 'search' && (
            <div>
              {loading ? (
                <div className="flex items-center justify-center h-32">
                  <div className="w-8 h-8 border-3 border-pink-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : searchResults.length === 0 && searchQuery ? (
                <div className="flex flex-col items-center justify-center h-64 text-center px-4">
                  <Search className="w-16 h-16 text-gray-300 mb-3" />
                  <p className="text-gray-500 font-medium">No users found</p>
                  <p className="text-gray-400 text-sm mt-1">
                    Try searching with a different username
                  </p>
                </div>
              ) : (
                searchResults.map((result) => (
                  <div
                    key={result.id}
                    className="p-4 border-b border-gray-100"
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        {result.avatar_url ? (
                          <img
                            src={result.avatar_url}
                            alt={result.display_name}
                            className="w-12 h-12 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white font-medium">
                            {result.display_name[0]}
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <h3 className={`font-semibold truncate ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>
                          {result.display_name}
                        </h3>
                        <p className="text-sm text-gray-500 truncate">
                          @{result.username}
                        </p>
                      </div>

                      {isFriend(result.id) ? (
                        <span className="text-sm text-gray-600 px-3 py-1 bg-gray-100 rounded-full">
                          Friend
                        </span>
                      ) : isRequestSent(result.id) ? (
                        <span className="text-sm text-gray-600 px-3 py-1 bg-gray-100 rounded-full">
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
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}