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
    <div className={`h-screen w-full overflow-hidden relative ${bgClass}`}>
      {theme === 'romantic' && <FloatingHearts />}

      {/* 1. LAYER ONE: Sidebars (Settings, Profile, etc.) */}
      {/* On mobile, these should be fixed and cover the whole screen */}
      <div className="z-[100]">
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

      {/* 2. LAYER TWO: Chat Window (Only shows if a chat is selected) */}
      {selectedChatId ? (
        <div className="flex flex-col h-full w-full animate-in slide-in-from-right duration-300">
          {/* Header with Back Button */}
          <div className={`p-4 flex items-center border-b ${theme === 'dark' ? 'border-gray-700' : 'border-pink-200'}`}>
            <button 
              onClick={() => setSelectedChatId(null)}
              className="mr-4 text-2xl"
            >
              ←
            </button>
            <span className="font-bold text-lg">Chatting...</span>
          </div>
          
          <div className="flex-1 overflow-hidden">
            <ChatWindow chatId={selectedChatId} theme={theme} />
          </div>
        </div>
      ) : (
        /* 3. LAYER THREE: Chat List (The default view) */
        <div className="h-full w-full">
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