import { useState, useEffect } from 'react';
import { FloatingHearts } from './FloatingHearts';
import { ChatList } from './ChatList';
import { ChatWindow } from './ChatWindow';
import { ProfileSidebar } from './ProfileSidebar';
import { FriendList } from './FriendList';
import { CreateChat } from './CreateChat';
import { Settings } from '../pages/Settings';
import { GifItem } from '../App';
import { StrictLock } from './StrictLock';
import { PermissionManager } from '../services/PermissionManager';
import { LockedChatsPanel } from './LockedChatsPanel';
import { localDB } from '../db';
import { supabase } from '../lib/supabase';

interface MobileDashboardProps {
  onOpenGifPanel: () => void;
  myGifs: GifItem[];
  setMyGifs: React.Dispatch<React.SetStateAction<GifItem[]>>;
  theme: 'light' | 'dark' | 'sweet';
  setTheme: React.Dispatch<React.SetStateAction<'light' | 'dark' | 'sweet'>>;
  user: any;
  onSaveFace: (userId: string, descriptor: number[]) => Promise<void>;
  savedDescriptor: number[] | null;
  faceLockEnabled: boolean;
  setFaceLockEnabled: (enabled: boolean) => void;
  isFaceRegistered: boolean;
  profile: any;
}

export function MobileDashboard({ theme, setTheme, onOpenGifPanel, myGifs, setMyGifs, user, onSaveFace, savedDescriptor, isFaceRegistered, profile }: MobileDashboardProps) {
  const [showProfile, setShowProfile] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [showCreateChat, setShowCreateChat] = useState(false);
  const [faceLockEnabled, setFaceLockEnabled] = useState(false);
  const [showLockedPanel, setShowLockedPanel] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);

  // Helper for background colors based on theme
  const bgClass = 
    theme === 'dark' ? 'bg-gray-900 text-white' : 
    theme === 'sweet' ? 'bg-[#FFE4E1] text-[#4B004B]' : 
    'bg-gray-50 text-gray-900';

  useEffect(() => {
    if (user?.id) {
      // If the browser already has permission, this silently registers/syncs the worker to Supabase
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          PermissionManager.setupPushSubscription(user.id);
        }
      });
    }
  }, [user?.id]);

  useEffect(() => {
    async function syncServerChatsToLocalCache() {
      if (!user) return;

      try {
        // =========================================================
        // STEP 1: ALWAYS LOAD LOCAL CACHE FIRST (Works Offline!)
        // =========================================================
        // Pull whatever was previously cached on the device memory instantly
        const cachedChats = await localDB.chats.toArray();
        if (cachedChats && cachedChats.length > 0) {
          // If this file manages a state variable like setChats(), you can update it here:
          // setChats(cachedChats); 
        }

        // =========================================================
        // STEP 2: IF ONLINE, FETCH FRESH DATA FROM SUPABASE
        // =========================================================
        if (navigator.onLine) {
          const { data: serverChats, error } = await supabase
            .from('chats')
            .select(`
              *,
              chat_participants!inner(user_id, is_locked),
              messages(content, created_at, is_deleted)
            `)
            .eq('chat_participants.user_id', user.id)
            .order('updated_at', { ascending: false });

          if (error) throw error;

          if (serverChats) {
            const formattedPayloads = serverChats.map((chat: any) => {
              // Only consider messages that aren't deleted!
              const activeMessages = (chat.messages || []).filter((m: any) => !m.is_deleted);
              const lastMsg = activeMessages[activeMessages.length - 1];
              const participantRecord = chat.chat_participants?.find((p: any) => p.user_id === user.id);

              // Filter out hidden locked vaults conversations
              if (participantRecord?.is_locked) return null;

              return {
                id: chat.id,
                type: chat.type,
                name: chat.name || null,
                theme: chat.theme || 'light',
                last_message_content: lastMsg ? lastMsg.content : "No messages yet... 👋",
                last_message_time: lastMsg ? lastMsg.created_at : chat.updated_at
              };
            }).filter(Boolean);

            // =========================================================
            // STEP 3: UPDATE THE LOCAL CACHE WITH NEW DATA
            // =========================================================
            if (formattedPayloads.length > 0) {
              // Wipe local chats tracking rows before putting fresh ones to prevent stale items
              await localDB.chats.clear();
              await localDB.chats.bulkPut(formattedPayloads as any[]);
              
              // If your component uses a UI state setter like setChats(), refresh it with live updates:
              // setChats(formattedPayloads);
            }
          }
        }
      } catch (err) {
        console.error("Background seed cache failure synchronization:", err);
      }
    }

    syncServerChatsToLocalCache();
  }, [user]);

  return (
    <div className={`h-[100dvh] w-full max-w-full overflow-x-hidden overflow-y-hidden flex flex-col relative ${bgClass}`}>
      {theme === 'sweet' && <FloatingHearts />}
      {(showProfile || showFriends || showSettings || showCreateChat) && (
        <div className="fixed inset-0 z-[100] w-full h-full">
          {showProfile && <ProfileSidebar onClose={() => setShowProfile(false)} theme={theme} user={user}/>}
          {showFriends && (
            <FriendList 
              theme={theme} 
              onClose={() => setShowFriends(false)} 
              onSelectUser={(user) => { setSelectedChatId(user.id); setShowFriends(false); }}
              setActiveChatId={setSelectedChatId} 
            />
          )}
          {showSettings && 
          <Settings onClose={() => 
          setShowSettings(false)} 
          theme={theme} 
          profile={profile}
          setTheme={setTheme}
          onRegisterFace={() => setIsRegistering(true)}
          isFaceRegistered={isFaceRegistered}
          faceLockEnabled={faceLockEnabled}
          setFaceLockEnabled={setFaceLockEnabled}
          user={user}
          savedDescriptor={savedDescriptor}
          />}
          {showCreateChat && (
            <CreateChat
              theme={theme}
              onClose={() => setShowCreateChat(false)}
              onChatCreated={(id) => { setSelectedChatId(id); setShowCreateChat(false); }}
            />
          )}
        </div>
      )}

      {isRegistering && (
  <StrictLock 
    mode="register"
    userId={user?.id}
    onSaveDescriptor={onSaveFace}
    onRegisterSuccess={() => {
      setIsRegistering(false);
      setFaceLockEnabled(true);
    }}
    onUnlock={() => setIsRegistering(false)} 
  />
)}

      {/* 2. LAYER TWO: Chat Window */}
      {selectedChatId ? (
        <div className="flex flex-col h-full w-full animate-in slide-in-from-right duration-300">
          <div className="flex-1 overflow-hidden">
            <ChatWindow chatId={selectedChatId} theme={theme} onBack={() => setSelectedChatId(null)} onOpenGifPanel={onOpenGifPanel} myGifs={myGifs} setMyGifs={setMyGifs} />
          </div>
        </div>
      ) : (
        /* 3. LAYER THREE: Chat List */
        /* CHANGE 4: Added 'flex-1' and 'flex flex-col' to ensure it fills the height */
        <div className="flex-1 flex flex-col h-full w-full overflow-hidden">
          <ChatList
            theme={theme}
            selectedChatId={selectedChatId}
            onSelectChat={setSelectedChatId}
            onShowProfile={() => setShowProfile(true)}
            onShowLockedChats={() => setShowLockedPanel(true)}
            onShowFriends={() => setShowFriends(true)}
            onShowSettings={() => setShowSettings(true)}
            onShowCreateChat={() => setShowCreateChat(true)}
          />
        </div>
      )}
{/* 4. SETTINGS MODAL */}
      {showSettings && (
        <Settings
          user={user}
          theme={theme}
          setTheme={setTheme}
          faceLockEnabled={faceLockEnabled}
          setFaceLockEnabled={setFaceLockEnabled}
          isFaceRegistered={!!profile?.face_descriptor}
          onRegisterFace={() => {}}
          savedDescriptor={profile?.face_descriptor || null}
          onClose={() => setShowSettings(false)}
          profile={profile}
        />
      )}

      {/* 5. LOCKED CHATS SIDEBAR PANEL 🔒 */}
      {showLockedPanel && (
        <LockedChatsPanel
          theme={theme}
          onClose={() => setShowLockedPanel(false)}
          onSelectChat={(chatId) => setSelectedChatId(chatId)}
        />
      )}
    </div>
  );
}