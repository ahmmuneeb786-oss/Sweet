import { useState, useEffect, useRef } from 'react';
import { Send, Smile, Paperclip, Phone, Video, Image as ImageIcon, X, Mic, AlertCircle, Check } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { Message } from './Message';
import { ChatMenu } from './ChatMenu';

interface ChatWindowProps {
  chatId: string;
  theme: 'light' | 'dark' | 'romantic';
}

interface MessageType {
  id: string;
  chat_id: string;
  sender_id: string;
  content: string | null;
  type: string;
  media_url: string | null;
  reply_to_id: string | null;
  is_edited: boolean;
  is_deleted: boolean;
  created_at: string;
  delivery_status?: 'sending' | 'sent' | 'delivered' | 'read';
  profiles: {  // Make sure this is an object, not a string
    display_name: string;
    avatar_url: string | null;
    username: string;
  };
}

interface ChatInfo {
  id: string;
  type: 'direct' | 'group';
  name: string | null;
  theme: string;
  otherUser?: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    is_online: boolean;
    last_seen: string;
  };
}

const reactions = ['💖', '🥰', '😍', '💋', '😂'];

export function ChatWindow({ chatId, theme }: ChatWindowProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<MessageType[]>([]);
  const [chatInfo, setChatInfo] = useState<ChatInfo | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const [failedMessages, setFailedMessages] = useState<Set<string>>(new Set());
  const [sendingMessages, setSendingMessages] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
  if (chatId && user) {
    setLoading(true);
    setChatInfo(null);
    loadChat(); // This runs first to find the real room ID
  }
}, [chatId, user]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  async function loadChat() {
  if (!user || !chatId) return;

  try {
    // 1. Instant check for Saved Messages
    if (chatId === user.id) {
      await supabase.from('chats').upsert({ id: user.id, type: 'direct', name: 'Saved Messages', theme: 'love' });
      setChatInfo({
        id: user.id,
        type: 'direct',
        name: 'Saved Messages',
        theme: 'love',
        otherUser: { id: user.id, display_name: 'Saved Messages', avatar_url: user.user_metadata?.avatar_url || null, is_online: true, last_seen: new Date().toISOString() }
      });
      setLoading(false);
      return; 
    }

    // 2. Try to find the chat by ID directly
    let { data: chat } = await supabase.from('chats').select('*').eq('id', chatId).maybeSingle();

    if (!chat) {
      // Create a UNIQUE room ID by sorting both User IDs alphabetically
      // This ensures that (Ahmad + Hamza) always produces the same string
      const sortedIds = [user.id, chatId].sort(); 
      const consistentRoomId = `${sortedIds[0]}_${sortedIds[1]}`;

      // Now check if THIS consistent ID exists
      let { data: existingChat } = await supabase
        .from('chats')
        .select('*')
        .eq('id', consistentRoomId)
        .maybeSingle();

      if (!existingChat) {
        // Only if it doesn't exist, create it once
        const { data: newChat, error } = await supabase
          .from('chats')
          .insert({ id: consistentRoomId, type: 'direct', updated_at: new Date().toISOString() })
          .select()
          .single();
        
        if (error) return;

        // Add both as participants using the sorted IDs
        await supabase.from('chat_participants').insert([
          { chat_id: consistentRoomId, user_id: sortedIds[0] },
          { chat_id: consistentRoomId, user_id: sortedIds[1] }
        ]);
        
        existingChat = newChat;
      }
      chat = existingChat;
    }

    let chatData: ChatInfo = { id: chat.id, type: chat.type, name: chat.name || 'Chat', theme: chat.theme };

    // Inside loadChat function
// Inside loadChat function
    // Look for this section in loadChat
const { data: otherParticipant, error: partError } = await supabase
  .from('chat_participants')
  .select(`
    user_id,
    profiles:user_id (id, display_name, avatar_url, is_online, last_seen)
  `) 
  .eq('chat_id', chat.id)
  .neq('user_id', user.id)
  .maybeSingle();

    if (partError) console.error("Participant fetch error:", partError);

    // IMPORTANT: Map the fetched profile to chatData before setting state
    if (otherParticipant && (otherParticipant as any).profiles) {
      chatData.otherUser = (otherParticipant as any).profiles;
    }

    setChatInfo(chatData);
  } catch (error) {
    console.error('Error in loadChat:', error);
  } finally {
    setLoading(false);
  }
}

  async function loadMessages() {
  if (!chatInfo?.id) return; // Always use the resolved chatInfo ID

  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*, profiles(display_name, avatar_url, username)')
      .eq('chat_id', chatInfo.id) // Query using the permanent UUID
      .order('created_at', { ascending: true });

    if (error) throw error;
    setMessages(data || []);
  } catch (error) {
    console.error('Error loading messages:', error);
  }
}

