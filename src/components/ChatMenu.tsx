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
      {/* 1. MENU TRIGGER BUTTON */}
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="p-2 hover:bg-white/10 rounded-full transition-colors active:scale-90"
      >
        <MoreVertical className={`w-5 h-5 ${theme === 'romantic' ? 'text-[#8B004B]' : 'text-white'}`} />
      </button>

      {/* 2. MENU DROPDOWN / BOTTOM SHEET */}
      {showMenu && (
        <>
          {/* Background Overlay */}
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
            onClick={() => { setShowMenu(false); onClose(); }}
          />
          
          {/* Main Menu Container */}
          <div className={`
            /* Mobile Styles: Slides from bottom */
            fixed bottom-0 left-0 right-0 w-full rounded-t-3xl z-50 px-2 pb-8 pt-4
            /* Desktop Styles: Small dropdown */
            md:absolute md:top-full md:bottom-auto md:left-auto md:right-0 md:w-56 md:rounded-xl md:p-0 md:pb-0 md:pt-0
            shadow-2xl border transition-all animate-in slide-in-from-bottom md:slide-in-from-top-2 duration-300
            ${theme === 'romantic' 
              ? 'bg-[#FFE4E1] border-[#FFB6C1]' 
              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}
          `}>
            
            {/* Mobile Grab Handle (Hidden on Desktop) */}
            <div className="w-12 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mb-4 md:hidden" />

            {/* Loop through Menu Items */}
            {menuItems.map((item, idx) => {
              const Icon = item.icon;
              return (
                <button
                  key={idx}
                  onClick={() => {
                    item.action();
                    setShowMenu(false);
                    onClose();
                  }}
                  className={`w-full px-6 md:px-4 py-4 md:py-2 text-left flex items-center gap-4 md:gap-3 transition-colors active:bg-black/5 ${
                    theme === 'romantic' 
                      ? 'hover:bg-[#FFC0CB]/30 text-[#4B004B]' 
                      : 'hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200'
                  } ${item.danger ? '!text-red-600' : ''}`}
                >
                  <Icon className="w-5 h-5 md:w-4 md:h-4" />
                  <span className="text-base md:text-sm font-medium">{item.label}</span>
                </button>
              );
            })}

            {/* Mute Section */}
            <div className="border-t border-gray-200 dark:border-gray-700 my-2" />
            
            <div className="px-6 md:px-4 py-2">
              <p className={`text-xs font-bold uppercase tracking-wider mb-3 ${
                theme === 'romantic' ? 'text-[#8B004B]' : 'text-gray-400'
              }`}>
                Mute Notifications
              </p>
              
              <div className="flex gap-2 md:flex-col">
                {[
                  { label: '8h', value: '8h' },
                  { label: '1w', value: '1w' },
                  { label: 'Always', value: 'forever' }
                ].map((option) => (
                  <button
                    key={option.value}
                    onClick={() => { handleMuteChat(option.value as any); setShowMenu(false); onClose(); }}
                    className={`flex-1 md:w-full px-3 py-3 md:py-1 text-center md:text-left text-xs font-bold rounded-xl transition-colors ${
                      theme === 'romantic' 
                        ? 'bg-white/50 text-[#8B004B] hover:bg-[#FFB6C1]/40' 
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* 3. SEARCH MESSAGES MODAL */}
      {showSearch && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-20">
          {/* Darker background for search */}
          <div 
            className="fixed inset-0 bg-black/60 backdrop-blur-sm" 
            onClick={() => { setShowSearch(false); onClose(); }} 
          />
          
          <div className={`relative w-full max-w-lg rounded-2xl shadow-2xl p-4 border animate-in zoom-in-95 duration-200 ${
            theme === 'romantic' ? 'bg-[#FFF0F5] border-[#FFB6C1]' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
          }`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={`font-semibold ${theme === 'romantic' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'}`}>
                Search Messages
              </h3>
              <button
                onClick={() => { setShowSearch(false); onClose(); }}
                className="p-1 hover:bg-black/5 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in conversation..."
              autoFocus
              className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 transition-colors ${
                theme === 'romantic' 
                  ? 'bg-white border-[#FFB6C1] text-[#4B004B] placeholder:text-[#8B004B]/50' 
                  : 'bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white'
              }`}
            />
          </div>
        </div>
      )}
    </>
  );
}