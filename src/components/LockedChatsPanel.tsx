import { useState, useEffect } from 'react';
import { ArrowLeft, Lock, MessageSquare } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { localDB } from '../db';

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
  const [lockedChats, setLockedChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadLockedChats();
    }
  }, [user]);

  async function loadLockedChats() {
    if (!user) return;
    
    try {
      setLoading(true);

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
        .filter((c: any) => c.is_locked === true || c.theme === 'locked-vault') 
        .map((chat: any) => ({
          id: chat.id,
          type: chat.type,
          name: chat.name || 'Private Chat',
          avatar_url: chat.avatar_url || null,
          theme: chat.theme,
          otherUser: chat.otherUser || undefined
        }));

      if (cachedLockedChats.length > 0) {
        setLockedChats(cachedLockedChats);
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
          .eq('is_locked', true);

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
            if (chatData.type === 'direct') {
              const { data: otherPart } = await supabase
                .from('chat_participants')
                .select('user_id')
                .eq('chat_id', chatData.id)
                .neq('user_id', user.id)
                .maybeSingle();

              if (otherPart?.user_id) {
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

            // Cache the locked conversation structure locally.
            // We append an 'is_locked: true' property so our offline fallback can identify it later, 
            // while your main ChatList filter ignores it to prevent it from leaking onto the public feed!
            await localDB.chats.put({
              id: structuredChat.id,
              type: structuredChat.type,
              name: structuredChat.name || (structuredChat.otherUser?.display_name ?? 'Private Chat'),
              avatar_url: structuredChat.avatar_url || (structuredChat.otherUser?.avatar_url ?? null),
              theme: structuredChat.theme || 'sweet',
              last_message_content: "Encrypted Vault Message 🔒",
              last_message_time: new Date().toISOString(),
              is_locked: true, // 🌟 Flag saved locally to separate this room from public chats
              otherUser: structuredChat.otherUser as any
            } as any);
          }

          setLockedChats(formattedChats);
        }
      }
    } catch (err) {
      console.error('Failed to sync or load secure locked vault panel:', err);
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
      <div className={`fixed top-0 left-0 bottom-0 z-50 w-full max-w-sm h-full flex flex-col shadow-2xl border-r animate-in slide-in-from-left duration-300 ${
        theme === 'sweet' ? 'bg-[#FFF0F5] border-[#FFB6C1]' : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800'
      }`}>
        {/* Header */}
        <div className={`p-4 border-b flex items-center gap-3 ${
          theme === 'sweet' ? 'border-[#FFB6C1]' : 'border-gray-200 dark:border-gray-800'
        }`}>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
            <ArrowLeft className={`w-5 h-5 ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-700 dark:text-gray-300'}`} />
          </button>
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-pink-500" />
            <h2 className={`font-bold text-lg ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>
              Locked Conversations
            </h2>
          </div>
        </div>

        {/* List Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-6 h-6 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : lockedChats.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-6 text-gray-400">
              <Lock className="w-12 h-12 mb-2 stroke-[1.5]" />
              <p className="font-medium text-sm">Your vault is empty</p>
              <p className="text-xs max-w-[200px] mt-1">Use the chat options menu to add private threads here.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {lockedChats.map((chat) => (
                <button
                  key={chat.id}
                  onClick={() => {
                    onSelectChat(chat.id);
                    onClose();
                  }}
                  className={`w-full p-4 flex items-center gap-3 text-left transition-colors ${
                    theme === 'sweet' ? 'hover:bg-[#FFC0CB]/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-pink-100 dark:bg-pink-900/30 flex items-center justify-center text-pink-600 shrink-0">
                    <MessageSquare className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold text-sm truncate ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>
                      {chat.type === 'direct' ? chat.otherUser?.display_name : chat.name}
                    </p>
                    <p className="text-xs text-gray-400">Protected Conversation</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}