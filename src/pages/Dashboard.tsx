import { FloatingHearts } from '../components/FloatingHearts';
import { useState } from 'react';
import { ChatList } from '../components/ChatList';
import { ChatWindow } from '../components/ChatWindow';
import { ProfileSidebar } from '../components/ProfileSidebar';
import { FriendList } from '../components/FriendList';
import { CreateChat } from '../components/CreateChat';
import { Settings } from '../pages/Settings';

interface DashboardProps {
  theme: 'light' | 'dark' | 'romantic';
  setTheme: React.Dispatch<React.SetStateAction<'light' | 'dark' | 'romantic'>>;
}

export function Dashboard({ theme, setTheme }: DashboardProps) {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateChat, setShowCreateChat] = useState(false);

  return (
    <div
      className={`h-screen flex overflow-hidden relative ${
        theme === 'dark'
          ? 'bg-gray-900'
          : theme === 'romantic'
          ? 'bg-[#FFE4E1] text-[#4B004B]'
          : 'bg-gray-50'
      }`}
    >
      {theme === 'romantic' && <FloatingHearts />}

      {/* Theme toggle button - Kept as is */}
      <button
        onClick={() => {
          if (theme === 'light') setTheme('dark');
          else if (theme === 'dark') setTheme('romantic');
          else setTheme('light');
        }}
        className="absolute top-4 right-4 px-4 py-2 bg-pink-500 text-white rounded-lg z-50 shadow-lg md:block"
      >
        Theme
      </button>

      {/* 1. CHAT LIST CONTAINER */}
      {/* Hidden on mobile if a chat is open, always flex on desktop (md:flex) */}
      <div className={`
        ${selectedChatId ? 'hidden' : 'flex'} 
        md:flex w-full md:w-80 lg:w-96 flex-col border-r border-gray-200 dark:border-gray-800
      `}>
        <ChatList
          theme={theme}
          selectedChatId={selectedChatId}
          onSelectChat={(id) => setSelectedChatId(id)}
          onShowProfile={() => { setShowProfile(true); setShowFriends(false); setShowSettings(false); }}
          onShowFriends={() => { setShowFriends(true); setShowProfile(false); setShowSettings(false); }}
          onShowSettings={() => { setShowSettings(true); setShowProfile(false); setShowFriends(false); setShowCreateChat(false); }}
          onShowCreateChat={() => { setShowCreateChat(true); setShowProfile(false); setShowFriends(false); setShowSettings(false); }}
        />
      </div>

      {/* 2. MAIN CHAT WINDOW CONTAINER */}
      {/* Hidden on mobile if NO chat is open, always flex on desktop (md:flex) */}
      <div className={`
        ${selectedChatId ? 'flex' : 'hidden'} 
        md:flex flex-1 flex-col h-full
      `}>
        {selectedChatId ? (
          <ChatWindow 
            chatId={selectedChatId} 
            theme={theme} 
            onBack={() => setSelectedChatId(null)} // This is the magic "Go Back" line
          />
        ) : (
          /* Desktop Placeholder - Only shows when no chat is selected on a large screen */
          <div className={`flex-1 flex items-center justify-center ${
              theme === 'dark' ? 'bg-gray-800' : theme === 'romantic' ? 'bg-[#FFE4E1]' : 'bg-white'
            }`}>
            <div className="text-center space-y-4">
              <div className="w-24 h-24 mx-auto bg-gradient-to-br from-pink-100 to-purple-100 rounded-full flex items-center justify-center">
                <span className="text-4xl">💬</span>
              </div>
              <div>
                <h2 className={`text-2xl font-bold mb-2 ${
                    theme === 'dark' ? 'text-white' : theme === 'romantic' ? 'text-[#4B004B]' : 'text-gray-800'
                  }`}>
                  Welcome to Sweet
                </h2>
                <p className={theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}>
                  Select a chat to start messaging
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sidebars & Modals (These usually float over the top, so they work fine) */}
      {showProfile && <ProfileSidebar onClose={() => setShowProfile(false)} theme={theme} />}
      {showFriends && (
      <FriendList 
       theme={theme} 
       onClose={() => setShowFriends(false)} 
       setActiveChatId={setSelectedChatId} 
       onSelectUser={() => {}} // Add this empty function to satisfy the requirement
     />
      )}
      {showSettings && <Settings onClose={() => setShowSettings(false)} theme={theme} setTheme={setTheme} />}
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
    </div>
  );
}