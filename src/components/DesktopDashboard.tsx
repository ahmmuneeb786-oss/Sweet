import { FloatingHearts } from '../components/FloatingHearts';
import { useState } from 'react';
import { ChatList } from '../components/ChatList';
import { ChatWindow } from '../components/ChatWindow';
import { ProfileSidebar } from '../components/ProfileSidebar';
import { FriendList } from '../components/FriendList';
import { CreateChat } from '../components/CreateChat';
import { Settings } from '../pages/Settings';
import { GifItem } from '../App';


interface DashboardProps {
  onOpenGifPanel: () => void;
  myGifs: GifItem[];
  setMyGifs: React.Dispatch<React.SetStateAction<GifItem[]>>;
  theme: 'light' | 'dark' | 'sweet';
  setTheme: React.Dispatch<React.SetStateAction<'light' | 'dark' | 'sweet'>>;
}

export function DesktopDashboard({ theme, setTheme, onOpenGifPanel, myGifs, setMyGifs }: DashboardProps) {
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateChat, setShowCreateChat] = useState(false);
  
  const [faceLockEnabled, setFaceLockEnabled] = useState(() => {
  return localStorage.getItem('face_lock_enabled') === 'true';
  });

  return (
    <div
      className={`h-screen w-full flex overflow-hidden relative ${
        theme === 'dark'
          ? 'bg-gray-900'
          : theme === 'sweet'
          ? 'bg-[#FFE4E1] text-[#4B004B]'
          : 'bg-gray-50'
      }`}
    >
      {theme === 'sweet' && <FloatingHearts />}

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
        <ChatWindow chatId={selectedChatId} theme={theme} onOpenGifPanel={onOpenGifPanel} myGifs={myGifs} setMyGifs={setMyGifs} />
      ) : (
        <div
          className={`flex-1 flex items-center justify-center ${
            theme === 'dark'
              ? 'bg-gray-800'
              : theme === 'sweet'
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
                    : theme === 'sweet'
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
                    : theme === 'sweet'
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
          theme={theme} 
        />
      )}
      {showFriends && (
        <FriendList 
          theme={theme} 
          onClose={() => setShowFriends(false)} 
          onSelectUser={(selectedUser) => {
            setSelectedChatId(selectedUser.id); 
            setShowFriends(false);
          }}
          setActiveChatId={setSelectedChatId} 
        />
      )}
      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          theme={theme}
          setTheme={setTheme}
          faceLockEnabled={faceLockEnabled}
          setFaceLockEnabled={setFaceLockEnabled}
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
    </div>
  );
}