async function markMessagesAsRead() {
  if (!chatInfo?.id || !user) return;

  const { error } = await supabase
    .from('messages')
    .update({ delivery_status: 'read' })
    .eq('chat_id', chatInfo.id)
    .neq('sender_id', user.id) // Only mark messages sent by the OTHER person
    .neq('delivery_status', 'read'); // Only update if not already read

  if (error) console.error('Error marking as read:', error);
}

  function subscribeToMessages() {
    if (!chatInfo?.id) return;

    const channel = supabase
      .channel(`chat_messages:${chatInfo.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatInfo.id}`,
        },
        async (payload) => {
          // 1. Fetch the full message WITH profiles to prevent the white screen crash
          const { data, error } = await supabase
            .from('messages')
            .select('*, profiles(display_name, avatar_url, username)')
            .eq('id', payload.new.id)
            .single();

          if (data && !error) {
            const incomingMsg = data as unknown as MessageType;
            
            setMessages((prev) => {
              // 2. Match ID to avoid double-messages (Optimistic UI sync)
              const exists = prev.find(m => m.id === incomingMsg.id);
              if (exists) {
                // Replace temp message with real DB message (adds the blue ticks)
                return prev.map(m => m.id === incomingMsg.id ? incomingMsg : m);
              }
              // Add new message from others
              return [...prev, incomingMsg];
            });

            if (incomingMsg.sender_id !== user?.id) {
              markMessagesAsRead();
            }
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatInfo.id}`,
        },
        (payload) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === payload.new.id ? { ...m, ...payload.new, profiles: m.profiles } : m
            )
          );
        }
      )
      .subscribe((status) => {
        console.log("REALTIME_STATUS:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }

  function subscribeToTyping() {
  if (!chatInfo?.id) return;

  const channel = supabase
    .channel(`typing:${chatInfo.id}`)
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      // Don't show if the typing event is from me
      if (payload.userId !== user?.id) {
        setIsOtherTyping(true);
        
        // Hide after 3 seconds of no activity
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
          setIsOtherTyping(false);
        }, 3000);
      }
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

  async function handleSendMessage(e: React.FormEvent | React.KeyboardEvent) {
  e.preventDefault();
  if (!newMessage.trim() || !user || !chatInfo) return; // Add chatInfo check

  const tempMessage: MessageType = {
    id: crypto.randomUUID(),
    chat_id: chatInfo.id, // Use chatInfo.id instead of chatId prop
    sender_id: user.id,
    content: newMessage.trim(),
    type: "text",
    media_url: null,
    reply_to_id: null,
    is_edited: false,
    is_deleted: false,
    created_at: new Date().toISOString(),
    delivery_status: "sending",
    profiles: {
      display_name: user.user_metadata?.display_name || "You",
      avatar_url: user.user_metadata?.avatar_url || null,
      username: user.user_metadata?.username || "you"
    }
  };

  // optimistic UI update
  setMessages(prev => [...prev, tempMessage]);

  setNewMessage("");

  // Replace your existing insert block (around line 296) with this:
const { error } = await supabase.from("messages").insert({
  id: tempMessage.id, // <--- CRITICAL: Syncs the Optimistic UI with the Database
  chat_id: chatInfo.id,
  sender_id: user.id,
  content: tempMessage.content,
  type: "text",
  delivery_status: 'sent' // This triggers the first checkmark
});

  if (error) { console.error("Send failed:", error);
  }
}

useEffect(() => {
  let messageUnsubscribe: (() => void) | undefined;
  let typingUnsubscribe: (() => void) | undefined;
  let onlineStatusUnsubscribe: (() => void) | undefined;

  if (chatInfo?.id) {
    loadMessages();
    markMessagesAsRead();
    
    messageUnsubscribe = subscribeToMessages();
    typingUnsubscribe = subscribeToTyping();
    onlineStatusUnsubscribe = subscribeToOnlineStatus();
  }

  return () => {
    if (messageUnsubscribe) messageUnsubscribe();
    if (typingUnsubscribe) typingUnsubscribe();
    if (onlineStatusUnsubscribe) onlineStatusUnsubscribe();
  };
}, [chatInfo?.id, chatInfo?.otherUser?.id]);

  async function handleRetryMessage(messageId: string) {
    try {
      setSendingMessages(prev => new Set(prev).add(messageId));
      setFailedMessages(prev => {
        const updated = new Set(prev);
        updated.delete(messageId);
        return updated;
      });

      const msg = messages.find(m => m.id === messageId);
      if (!msg) return;

      const { error } = await supabase.from('messages').update({ delivery_status: 'sent' }).eq('id', messageId);
      if (error) throw error;

      setSendingMessages(prev => {
        const updated = new Set(prev);
        updated.delete(messageId);
        return updated;
      });
    } catch (error) {
      setFailedMessages(prev => new Set(prev).add(messageId));
      setSendingMessages(prev => {
        const updated = new Set(prev);
        updated.delete(messageId);
        return updated;
      });
    }
  }

  async function handleDeleteMessage(messageId: string) {
  try {
    // Option A: Hard Delete (removes from DB)
    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('id', messageId)
      .eq('sender_id', user?.id); // Safety: only delete if it's yours

    if (error) throw error;

    // Update local state immediately so it vanishes from screen
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    
  } catch (error) {
    console.error("Error deleting message:", error);
    alert("Could not delete message.");
  }
}

  async function handleTyping() {
  if (!user || !chatInfo?.id) return;

  // This sends a "whisper" through Supabase that doesn't touch the DB
  await supabase.channel(`typing:${chatInfo.id}`).send({
    type: 'broadcast',
    event: 'typing',
    payload: { userId: user.id },
  });
}

function subscribeToOnlineStatus() {
  if (!chatInfo?.otherUser?.id) return;

  // Listen for changes to the other user's profile row
  const channel = supabase
    .channel(`user_status:${chatInfo.otherUser.id}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${chatInfo.otherUser.id}`,
      },
      (payload) => {
        // Look for this section inside subscribeToOnlineStatus
setChatInfo((prev) => {
  if (!prev || !prev.otherUser) return prev;
  return {
    ...prev,
    otherUser: {
      ...prev.otherUser, // 1. Keep the existing name, avatar, and ID
      is_online: payload.new.is_online, // 2. Update status
      last_seen: payload.new.last_seen, // 3. Update time
    },
  };
});
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

  function scrollToBottom() { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }

  function getThemeGradient() {
    if (!chatInfo) return 'from-[#FF69B4] to-[#FFC0CB]';
    switch (chatInfo.theme) {
      case 'love': return 'from-[#FF69B4] to-[#FFC0CB]';
      case 'best_friend': return 'from-purple-500 to-pink-500';
      case 'friend': return 'from-blue-500 to-cyan-500';
      default: return 'from-[#FF69B4] to-[#FFC0CB]';
    }
  }

  function formatLastSeen(lastSeen: string) {
    const date = new Date(lastSeen);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / (1000 * 60));
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  if (loading || !chatInfo) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-pink-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
<div className={`flex-1 flex flex-col ${
  theme === 'dark'
    ? 'bg-gray-900 text-white'
    : theme === 'romantic'
    ? 'bg-[#FFE4E1] text-[#4B004B]'
    : 'bg-white text-gray-900'
}`}>      <div className={`px-6 py-4 border-b ${theme === 'romantic' ? 'border-[#FFB6C1]' : 'border-gray-200'} bg-gradient-to-r ${getThemeGradient()}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {chatInfo.type === 'direct' && chatInfo.otherUser ? (
              <>
                <div className="relative">
                  {chatInfo.otherUser.avatar_url ? (
                    <img
                      src={chatInfo.otherUser.avatar_url}
                      alt={chatInfo.otherUser.display_name}
                      className="w-12 h-12 rounded-full object-cover border-2 border-white"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white font-medium border-2 border-white">
                      {chatInfo.otherUser.display_name[0]}
                    </div>
                  )}
                  {chatInfo.otherUser.is_online && (
                    <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full" />
                  )}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    {chatInfo.otherUser.display_name}
                  </h2>
                  <p className="text-sm text-white/80">
                    {chatInfo.otherUser.is_online
                      ? 'Online'
                      : `Last seen ${formatLastSeen(chatInfo.otherUser.last_seen)}`
                    }
                  </p>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center text-white border-2 border-white">
                  👥
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white">
                    {chatInfo.name}
                  </h2>
                  <p className="text-sm text-white/80">Group chat</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button className="p-2 hover:bg-white/20 backdrop-blur-sm rounded-full transition-colors">
              <Phone className="w-5 h-5 text-white" />
            </button>
            <button className="p-2 hover:bg-white/20 backdrop-blur-sm rounded-full transition-colors">
              <Video className="w-5 h-5 text-white" />
            </button>
            <ChatMenu chatId={chatInfo.id} onClose={() => {}} theme={theme}/>
          </div>
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto p-6 space-y-4 transition-colors duration-300 ${
        theme === 'dark' ? 'bg-gray-900' : theme === 'romantic' ? 'bg-[#FFE4E1]/50' : 'bg-gray-50'
         }`}>
        {messages.map((message, index) => {
          const showAvatar = index === 0 || messages[index - 1].sender_id !== message.sender_id;
          const isOwn = message.sender_id === user?.id;
          const isFailed = failedMessages.has(message.id);
          const isSending = sendingMessages.has(message.id);

          return (
            <div key={message.id} className="group">
              <Message
                message={message}
                isOwn={isOwn}
                showAvatar={showAvatar}
                reactions={reactions}
                theme={theme}
                onDelete={() => handleDeleteMessage(message.id)}
              />
              {isOwn && (
                <div className="flex flex-col items-end gap-1 mt-1 px-4">
                  {isSending && (
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                      <span>Sending...</span>
                    </div>
                  )}
                  
                  {isFailed && (
                    <button
                      onClick={() => handleRetryMessage(message.id)}
                      className="flex items-center gap-1 text-xs text-red-600 hover:text-red-700"
                    >
                      <AlertCircle className="w-3 h-3" />
                      <span>Failed - Tap to retry</span>
                    </button>
                  )}

                  {!isSending && !isFailed && (
                    <div className={`flex items-center gap-1 text-xs transition-colors ${
                      theme === 'romantic' ? 'text-[#8B004B]' : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {message.delivery_status === 'read' ? (
                        <div className="flex items-center">
                          <Check className={`w-3 h-3 ${theme === 'romantic' ? 'text-[#FF1493]' : 'text-blue-500'}`} />
                          <Check className={`w-3 h-3 -ml-1.5 ${theme === 'romantic' ? 'text-[#FF1493]' : 'text-blue-500'}`} />
                        </div>
                      ) : (
                        message.delivery_status === 'sent' && <Check className="w-3 h-3" />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Typing Indicator Placement */}
{isOtherTyping && (
  <div className={`flex items-center gap-2 p-2 ml-4 mb-2 animate-fade-in ${
    theme === 'romantic' ? 'text-[#8B004B]' : 'text-gray-500 dark:text-gray-400'
  }`}>
    <div className="flex gap-1">
      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
    <span className="text-xs italic font-medium">
      {chatInfo.otherUser?.display_name} is typing...
    </span>
  </div>
)}

<div ref={messagesEndRef} />
      </div>

      <div className={`p-4 border-t transition-colors duration-300 ${
        theme === 'dark' ? 'bg-gray-800 border-gray-700' : theme === 'romantic' ? 'bg-[#FFF0F5] border-[#FFB6C1]' : 'bg-white border-gray-200'
          }`}>
        <form onSubmit={handleSendMessage} className="flex items-end gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
            >
              <Paperclip className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </button>
            <button
              type="button"
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
            >
              <ImageIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowEmojiPanel(!showEmojiPanel)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
              >
                <Smile className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              {showEmojiPanel && (
  <>
    <div
      className="fixed inset-0 z-10"
      onClick={() => setShowEmojiPanel(false)}
    />
    <div
      className="fixed inset-0 z-10"
      onClick={() => setShowEmojiPanel(false)}
    />
    <div className={`absolute bottom-full left-0 mb-2 p-3 rounded-xl shadow-lg border grid grid-cols-6 gap-2 z-20 w-64 transition-colors duration-300 ${
  theme === 'romantic' 
    ? 'bg-[#FFE4E1] border-[#FFB6C1]' 
    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
}`}>
      {/* Close button using X */}
      <button
        type="button"
        onClick={() => setShowEmojiPanel(false)}
        className="absolute top-1 right-1 p-1"
      >
        <X className="w-4 h-4" />
      </button>

      {/* Emoji grid */}
      {['💖','🥰','😍','💋','❤️', '😍', '😘', '💘', '🌹', '💞', '😂', '😭', '😢', '🔥', '👍', '🎉'].map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => {
            setNewMessage(newMessage + emoji);
            setShowEmojiPanel(false);
          }}
          className="text-2xl hover:scale-125 transition-transform"
        >
          {emoji}
        </button>
      ))}
    </div>
  </>
)}
            </div>
            <button
              type="button"
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
            >
              <Mic className="w-5 h-5 text-gray-600" />
            </button>
          </div>

          <div className="flex-1">
            <textarea
              value={newMessage}
              onChange={(e) => {
                setNewMessage(e.target.value);
                handleTyping();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(e);
                }
              }}
              placeholder="Spread love..."
              rows={1}
              className={`w-full px-4 py-2 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-pink-500 resize-none transition-colors ${
  theme === 'romantic' 
    ? 'bg-white border-[#FFB6C1] text-[#4B004B] placeholder:text-[#8B004B]/50 focus:ring-[#FF69B4]' 
    : theme === 'dark'
    ? 'bg-gray-700 border-gray-600 text-white placeholder-gray-400 focus:ring-pink-500'
    : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400 focus:ring-pink-400'
}`}
            />
          </div>

          <button
            type="submit"
            disabled={!newMessage.trim()}
            className={`p-3 rounded-full transition-all ${
              newMessage.trim()
                ? `bg-gradient-to-r ${getThemeGradient()} text-white hover:scale-105`
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );
}
