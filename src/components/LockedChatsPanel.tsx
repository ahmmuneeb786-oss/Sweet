import { useState, useEffect } from 'react';
import { ArrowLeft, Lock, MessageSquare, ShieldAlert } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { localDB } from '../db';
import { StrictLock } from './StrictLock';
import { VaultVerify } from './VaultVerify';
import { useNotify } from '../contexts/NotificationContext';

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
  const { user, profile } = useAuth();
  const { showError } = useNotify();
  const [lockedChats, setLockedChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifyingChatId, setVerifyingChatId] = useState<string | null>(null);
  const [vaultVerify, setVaultVerify] = useState<{ chatId: string; mode: 'pin' | 'password' } | null>(null);
  const [unsupportedNotice, setUnsupportedNotice] = useState(false);

  // These columns exist on the profiles row (select('*') in AuthContext)
  // but aren't declared on its TS type, since they're specific to the
  // locked-chats vault rather than general profile fields.
  const secureProfile = profile as any;

  function handleOpenLockedChat(chatId: string) {
    const securityType = secureProfile?.chat_security_type || 'none';

    if (securityType === 'none') {
      // User explicitly chose no extra protection for the vault — respect that.
      onSelectChat(chatId);
      onClose();
      return;
    }

    if (securityType === 'biometric' && secureProfile?.face_descriptor) {
      // Reuse the same registered face as the app lock — one registration,
      // both places, rather than a second separate enrollment flow.
      setVerifyingChatId(chatId);
      return;
    }

    if (securityType === 'pin' && secureProfile?.chat_pin) {
      setVaultVerify({ chatId, mode: 'pin' });
      return;
    }

    if (securityType === 'password' && secureProfile?.chat_password) {
      setVaultVerify({ chatId, mode: 'password' });
      return;
    }

    // Configured but missing the actual saved secret (edge case, e.g. an
    // interrupted setup) — don't silently let them in or silently fail.
    setUnsupportedNotice(true);
  }

  useEffect(() => {
    if (user) {
      loadLockedChats();
    }
  }, [user]);

  async function loadLockedChats() {
    if (!user) return;

    let hadCache = false;

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
          otherUser: chat.other_user_id ? {
            display_name: chat.other_user_name || '',
            avatar_url: chat.other_user_avatar || null,
          } : undefined
        }));

      if (cachedLockedChats.length > 0) {
        hadCache = true;
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
            let otherUserId: string | undefined;
            if (chatData.type === 'direct') {
              const { data: otherPart } = await supabase
                .from('chat_participants')
                .select('user_id')
                .eq('chat_id', chatData.id)
                .neq('user_id', user.id)
                .maybeSingle();

              if (otherPart?.user_id) {
                otherUserId = otherPart.user_id;
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
              other_user_id: otherUserId,
              other_user_name: structuredChat.otherUser?.display_name,
              other_user_avatar: structuredChat.otherUser?.avatar_url,
            } as any);
          }

          setLockedChats(formattedChats);
        }
      }
    } catch (err) {
      console.error('Failed to sync or load secure locked vault panel:', err);
      // Without this, a genuine fetch failure with no cache looked
      // identical to "your vault is empty" — actively misleading.
      if (!hadCache) {
        showError("Couldn't load your locked chats. Check your connection.");
      }
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
                  onClick={() => handleOpenLockedChat(chat.id)}
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

      {/* Verification gate — chat only opens after onUnlock fires */}
      {verifyingChatId && user && (
        <StrictLock
          mode="verify"
          userId={user.id}
          savedDescriptor={secureProfile?.face_descriptor}
          onSaveDescriptor={async () => {}} // not used in verify mode
          onUnlock={() => {
            const chatId = verifyingChatId;
            setVerifyingChatId(null);
            onSelectChat(chatId);
            onClose();
          }}
          onCancel={() => setVerifyingChatId(null)}
        />
      )}

      {vaultVerify && user && (
        <VaultVerify
          mode={vaultVerify.mode}
          userId={user.id}
          expectedHash={vaultVerify.mode === 'pin' ? secureProfile?.chat_pin : secureProfile?.chat_password}
          onUnlock={() => {
            const chatId = vaultVerify.chatId;
            setVaultVerify(null);
            onSelectChat(chatId);
            onClose();
          }}
          onCancel={() => setVaultVerify(null)}
        />
      )}

      {/* PIN/password verification doesn't exist yet anywhere in the app —
          told honestly rather than silently bypassing or doing nothing. */}
      {unsupportedNotice && (
        <div className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center p-6" onClick={() => setUnsupportedNotice(false)}>
          <div
            className={`max-w-sm w-full rounded-2xl p-6 text-center space-y-3 ${
              theme === 'sweet' ? 'bg-[#FFF0F5]' : 'bg-white dark:bg-gray-900'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <ShieldAlert className="w-10 h-10 text-pink-500 mx-auto" />
            <h3 className={`font-bold ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>
              Security setup looks incomplete
            </h3>
            <p className="text-sm text-gray-500">
              This chat is set to require a security method, but the actual PIN/password/face wasn't saved properly. Go to Settings and set it up again.
            </p>
            <button
              onClick={() => setUnsupportedNotice(false)}
              className="mt-2 px-5 py-2 rounded-xl bg-pink-500 text-white text-sm font-bold hover:bg-pink-600 transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}