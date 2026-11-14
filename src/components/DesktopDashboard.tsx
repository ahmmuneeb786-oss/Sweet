import { FloatingHearts } from '../components/FloatingHearts';
import { useEffect, useState } from 'react';
import { ChatList } from '../components/ChatList';
import { ChatWindow } from '../components/ChatWindow';
import { ProfileSidebar } from '../components/ProfileSidebar';
import { FriendList } from '../components/FriendList';
import { CreateChat } from '../components/CreateChat';
import { Settings } from '../pages/Settings';
import { GifItem } from '../App';
import { StrictLock } from './StrictLock';
import { PermissionManager } from '../services/PermissionManager';
import { LockedChatsPanel } from './LockedChatsPanel';
import { useBackableState } from '../hooks/useBackableState';
import { useAppIsSweet } from '../theme/sweetHearts';


interface DashboardProps {
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

export function DesktopDashboard({ theme, setTheme, onOpenGifPanel, myGifs, setMyGifs, user, onSaveFace, savedDescriptor, isFaceRegistered, profile }: DashboardProps) {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateChat, setShowCreateChat] = useState(false);
  const [showLockedPanel, setShowLockedPanel] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [faceLockEnabled, setFaceLockEnabled] = useState(false);
  const appIsSweet = useAppIsSweet();

  useBackableState(!!selectedChatId, () => setSelectedChatId(null));
  useBackableState(showProfile, () => setShowProfile(false));
  useBackableState(showFriends, () => setShowFriends(false));
  useBackableState(showSettings, () => setShowSettings(false));
  useBackableState(showCreateChat, () => setShowCreateChat(false));
  useBackableState(showLockedPanel, () => setShowLockedPanel(false));

  useEffect(() => {
      // iOS Safari/WKWebView has no window.Notification at all — referencing
      // the bare identifier there throws "Can't find variable: Notification"
      // and crashes the whole tree, so this has to be feature-detected first.
      if (user?.id && 'Notification' in window) {
        // If the browser already has permission, this silently registers/syncs the worker to Supabase
        Notification.requestPermission().then((permission) => {
          if (permission === 'granted') {
            PermissionManager.setupPushSubscription(user.id);
          }
        });
      }
  }, [user?.id]);


  return (
    <div
      className="h-screen w-full flex overflow-hidden relative bg-th-bg text-th-ink"
    >
      {/* Chat list sidebar */}
      <ChatList
        theme={theme}
        selectedChatId={selectedChatId}
        onSelectChat={setSelectedChatId}
        onShowLockedChats={() => setShowLockedPanel(true)}
        onShowProfile={() => {
          setShowProfile(true);
          setShowFriends(false);
          setShowSettings(false);
        }}
        onShowFriends={() => {
          setShowFriends(true);
          setShowProfile(false);
          setShowSettings(false);
        }}
        onShowSettings={() => {
          setShowSettings(true);
          setShowProfile(false);
          setShowFriends(false);
          setShowCreateChat(false);
        }}
        onShowCreateChat={() => {
          setShowCreateChat(true);
          setShowProfile(false);
          setShowFriends(false);
          setShowSettings(false);
        }}
      />

      {/* Main chat window */}
      {selectedChatId ? (
        <ChatWindow chatId={selectedChatId} theme={theme} onOpenGifPanel={onOpenGifPanel} myGifs={myGifs} setMyGifs={setMyGifs} />
      ) : (
        <div
          className="relative flex-1 flex items-center justify-center bg-th-wallpaper text-th-ink"
        >
          {/* Hearts only in this empty pane; an open chat draws its own behind its messages. */}
          {appIsSweet && <FloatingHearts />}
          <div className="relative text-center space-y-4">
            <div className={`w-24 h-24 mx-auto rounded-full flex items-center justify-center bg-gradient-to-br from-th-secondary to-th-card border border-th-border`}>
              <span className="text-4xl">💬</span>
            </div>
            <div>
              <h2
                className="text-2xl font-bold mb-2 text-th-ink"
              >
                Welcome to Sweet
              </h2>
              <p
                className="text-th-ink-soft"
              >
                Select a chat to start messaging
              </p>
            </div>
          </div>
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

      {/* Sidebars */}
      {showProfile && (
        <ProfileSidebar 
          onClose={() => setShowProfile(false)} 
          theme={theme}
          user={user}
        />
      )}
      {showFriends && (
        <FriendList 
          theme={theme} 
          onClose={() => setShowFriends(false)} 
          setActiveChatId={setSelectedChatId}
          initialTab="search"
        />
      )}
      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          theme={theme}
          profile={profile}
          setTheme={setTheme}
          isFaceRegistered={isFaceRegistered}
          onRegisterFace={() => setIsRegistering(true)}
          faceLockEnabled={faceLockEnabled}
          setFaceLockEnabled={setFaceLockEnabled}
          user={user}
          savedDescriptor={savedDescriptor}
        />
      )}
      {showCreateChat && (
        <CreateChat
          theme={theme}
          onClose={() => setShowCreateChat(false)}
          onChatCreated={(chatId) => {
            setSelectedChatId(chatId);
            setShowCreateChat(false);
          }}
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