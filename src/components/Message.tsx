import { useState, useEffect, useRef } from 'react';
import { MoreVertical, Reply, Forward, Copy, Star, Trash2, CreditCard as Edit3, Heart, Play, Pause } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

interface MessageProps {
  message: {
    id: string;
    sender_id: string;
    content: string | null;
    type: string;
    media_url: string | null;
    is_edited: boolean;
    is_deleted: boolean;
    created_at: string;
    profiles: {
      display_name: string;
      avatar_url: string | null;
      username: string;
    };
  };
  isOwn: boolean;
  showAvatar: boolean;
  reactions: string[];
  theme: 'light' | 'dark' | 'romantic';
  onDelete?: () => void;
}

interface Reaction {
  reaction: string;
  user_id: string;
  count: number;
}

export function Message({ message, isOwn, showAvatar, reactions, theme, onDelete }: MessageProps) {
  const { user } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const [menuDirection, setMenuDirection] = useState<'up' | 'down'>('down');
  const [showReactions, setShowReactions] = useState(false);
  const [messageReactions, setMessageReactions] = useState<Reaction[]>([]);
  const [userReactionMap, setUserReactionMap] = useState<Map<string, string>>(new Map());
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    loadReactions();
    subscribeToReactions();
  }, [message.id]);

  async function loadReactions() {
    try {
      const { data } = await supabase.from('message_reactions').select('*').eq('message_id', message.id);

      if (data) {
        const reactionMap = new Map<string, { reaction: string; user_id: string; count: number }>();
        const userMap = new Map<string, string>();

        data.forEach((r) => {
          userMap.set(r.reaction, r.user_id);
          const existing = reactionMap.get(r.reaction);
          if (existing) {
            existing.count++;
          } else {
            reactionMap.set(r.reaction, {
              reaction: r.reaction,
              user_id: r.user_id,
              count: 1,
            });
          }
        });

        setUserReactionMap(userMap);
        setMessageReactions(Array.from(reactionMap.values()));
      }
    } catch (error) {
      console.error('Error loading reactions:', error);
    }
  }

  function subscribeToReactions() {
    const channel = supabase
      .channel(`reactions:${message.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_reactions',
          filter: `message_id=eq.${message.id}`,
        },
        () => {
          loadReactions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  async function handleReaction(emoji: string) {
    if (!user) return;

    try {
      const existingReaction = await supabase
        .from('message_reactions')
        .select('*')
        .eq('message_id', message.id)
        .eq('user_id', user.id)
        .eq('reaction', emoji)
        .maybeSingle();

      if (existingReaction.data) {
        await supabase
          .from('message_reactions')
          .delete()
          .eq('message_id', message.id)
          .eq('user_id', user.id)
          .eq('reaction', emoji);
      } else {
        await supabase
          .from('message_reactions')
          .insert({
            message_id: message.id,
            user_id: user.id,
            reaction: emoji,
          });
      }

      setShowReactions(false);
    } catch (error) {
      console.error('Error handling reaction:', error);
    }
  }

  async function handleDelete() {
    try {
      // 1. Tell the database the message is deleted
      await supabase
        .from('messages')
        .update({ is_deleted: true, content: null })
        .eq('id', message.id);
      
      // 2. Call the prop we passed in to update the UI immediately
      if (onDelete) {
        onDelete();
      }

      setShowMenu(false);
    } catch (error) {
      console.error('Error deleting message:', error);
    }
  }

  function formatTime(timestamp: string) {
    const date = new Date(timestamp);
    const hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const formattedHours = hours % 12 || 12;
    const formattedMinutes = minutes.toString().padStart(2, '0');
    return `${formattedHours}:${formattedMinutes} ${ampm}`;
  }
async function handleCopy() {
    if (message.content) {
      try {
        await navigator.clipboard.writeText(message.content);
        setShowMenu(false);
      } catch (err) {
        console.error('Failed to copy: ', err);
      }
    }
  }

  // Helper to format audio seconds (e.g., 65 -> 1:05)
  const formatAudioTime = (seconds: number) => {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Function to get proper message bubble classes based on theme and sender
  const getMessageClasses = (own: boolean) => {
    if (theme === 'romantic') {
      return own
        ? 'bg-[#FF69B4] text-white'
        : 'bg-[#FFC0CB] text-[#4B004B]';
    } else if (theme === 'dark') {
      return own
        ? 'bg-pink-600 text-white'
        : 'bg-gray-800 text-white';
    } else {
      // light
      return own
        ? 'bg-pink-500 text-white'
        : 'bg-gray-100 text-gray-900';
    }
  };

  // Deleted message view
  if (message.is_deleted) {
    return (
      <div className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
        <div className={`flex-shrink-0 ${showAvatar ? 'visible' : 'invisible'}`}>
          {!isOwn && (
            message.profiles.avatar_url ? (
              <img
                src={message.profiles.avatar_url}
                alt={message.profiles.display_name}
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white text-sm font-medium">
                {message.profiles.display_name[0]}
              </div>
            )
          )}
        </div>
        <div className="text-sm text-gray-400 dark:text-gray-500 italic">This message was deleted</div>
      </div>
    );
  }

  return (
    <div className={`flex gap-2 group ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`flex-shrink-0 ${showAvatar ? 'visible' : 'invisible'}`}>
        {!isOwn && (
          message.profiles.avatar_url ? (
            <img
              src={message.profiles.avatar_url}
              alt={message.profiles.display_name}
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white text-sm font-medium">
              {message.profiles.display_name[0]}
            </div>
          )
        )}
      </div>

      <div className={`flex flex-col gap-1 max-w-md ${isOwn ? 'items-end' : 'items-start'}`}>
        {showAvatar && !isOwn && (
          <span className="text-xs px-2 text-gray-600 dark:text-gray-400 romantic-theme:text-pink-600">{message.profiles.display_name}</span>
        )}

        <div className={`relative max-w-[85%] sm:max-w-md ${isOwn ? 'items-end' : 'items-start'}`}>
  <div className={`px-4 py-2 rounded-2xl shadow-sm break-words overflow-hidden ${getMessageClasses(isOwn)}`}>
  {message.type === 'image' && message.media_url ? (
    <div className="space-y-2">
      <img
        src={message.media_url}
        alt="Shared image"
        className="max-w-full rounded-lg max-h-64"
      />
      {message.content && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
    </div>
  ) : message.type === 'voice' && message.media_url ? (
  /* --- SMART RESPONSIVE VOICE PLAYER --- */
  <div className="flex flex-col gap-1 w-[65vw] min-w-[140px] max-w-[280px] py-1">
    <div className="flex items-center gap-2 md:gap-3 w-full">
      {/* Play Button - Scales slightly based on screen */}
      <button 
        type="button"
        onClick={() => {
          if (isPlaying) { audioRef.current?.pause(); } 
          else { audioRef.current?.play(); }
          setIsPlaying(!isPlaying);
        }}
        className={`w-9 h-9 md:w-10 md:h-10 rounded-full flex-shrink-0 flex items-center justify-center transition-all active:scale-95 shadow-sm ${
          isOwn ? 'bg-white/20 hover:bg-white/30' : 'bg-white hover:bg-pink-50'
        }`}
      >
        {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} className="ml-0.5" fill="currentColor" />}
      </button>

      {/* Waveform - The 'flex-1' makes this the "stretchy" part */}
      <div className="flex items-center gap-[1px] xs:gap-[2px] sm:gap-[3px] h-8 flex-1 justify-between px-1">
        {[0.4, 0.7, 0.5, 0.9, 0.6, 0.8, 0.4, 0.9, 0.5, 0.7, 0.4, 0.8].map((height, i, arr) => {
          const progress = (currentTime / duration) * 100;
          const barPercent = (i / arr.length) * 100;
          const isFilled = progress >= barPercent;

          return (
  <div 
    key={i} 
    className={`w-[1.5px] sm:w-[3px] rounded-full transition-all duration-300 
      ${i > 5 ? 'hidden sm:block' : 'block'} 
      ${isFilled 
          ? (isOwn ? 'bg-white scale-y-110' : 'bg-[#FF1493] scale-y-110') 
          : (isOwn ? 'bg-white/40' : 'bg-[#8B004B]/20') 
      } ${isPlaying && isFilled ? 'animate-pulse' : ''}`}
    style={{ height: `${height * 100}%`, animationDelay: `${i * 0.05}s` }} 
  />
);
        })}
      </div>

      {/* Timer - Right-aligned and stays put */}
      <div className={`text-[10px] sm:text-xs font-mono font-bold flex-shrink-0 min-w-[32px] text-right ${
        isPlaying 
          ? (isOwn ? 'text-white' : 'text-[#FF1493]') 
          : (isOwn ? 'text-white/80' : 'text-[#8B004B]/60')
      }`}>
        {formatAudioTime(isPlaying ? currentTime : (duration > 0 ? duration : 0))}
      </div>

      <audio 
        ref={audioRef}
        src={message.media_url} 
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onEnded={() => { setIsPlaying(false); setCurrentTime(0); }}
        className="hidden"
      />
    </div>
  </div>
) : (
    <p className="whitespace-pre-wrap break-words">{message.content}</p>
  )}
</div>

          {messageReactions.length > 0 && (
            <div className={`absolute -bottom-2 flex gap-1 flex-wrap ${isOwn ? 'right-2' : 'left-2'}`}>
              {messageReactions.map((r) => (
                <button
                  key={r.reaction}
                  onClick={() => handleReaction(r.reaction)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-all ${
                    userReactionMap.get(r.reaction) === user?.id
                      ? (theme === 'romantic' ? 'bg-[#FF69B4] text-white border-[#FF1493]' : 'bg-pink-100 dark:bg-pink-900/30 border border-pink-300 dark:border-pink-700')
                      : (theme === 'romantic' ? 'bg-[#FFF0F5] border-[#FFB6C1] text-[#8B004B]' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700')
                  }`}
                >
                  <span>{r.reaction}</span>
                  {r.count > 1 && <span className="text-gray-600 dark:text-gray-400">{r.count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`flex items-center gap-2 px-2 text-xs text-gray-500 dark:text-gray-400 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
          <span>
            {formatTime(message.created_at)}
            {message.is_edited && ' (edited)'}
          </span>

          <div className="relative opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
            <button
              onClick={() => setShowReactions(!showReactions)}
              className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
            >
              <Heart className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>

            {showReactions && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowReactions(false)} />
                <div
                  className={`absolute -bottom-12 p-2 rounded-xl shadow-lg border flex gap-2 z-20 transition-colors duration-300 ${
                    theme === 'romantic' ? 'bg-[#FFF0F5] border-[#FFB6C1]' : theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                  } ${isOwn ? 'right-0' : 'left-0'}`}
                >
                  {reactions.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => handleReaction(emoji)}
                      className="text-xl hover:scale-125 transition-transform"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="relative">
              <button
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const windowHeight = window.innerHeight;
                  // If less than 250px space below, flip it UP
                  if (windowHeight - rect.bottom < 250) {
                    setMenuDirection('up');
                  } else {
                    setMenuDirection('down');
                  }
                  setShowMenu(!showMenu);
                }}
                className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors"
              >
                <MoreVertical className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              </button>

              {showMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                  <div
                    className={`absolute w-48 rounded-lg shadow-lg border py-1 z-20 transition-all duration-300 ${
                      theme === 'romantic' ? 'bg-[#FFF0F5] border-[#FFB6C1]' : theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                    } ${isOwn ? 'right-0' : 'left-0'} ${
                      menuDirection === 'up' ? 'bottom-full mb-1 origin-bottom' : 'top-full mt-1 origin-top'
                    }`}
                  >
                    {/* Reusable Style for your buttons */}
                    {[
  { label: 'Reply', icon: <Reply className="w-4 h-4" />, action: () => {} },
  { label: 'Forward', icon: <Forward className="w-4 h-4" />, action: () => {} },
  { label: 'Copy', icon: <Copy className="w-4 h-4" />, action: handleCopy },
  { label: 'Star', icon: <Star className="w-4 h-4" />, action: () => {} }
].map((item) => (
  <button
    key={item.label}
    onClick={() => { item.action(); setShowMenu(false); }}
    className={`w-full px-4 py-2 text-left flex items-center gap-2 text-sm border border-transparent transition-all ${
      theme === 'romantic' 
        ? 'hover:bg-[#FFC0CB]/30 text-[#4B004B] hover:border-[#FFB6C1]' 
        : theme === 'dark'
        ? 'hover:bg-gray-700 text-white' // Kept your dark theme perfect
        : 'hover:bg-gray-50 text-black hover:border-gray-400' // Light theme: text is now BLACK
    }`}
  >
    {item.icon}
    <span>{item.label}</span>
  </button>
))}

                    {isOwn && (
  <>
    <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
    <button
      onClick={() => setShowMenu(false)}
      className={`w-full px-4 py-2 text-left flex items-center gap-2 text-sm border border-transparent transition-all ${
        theme === 'romantic' 
          ? 'hover:bg-[#FFC0CB]/30 text-[#4B004B] hover:border-[#FFB6C1]' 
          : theme === 'dark'
          ? 'hover:bg-gray-700 text-white'
          : 'hover:bg-gray-50 text-black hover:border-gray-400' // Light theme: text is now BLACK
      }`}
    >
      <Edit3 className="w-4 h-4" />
      <span>Edit</span>
    </button>
                        <button
      onClick={handleDelete}
      className="w-full px-4 py-2 text-left flex items-center gap-2 text-red-600 text-sm border border-transparent hover:border-red-400 transition-all hover:bg-red-50 dark:hover:bg-red-900/20"
    >
      <Trash2 className="w-4 h-4" />
      <span>Delete</span>
    </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}