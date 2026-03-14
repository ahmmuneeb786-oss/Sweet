import { useState } from 'react';
import { X, Search, Eye, Lock, Trash2, Bell, BellOff, MoreVertical } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

interface ChatMenuProps {
  theme: 'light' | 'dark' | 'romantic'
  chatId: string;
  onClose: () => void;
}

export function ChatMenu({ theme, chatId, onClose }: ChatMenuProps) {
  const { user } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const [muteStatus, setMuteStatus] = useState<'8h' | '1w' | 'forever' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  async function handleMuteChat(duration: '8h' | '1w' | 'forever' | null) {
    if (!user) return;

    try {
      let muteUntil = null;

      if (duration === '8h') {
        muteUntil = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
      } else if (duration === '1w') {
        muteUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      }

      await supabase
        .from('chat_participants')
        .update({
          is_muted: duration !== null,
          muted_until: muteUntil
        })
        .eq('chat_id', chatId)
        .eq('user_id', user.id);

      setMuteStatus(duration);
    } catch (error) {
      console.error('Error muting chat:', error);
    }
  }

  async function handleClearChat() {
    if (!user || !window.confirm('Clear all messages in this chat? This cannot be undone.')) return;

    try {
      await supabase
        .from('messages')
        .update({ is_deleted: true })
        .eq('chat_id', chatId)
        .eq('sender_id', user.id);
    } catch (error) {
      console.error('Error clearing chat:', error);
    }
  }

  const menuItems = [
    { icon: Search, label: 'Search Messages', action: () => setShowSearch(true) },
    { icon: Eye, label: 'View Profile', action: () => {} },
    { icon: muteStatus ? BellOff : Bell, label: muteStatus ? 'Unmute Chat' : 'Mute Chat', action: () => {} },
    { icon: Lock, label: 'Lock Chat', action: () => {} },
    { icon: Trash2, label: 'Clear Chat', action: handleClearChat, danger: true }
  ];

  return (
    <>
      {/* Menu Trigger */}
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="p-2 hover:bg-white/10 rounded-full transition-colors"
      >
        <MoreVertical className={`w-5 h-5 ${theme === 'romantic' ? 'text-[#8B004B]' : 'text-white'}`} />
      </button>

      {/* Menu Dropdown */}
      {showMenu && (
        <>
          {/* Overlay to close menu */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => { setShowMenu(false); onClose(); }} // <-- call onClose here
          />
          <div className={`absolute top-full right-0 mt-2 w-56 rounded-xl shadow-lg py-2 z-20 border transition-colors ${
  theme === 'romantic' 
    ? 'bg-[#FFE4E1] border-[#FFB6C1]' 
    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
}`}>
            {menuItems.map((item, idx) => {
              const Icon = item.icon;
              return (
                <button
                  key={idx}
                  onClick={() => {
                    item.action();
                    setShowMenu(false);
                    onClose(); // <-- also close via prop
                  }}
                  className={`w-full px-4 py-2 text-left flex items-center gap-3 transition-colors ${
  theme === 'romantic' ? 'hover:bg-[#FFC0CB]/30' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
} ${
  item.danger 
    ? 'text-red-600' 
    : theme === 'romantic' ? 'text-[#4B004B]' : 'text-gray-700 dark:text-gray-200'
}`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-sm font-medium">{item.label}</span>
                </button>
              );
            })}

            {muteStatus && (
              <>
                <div className="border-t border-gray-200 my-2" />
                <button
                  onClick={() => { handleMuteChat(null); setShowMenu(false); onClose(); }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-3 text-gray-700"
                >
                  <Bell className="w-4 h-4" />
                  <span className="text-sm font-medium">Unmute Chat</span>
                </button>
              </>
            )}

            {!muteStatus && (
              <>
                <div className="border-t border-gray-200 my-2" />
                <div className="px-4 py-2">
                  <p className={`text-xs font-medium mb-2 ${theme === 'romantic' ? 'text-[#8B004B]' : 'text-gray-700 dark:text-gray-400'}`}>Mute until...</p>
                  <div className="space-y-1">
                    {[
                      { label: '8 hours', value: '8h' },
                      { label: '1 week', value: '1w' },
                      { label: 'Forever', value: 'forever' }
                    ].map((option) => (
                      <button
  key={option.value}
  onClick={() => { handleMuteChat(option.value as any); setShowMenu(false); onClose(); }}
  className={`w-full px-3 py-1 text-left text-xs rounded transition-colors ${
    theme === 'romantic' 
      ? 'text-[#8B004B] hover:bg-[#FFB6C1]/40' 
      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
  }`}
>
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Search Messages Modal */}
      {showSearch && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            onClick={() => { setShowSearch(false); onClose(); }} // <-- use onClose
          />
          <div className={`fixed inset-x-0 top-20 max-w-md mx-auto rounded-xl shadow-xl p-4 z-50 border transition-all ${
  theme === 'romantic' ? 'bg-[#FFF0F5] border-[#FFB6C1]' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Search Messages</h3>
              <button
                onClick={() => { setShowSearch(false); onClose(); }} // <-- use onClose
                className="p-1 hover:bg-gray-100 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in conversation..."
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 transition-colors ${
    theme === 'romantic' 
      ? 'bg-white border-[#FFB6C1] text-[#4B004B] placeholder:text-[#8B004B]/50' 
      : 'bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white'
  }`}
/>
          </div>
        </>
      )}
    </>
  );
}