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
      className={`h-screen flex overflow-hidden relative ${ // Added 'relative' here
        theme === 'dark'
          ? 'bg-gray-900'
          : theme === 'romantic'
          ? 'bg-[#FFE4E1] text-[#4B004B]'
          : 'bg-gray-50'
      }`}
    >
      {/* Add this line right here */}
      {theme === 'romantic' && <FloatingHearts />}

      {/* The rest of your code (ChatList, ChatWindow, etc.) stays inside this div */}
      {/* Theme toggle button */}
      <button
        onClick={() => {
          // Cycle theme: light → dark → romantic → light
          if (theme === 'light') setTheme('dark');
          else if (theme === 'dark') setTheme('romantic');
          else setTheme('light'); // theme === 'romantic'
        }}
        className="absolute top-4 right-4 px-4 py-2 bg-pink-500 text-white rounded-lg z-50"
      >
        Toggle Theme
      </button>

      {/* Chat list sidebar */}
      <ChatList
      theme={theme}
        selectedChatId={selectedChatId}
        onSelectChat={setSelectedChatId}
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
        <ChatWindow chatId={selectedChatId} theme={theme} />
      ) : (
        <div
          className={`flex-1 flex items-center justify-center ${
            theme === 'dark'
              ? 'bg-gray-800'
              : theme === 'romantic'
              ? 'bg-[#FFE4E1] text-[#4B004B]'
              : 'bg-white'
          }`}
        >
          <div className="text-center space-y-4">
            <div className="w-24 h-24 mx-auto bg-gradient-to-br from-pink-100 to-purple-100 rounded-full flex items-center justify-center">
              <span className="text-4xl">💬</span>
            </div>
            <div>
              <h2
                className={`text-2xl font-bold mb-2 ${
                  theme === 'dark'
                    ? 'text-white'
                    : theme === 'romantic'
                    ? 'text-[#4B004B]'
                    : 'text-gray-800'
                }`}
              >
                Welcome to Sweet
              </h2>
              <p
                className={`${
                  theme === 'dark'
                    ? 'text-gray-300'
                    : theme === 'romantic'
                    ? 'text-[#8B004B]'
                    : 'text-gray-600'
                }`}
              >
                Select a chat to start messaging
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Sidebars */}
      {showProfile && (
  <ProfileSidebar 
    onClose={() => setShowProfile(false)} 
    theme={theme} // This passes the active theme into the sidebar!
  />
)}
      {showFriends && (
  <FriendList 
    theme={theme} 
    onClose={() => setShowFriends(false)} 
    onSelectUser={(selectedUser) => {
      // Use 'setSelectedChatId' and pass just the ID string
      setSelectedChatId(selectedUser.id); 
      setShowFriends(false);
    }} 
  />
)}
      {showSettings && <Settings
  onClose={() => setShowSettings(false)}
  theme={theme}        // ← pass current theme
  setTheme={setTheme}  // ← pass setter
/>}
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