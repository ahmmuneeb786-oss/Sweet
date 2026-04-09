import { useState, useEffect, useRef } from 'react';
import { MoreVertical, Reply, Forward, Copy, Star, Trash2, CreditCard as Edit3, Heart, Play } from 'lucide-react';
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
  showDateSeparator: boolean;
  reactions: string[];
  theme: 'light' | 'dark' | 'romantic';
  onDelete?: () => void;
}

interface Reaction {
  reaction: string;
  user_id: string;
  count: number;
}

export function Message({ message, isOwn, showAvatar, reactions, theme, onDelete, showDateSeparator }: MessageProps) {
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
  const [waveform, setWaveform] = useState<number[]>([]);
  const [isZoomed, setIsZoomed] = useState(false);

  useEffect(() => {
  if (message.type === 'voice' && message.media_url) {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    fetch(message.media_url)
      .then(response => response.arrayBuffer())
      .then(data => audioContext.decodeAudioData(data))
      .then(buffer => {
        const rawData = buffer.getChannelData(0); // Get audio peaks
        const samples = 20; // Number of vertical lines
        const blockSize = Math.floor(rawData.length / samples);
        const filteredData = [];
        for (let i = 0; i < samples; i++) {
          let blockStart = blockSize * i;
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum = sum + Math.abs(rawData[blockStart + j]); // Amplitude
          }
          filteredData.push(sum / blockSize); // Average loudness for this section
        }
        // Normalize to 0-1 scale
        const multiplier = Math.pow(Math.max(...filteredData), -1);
        setWaveform(filteredData.map(n => n * multiplier));
      });
  }
}, [message.media_url]);

  useEffect(() => {
    loadReactions();
    subscribeToReactions();
  }, [message.id]);

  function formatStickyDate(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffInDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffInDays === 0) return 'Today';
  if (diffInDays === 1) return 'Yesterday';
  if (diffInDays < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'long' }); // e.g., "Monday"
  }
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

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
  // Deeply rounded "Petal" shape. Only the sender's corner is sharp if it's the last message.
  const shape = "rounded-[32px]";

  if (theme === 'romantic') {
    return own
      ? `${shape} bg-gradient-to-br from-[#FF85A1] via-[#FF69B4] to-[#FF1493] text-white shadow-[0_4px_15px_rgba(255,20,147,0.3)] border border-white/20`
      : `${shape} bg-white/40 backdrop-blur-xl border border-white/40 text-[#8B004B] shadow-[0_4px_10px_rgba(0,0,0,0.05)]`;
    } else if (theme === 'dark') {
      return own ? `${shape} bg-pink-500 text-white` : `${shape} bg-gray-100 text-gray-900`;
    } else {
      // light
      return own ? `${shape} bg-pink-500 text-white` : `${shape} bg-gray-100 text-gray-900`;
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
  <>

   {showDateSeparator && (
      <div className="flex items-center justify-center my-6 w-full">
        <div className="flex items-center gap-3 w-full max-w-[200px]">
          <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-pink-300/50 to-transparent" />
          <span className={`text-[10px] font-black uppercase tracking-[2px] whitespace-nowrap
            ${theme === 'romantic' ? 'text-[#FF1493] bg-white/50 px-3 py-1 rounded-full backdrop-blur-sm shadow-sm' : 'text-gray-400'}
          `}>
            {formatStickyDate(message.created_at)}
          </span>
          <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-pink-300/50 to-transparent" />
        </div>
      </div>
    )}

    {/* Changed to flex-col so avatar is ABOVE the bubble on mobile */}
    <div className={`flex flex-col group ${isOwn ? 'items-end' : 'items-start'} mb-4 px-4`}>
      
      {/* 1. Avatar Row (Only shows for the other person) */}
      {!isOwn && showAvatar && (
        <div className="flex items-center gap-2 mb-1 ml-2">
          {message.profiles.avatar_url ? (
            <img
              src={message.profiles.avatar_url}
              alt={message.profiles.display_name}
              className="w-6 h-6 rounded-full object-cover border border-pink-200"
            />
          ) : (
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white text-[10px] font-bold">
              {message.profiles.display_name[0]}
            </div>
          )}
          <span className="text-[10px] font-bold text-gray-500 romantic-theme:text-pink-600 uppercase tracking-wider">
            {message.profiles.display_name}
          </span>
        </div>
      )}

        <div className={`flex items-end gap-1 w-full ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
  <div className={`relative flex flex-col ${isOwn ? 'items-end' : 'items-start'} max-w-[85%] md:max-w-[70%]`}>
    <div className={`
      px-4 py-2.5 shadow-sm transition-all duration-500 
      ${getMessageClasses(isOwn)}
      /* FIX: Prevents "aaaaa" from breaking the window */
      break-words [word-break:break-word] overflow-hidden
    `}>
      {message.type === 'image' && message.media_url ? (
  <div 
    className="-mx-5 -my-3 overflow-hidden rounded-[28px] relative transition-all duration-300 active:scale-95"
    /* This custom cursor is a cute pink heart with a white border */
    style={{ 
      cursor: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='%23ff4d94' stroke='white' stroke-width='2'><path d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'/></svg>") 16 16, pointer` 
    }}
    onClick={(e) => {
      e.stopPropagation();
      setIsZoomed(true);
    }}
  >
    <img 
      src={message.media_url} 
      alt="Shared" 
      className="max-h-80 w-full object-cover transition-transform duration-700 group-hover:scale-110" 
    />
    
    {/* Sweet Overlay Hint */}
    <div className="absolute inset-0 bg-pink-500/0 group-hover:bg-pink-500/10 transition-colors duration-300 flex items-center justify-center">
       <span className="opacity-0 group-hover:opacity-100 scale-50 group-hover:scale-100 transition-all duration-500 text-white drop-shadow-md font-bold text-xs uppercase tracking-widest bg-black/20 px-3 py-1 rounded-full backdrop-blur-sm">
         View Sweetness
       </span>
    </div>

    {message.content && (
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent p-4">
        <p className="text-white text-[14px] leading-relaxed font-medium">
          {message.content}
        </p>
      </div>
    )}
  </div>
) : (message.type === 'file' || message.type === 'doc') ? (
    /* --- DOC FACE: "Romantic Receipt" --- */
    <a href={message.media_url || '#'} target="_blank" className="flex items-center gap-4 py-2 min-w-[220px]">
      <div className="relative">
        <div className={`p-3 rounded-full ${isOwn ? 'bg-white/30' : 'bg-[#FF69B4]/20'}`}>
          <Star className={`${isOwn ? 'text-white' : 'text-[#FF69B4]'} w-6 h-6 animate-pulse`} />
        </div>
        <div className="absolute -top-1 -right-1 bg-yellow-400 w-3 h-3 rounded-full border-2 border-white" />
      </div>
      <div className="flex flex-col text-left">
        <span className="font-bold text-sm truncate w-32">{message.content || 'Our_Memory.pdf'}</span>
        <span className="text-[10px] opacity-70">Shared with love • Tap to open</span>
      </div>
    </a>
  ) : (message.type === 'location' || (message.content && message.content.includes('maps'))) ? (
  /* --- PREMIUM THEMED LOCATION CARD --- */
  (() => {
    const coordsMatch = message.content?.match(/([-.\d]+),([-.\d]+)/);
    const lat = coordsMatch?.[1];
    const lng = coordsMatch?.[2];
    
    const mapPreviewUrl = lat && lng 
      ? `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${lng},${lat}&z=14&l=map&size=450,300`
      : null;

    return (
      <div className="flex flex-col w-full min-w-[220px] max-w-[280px] -mx-4 -my-2 overflow-hidden rounded-[24px] shadow-sm">
        {/* Map Section */}
        <div className="h-36 w-full relative overflow-hidden border-b border-white/20" style={{ isolation: 'isolate' }}>
          {mapPreviewUrl ? (
            <img 
              src={mapPreviewUrl} 
              alt="Map" 
              className="w-full h-full object-cover transform-gpu transition-transform duration-700 hover:scale-105" 
            />
          ) : (
            <div className="w-full h-full bg-pink-100/50 flex items-center justify-center">
               <Heart className="w-8 h-8 text-pink-300 animate-pulse" fill="currentColor" />
            </div>
          )}
          
          {/* Floating Glass Tag */}
          <div className="absolute bottom-2 left-2 right-2 bg-white/70 backdrop-blur-md py-1 px-2 rounded-lg text-[9px] text-center font-black text-[#FF1493] uppercase tracking-widest shadow-sm border border-white/40">
             {isOwn ? "Sweet Spot 📍" : "Sweet Spot 📍"}
          </div>

          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none drop-shadow-lg">
             <Heart className="w-7 h-7 text-[#FF1493] animate-bounce" fill="currentColor" />
          </div>
        </div>

        {/* The Action Area - Now fully themed */}
        <div className={`p-2.5 ${isOwn ? 'bg-white/10' : 'bg-[#FF1493]/5'}`}>
          <button 
            onClick={() => {
              const urlMatch = message.content?.match(/https?:\/\/[^\s]+/);
              const finalUrl = urlMatch ? urlMatch[0] : `https://www.google.com/maps?q=${lat},${lng}`;
              window.open(finalUrl, '_blank');
            }}
            className={`w-full py-2.5 rounded-xl font-black text-[10px] uppercase tracking-[2px] transition-all active:scale-95 shadow-md
              ${isOwn 
                ? 'bg-white text-[#FF1493] hover:shadow-lg' 
                : 'bg-[#FF1493] text-white hover:bg-[#E61283]'
              }`}
          >
            Open in Maps
          </button>
        </div>
      </div>
    );
  })()
) : message.type === 'voice' && message.media_url ? (
  /* --- MOBILE-OPTIMIZED VOICE PLAYER --- */
  <div className="flex flex-col gap-2 py-2 w-full min-w-[200px] xs:min-w-[240px]">
    <div className="flex items-center gap-3">
      <button 
        onClick={() => isPlaying ? audioRef.current?.pause() : audioRef.current?.play()} 
        className={`
          relative flex-shrink-0 w-11 h-11 flex items-center justify-center 
          transition-all duration-500 ease-out active:scale-90 shadow-lg
          ${isPlaying 
            ? 'bg-white text-[#FF1493] rounded-[15px] rotate-90 scale-105' 
            : isOwn 
              ? 'bg-white/20 text-white rounded-[20px]' 
              : 'bg-[#FF1493] text-white rounded-[20px]'
          }
        `}
      >
        {isPlaying ? (
          <div className="flex gap-1 rotate-[-90deg]">
             <div className="w-1 h-3.5 bg-current rounded-full animate-[bounce_1s_infinite_0.1s]" />
             <div className="w-1 h-3.5 bg-current rounded-full animate-[bounce_1s_infinite_0.3s]" />
          </div>
        ) : (
          <Play size={20} className="ml-1 fill-current" />
        )}
      </button>

      {/* Waveform now uses flex-1 to grow/shrink based on screen width */}
      <div className="flex items-end gap-[2px] h-8 flex-1 px-1 overflow-hidden">
        {(waveform.length > 0 ? waveform : Array(20).fill(0.2)).map((loudness, i) => (
          <div 
            key={i} 
            className={`flex-1 min-w-[2px] max-w-[4px] rounded-full transition-opacity duration-300 ${isOwn ? 'bg-white' : 'bg-[#FF1493]'}`}
            style={{ 
              height: `${Math.max(loudness * 100, 20)}%`, 
              maxHeight: '100%',
              opacity: (currentTime/duration) > (i/20) ? 1 : 0.25
            }} 
          />
        ))}
      </div>
    </div>

    {/* Metadata Row: Positioned relative to the waveform, not the screen edge */}
    <div className="flex justify-between items-center w-full px-0 mt-0.5">
      <span className={`text-[8px] font-black uppercase tracking-widest opacity-70 ${isOwn ? 'text-white' : 'text-[#FF1493]'}`}>
        {isPlaying ? 'Listening' : 'Voice Note'}
      </span>
      <span className={`text-[10px] font-mono font-bold ${isOwn ? 'text-white' : 'text-[#8B004B]'}`}>
        {formatAudioTime(isPlaying ? currentTime : duration)}
      </span>
    </div>

    <audio 
      ref={audioRef} 
      src={message.media_url} 
      onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)} 
      onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} 
      onEnded={() => setIsPlaying(false)} 
      onPlay={() => setIsPlaying(true)}
      onPause={() => setIsPlaying(false)}
      className="hidden" 
    />
  </div>
) : (
  <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{message.content}</p>
)}

