import { useState } from 'react';
import { FloatingHearts } from './FloatingHearts';
import { ChatList } from './ChatList';
import { ChatWindow } from './ChatWindow';
import { ProfileSidebar } from './ProfileSidebar';
import { FriendList } from './FriendList';
import { CreateChat } from './CreateChat';
import { Settings } from '../pages/Settings';

interface MobileDashboardProps {
  theme: 'light' | 'dark' | 'romantic';
  setTheme: React.Dispatch<React.SetStateAction<'light' | 'dark' | 'romantic'>>;
}

export function MobileDashboard({ theme, setTheme }: MobileDashboardProps) {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateChat, setShowCreateChat] = useState(false);

  // Helper for background colors based on theme
  const bgClass = 
    theme === 'dark' ? 'bg-gray-900 text-white' : 
    theme === 'romantic' ? 'bg-[#FFE4E1] text-[#4B004B]' : 
    'bg-gray-50 text-gray-900';

  return (
    /* CHANGE 1: Added 'max-w-full' and 'overflow-x-hidden' to stop the right-side cut-off.
       CHANGE 2: Used 'h-[100dvh]' (Dynamic Viewport Height) so it fits perfectly 
       even when the mobile browser address bar pops up.
    */
    <div className={`h-[100dvh] w-full max-w-full overflow-x-hidden overflow-y-hidden flex flex-col relative ${bgClass}`}>
      {theme === 'romantic' && <FloatingHearts />}

      {/* 1. LAYER ONE: Sidebars */}
      {/* CHANGE 3: Added 'fixed inset-0' wrapper to ensure sidebars 
         don't push the main content to the side when they open.
      */}
      {(showProfile || showFriends || showSettings || showCreateChat) && (
        <div className="fixed inset-0 z-[100] w-full h-full">
          {showProfile && <ProfileSidebar onClose={() => setShowProfile(false)} theme={theme} />}
          {showFriends && (
            <FriendList 
              theme={theme} 
              onClose={() => setShowFriends(false)} 
              onSelectUser={(user) => { setSelectedChatId(user.id); setShowFriends(false); }}
              setActiveChatId={setSelectedChatId} 
            />
          )}
          {showSettings && <Settings onClose={() => setShowSettings(false)} theme={theme} setTheme={setTheme} />}
          {showCreateChat && (
            <CreateChat
              theme={theme}
              onClose={() => setShowCreateChat(false)}
              onChatCreated={(id) => { setSelectedChatId(id); setShowCreateChat(false); }}
            />
          )}
        </div>
      )}

      {/* 2. LAYER TWO: Chat Window */}
      {selectedChatId ? (
        <div className="flex flex-col h-full w-full animate-in slide-in-from-right duration-300">
          <div className="flex-1 overflow-hidden">
            <ChatWindow chatId={selectedChatId} theme={theme} onBack={() => setSelectedChatId(null)}/>
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
            onShowFriends={() => setShowFriends(true)}
            onShowSettings={() => setShowSettings(true)}
            onShowCreateChat={() => setShowCreateChat(true)}
          />
        </div>
      )}
    </div>
  );
}