{/* --- THE FIX: This is the div that was incorrectly closed inside the block above --- */}
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

<div className={`flex items-center gap-1.5 mt-1 px-1 text-[10px] font-bold uppercase tracking-widest
    ${theme === 'romantic' ? 'text-[#FF69B4]/80' : 'text-gray-400'}
    ${isOwn ? 'flex-row-reverse' : 'flex-row'}
  `}>
              <span className={`
    ${theme === 'romantic' 
      ? 'text-[#FF69B4]/80' 
      : theme === 'dark' 
        ? 'text-gray-500' 
        : 'text-gray-400'}
  `}>
    {formatTime(message.created_at)}
    {message.is_edited && ' • Edited'}
  </span>
  {theme === 'romantic' && (
    <Heart className="w-2 h-2 text-[#FF69B4]/40" fill="currentColor" />
  )}

          <div className="relative opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center gap-1">
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
                    className={`absolute w-48 max-w-[70vw] rounded-lg shadow-lg border py-1 z-20 transition-all duration-300 ${
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
  {/* --- THIS PART STOPS THE FLASHING --- */}
      {isZoomed && message.media_url && (
  <div 
    className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/95 backdrop-blur-xl p-4 touch-none"
    onClick={(e) => {
      e.stopPropagation();
      setIsZoomed(false);
    }}
  >
    {/* Close button for mobile (since there's no hover) */}
    <button className="absolute top-12 right-6 text-white/70 bg-white/10 p-2 rounded-full">
       <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
    </button>

    <img 
      src={message.media_url} 
      className="max-w-full max-h-[70vh] rounded-2xl shadow-2xl object-contain animate-in zoom-in-95 duration-300"
      alt="Full view"
    />

    {message.content && (
      <div className="mt-6 max-w-xs text-center">
        <p className="text-white text-base font-medium bg-white/10 px-6 py-3 rounded-2xl backdrop-blur-md border border-white/10">
          {message.content}
        </p>
      </div>
    )}
    
    <p className="mt-8 text-white/30 text-[10px] uppercase tracking-[4px] font-bold animate-pulse">
      Tap anywhere to close
    </p>
  </div>
)}
    </>
  );
}