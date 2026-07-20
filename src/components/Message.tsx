import { useState, useRef, useEffect, memo } from 'react';
import { MoreVertical, Reply, Forward, Copy, Star, Trash2, CreditCard as Edit3, Heart, Play, Ban, UserX, Users2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { localDB } from '../db';
import { usePerformance } from '../contexts/PerformanceContext';
import { formatMessagePreview } from '../lib/messagePreview';

export interface Reaction {
  reaction: string;
  user_id: string;
  count: number;
}

export interface MessageReactionState {
  reactions: Reaction[];
  userMap: Record<string, string>;
}

interface MessageData {
  id: string;
  sender_id: string;
  content: string | null;
  type: string;
  media_url: string | null;
  is_edited: boolean;
  is_deleted: boolean;
  created_at: string;
  reply_to_id?: string | null;
  profiles: {
    display_name: string;
    avatar_url: string | null;
    username: string;
  };
}

interface MessageProps {
  message: MessageData;
  isOwn: boolean;
  showAvatar: boolean;
  showDateSeparator: boolean;
  /** Available emoji reaction options (e.g. ['💖','🥰']) */
  reactions: string[];
  theme: 'light' | 'dark' | 'sweet';
  /** "Delete for everyone" — Message soft-deletes in the DB; this reflects it in the list state */
  onDelete?: (id: string) => void;
  /** "Delete for me" — hides the bubble on this device only, no DB write */
  onHide?: (id: string) => void;
  /** Loads this message's text into the composer for editing */
  onEdit?: (id: string, content: string) => void;
  /** Starts a reply to this message */
  onReply?: (message: MessageData) => void;
  /** The message this one is replying to (if it's in the loaded window) */
  repliedTo?: MessageData;
  /** Tap the reply quote to jump to the original message */
  onJumpToReplied?: (id: string) => void;
  /** Draw an "Unread messages" divider just above this message */
  showUnreadDivider?: boolean;
  /** Current user id — to label the reply quote as "You" vs the other person */
  currentUserId?: string;
  /** Opens the shared full-screen gallery viewer, browsable across every image/gif in this chat */
  onViewMedia?: (messageId: string) => void;
  /** Reaction data fed down from ChatWindow's centralized subscription */
  initialDbReactions?: Reaction[];
  initialUserMap?: Record<string, string>;
}

// ─── Stable empty sentinels so React.memo sees referential equality ──────────
const EMPTY_REACTIONS: Reaction[] = [];
const EMPTY_USER_MAP: Record<string, string> = {};

function MessageComponent({
  message,
  isOwn,
  showAvatar,
  reactions,
  theme,
  onDelete,
  onHide,
  onEdit,
  onReply,
  repliedTo,
  onJumpToReplied,
  showUnreadDivider,
  currentUserId,
  onViewMedia,
  showDateSeparator,
  initialDbReactions = EMPTY_REACTIONS,
  initialUserMap = EMPTY_USER_MAP,
}: MessageProps) {
  const { user } = useAuth();
  const { isLowPerfMode } = usePerformance();
  const [showMenu, setShowMenu] = useState(false);
  const [menuDirection, setMenuDirection] = useState<'up' | 'down'>('down');
  // Height cap for the menu so it can never run off the top/bottom edge — set
  // from the space available in the chosen direction; the menu scrolls if the
  // items don't all fit.
  const [menuMaxHeight, setMenuMaxHeight] = useState<number>(320);

  // Open the 3-dot menu in whichever direction has more room, and cap its
  // height to that room (minus a margin) so its border never touches an edge.
  const openMenu = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const down = spaceBelow >= spaceAbove;
    setMenuDirection(down ? 'down' : 'up');
    setMenuMaxHeight(Math.max(140, (down ? spaceBelow : spaceAbove) - 16));
    setShowMenu((s) => !s);
  };
  const [showReactions, setShowReactions] = useState(false);
  const [dbReactions, setDbReactions] = useState<Reaction[]>(initialDbReactions);
  const [userReactionMap, setUserReactionMap] = useState<Map<string, string>>(
    () => new Map(Object.entries(initialUserMap))
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [waveform, setWaveform] = useState<number[]>([]);
  const lastActionTime = useRef<number>(0);

  // Sync local reaction state when ChatWindow's centralized subscription pushes updates
  useEffect(() => {
    setDbReactions(initialDbReactions);
  }, [initialDbReactions]);

  useEffect(() => {
    setUserReactionMap(new Map(Object.entries(initialUserMap)));
  }, [initialUserMap]);

  // Waveform is generated lazily (see loadWaveformIfNeeded, wired to the
  // play button) instead of eagerly here. Decoding audio via AudioContext
  // for every voice message the moment it mounts meant opening a chat with
  // many voice notes fired that many concurrent fetch+decode operations at
  // once, all for waveforms that might never even be looked at.
  async function loadWaveformIfNeeded() {
    if (waveform.length > 0 || message.type !== 'voice' || !message.media_url) return;
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const response = await fetch(message.media_url);
      const data = await response.arrayBuffer();
      const buffer = await audioContext.decodeAudioData(data);
      const rawData = buffer.getChannelData(0);
      const samples = 20;
      const blockSize = Math.floor(rawData.length / samples);
      const filteredData = [];
      for (let i = 0; i < samples; i++) {
        let blockStart = blockSize * i;
        let sum = 0;
        for (let j = 0; j < blockSize; j++) {
          sum = sum + Math.abs(rawData[blockStart + j]);
        }
        filteredData.push(sum / blockSize);
      }
      const multiplier = Math.pow(Math.max(...filteredData), -1);
      setWaveform(filteredData.map(n => n * multiplier));
    } catch (err) {
      console.error('Waveform decode failed:', err);
    }
  }

  function formatStickyDate(dateString: string) {
    const date = new Date(dateString);
    const now = new Date();
    const diffInDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffInDays === 0) return 'Today';
    if (diffInDays === 1) return 'Yesterday';
    if (diffInDays < 7) return date.toLocaleDateString('en-US', { weekday: 'long' });
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  async function handleReaction(emoji: string) {
    if (!user) return;

    lastActionTime.current = Date.now();

    const previousReactions = [...dbReactions];
    const previousMap = new Map(userReactionMap);

    let newReactions = [...dbReactions];
    const hadThisReaction = userReactionMap.get(emoji) === user.id;

    if (hadThisReaction) {
      const existingIndex = newReactions.findIndex(r => r.reaction === emoji);
      if (existingIndex !== -1) {
        if (newReactions[existingIndex].count > 1) {
          newReactions[existingIndex] = { ...newReactions[existingIndex], count: newReactions[existingIndex].count - 1 };
        } else {
          newReactions = newReactions.filter(r => r.reaction !== emoji);
        }
      }
      userReactionMap.delete(emoji);
    } else {
      userReactionMap.forEach((_, emo) => {
        const idx = newReactions.findIndex(r => r.reaction === emo);
        if (idx !== -1) {
          if (newReactions[idx].count > 1) {
            newReactions[idx] = { ...newReactions[idx], count: newReactions[idx].count - 1 };
          } else {
            newReactions = newReactions.filter(r => r.reaction !== emo);
          }
        }
      });
      const newIdx = newReactions.findIndex(r => r.reaction === emoji);
      if (newIdx !== -1) {
        newReactions[newIdx] = { ...newReactions[newIdx], count: newReactions[newIdx].count + 1 };
      } else {
        newReactions.push({ reaction: emoji, user_id: user.id, count: 1 });
      }
      userReactionMap.clear();
      userReactionMap.set(emoji, user.id);
    }

    setDbReactions(newReactions);
    setUserReactionMap(new Map(userReactionMap));
    setShowReactions(false);

    try {
      if (!navigator.onLine) {
        console.warn("Device is offline. Emoji reaction registered locally in state view context.");
        return;
      }

      const { data: existing } = await supabase
        .from('message_reactions')
        .select('id, reaction')
        .eq('message_id', message.id)
        .eq('user_id', user.id);

      if (existing && existing.length > 0) {
        await Promise.all(existing.map(r =>
          supabase.from('message_reactions').delete().eq('id', r.id)
        ));
        if (existing[0].reaction !== emoji) {
          await supabase.from('message_reactions').insert({
            message_id: message.id,
            user_id: user.id,
            reaction: emoji,
          });
        }
      } else {
        await supabase.from('message_reactions').insert({
          message_id: message.id,
          user_id: user.id,
          reaction: emoji,
        });
      }
    } catch (error) {
      console.error('Error syncing cloud reactions:', error);
      setDbReactions(previousReactions);
      setUserReactionMap(previousMap);
    }
  }

  // Delete for everyone — soft-delete the row (is_deleted=true) in the cache
  // and the cloud. The is_deleted flag propagates to the other person via
  // ChatWindow's UPDATE realtime listener, and both sides render the "message
  // deleted" tombstone below.
  const handleDeleteForEveryone = async () => {
    try {
      await localDB.messages.update(message.id, { is_deleted: true });
      if (onDelete) onDelete(message.id);
      if (navigator.onLine) {
        const { error } = await supabase
          .from('messages')
          .update({ is_deleted: true })
          .eq('id', message.id);
        if (error) throw error;
      }
    } catch (err) {
      console.warn("Cloud deletion delayed, continuing via offline cache state:", err);
    } finally {
      setShowMenu(false);
    }
  };

  // Delete for me — just hide it on this device; nothing touches the cloud,
  // so the other person keeps seeing the message.
  const handleDeleteForMe = () => {
    onHide?.(message.id);
    setShowMenu(false);
  };

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

  // Only plain text messages are editable — not media, and not a location
  // (which is stored as a text row whose content is a maps URL).
  const isEditableText =
    message.type === 'text' && !!message.content && !message.content.includes('maps');

  const unreadDivider = showUnreadDivider ? (
    <div className="flex items-center gap-2 my-3 w-full px-2 animate-in fade-in duration-300">
      <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent to-pink-300/60" />
      <span className="text-[10px] font-black uppercase tracking-[2px] text-[#FF1493] bg-white/70 px-3 py-1 rounded-full shadow-sm whitespace-nowrap">
        Unread messages
      </span>
      <div className="h-[1px] flex-1 bg-gradient-to-l from-transparent to-pink-300/60" />
    </div>
  ) : null;

  const formatAudioTime = (seconds: number) => {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getMessageClasses = (own: boolean) => {
    const shape = "rounded-[32px]";
    if (theme === 'sweet') {
      // backdrop-blur-xl is one of the most GPU-expensive CSS properties
      // that exists — it forces continuous re-sampling of everything behind
      // every bubble, every frame. In low-perf mode, fall back to a plain
      // higher-opacity background instead: same visual language, no blur.
      return own
        ? `${shape} bg-gradient-to-br from-[#FF85A1] via-[#FF69B4] to-[#FF1493] text-white shadow-[0_4px_15px_rgba(255,20,147,0.3)] border border-white/20`
        : isLowPerfMode
        ? `${shape} bg-white/80 border border-white/60 text-[#8B004B] shadow-[0_4px_10px_rgba(0,0,0,0.05)]`
        : `${shape} bg-white/40 backdrop-blur-xl border border-white/40 text-[#8B004B] shadow-[0_4px_10px_rgba(0,0,0,0.05)]`;
    } else if (theme === 'dark') {
      return own ? `${shape} bg-pink-500 text-white` : `${shape} bg-gray-100 text-gray-900`;
    } else {
      return own ? `${shape} bg-pink-500 text-white` : `${shape} bg-gray-100 text-gray-900`;
    }
  };

  if (message.is_deleted) {
    return (
      <>
        {showDateSeparator && (
          <div className="flex items-center justify-center my-6 w-full">
            <div className="flex items-center gap-3 w-full max-w-[200px]">
              <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-pink-300/50 to-transparent" />
              <span className={`text-[10px] font-black uppercase tracking-[2px] whitespace-nowrap
                ${theme === 'sweet' ? 'text-[#FF1493] bg-white/50 px-3 py-1 rounded-full backdrop-blur-sm shadow-sm' : 'text-gray-400'}
              `}>
                {formatStickyDate(message.created_at)}
              </span>
              <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-pink-300/50 to-transparent" />
            </div>
          </div>
        )}

        {unreadDivider}

        <div className={`flex flex-col group ${isOwn ? 'items-end' : 'items-start'} mb-4 px-0 w-full`}>
          {!isOwn && showAvatar && (
            <div className="flex items-center gap-2 mb-1 ml-2">
              {message.profiles.avatar_url ? (
                <img
                  src={message.profiles.avatar_url}
                  alt={message.profiles.display_name}
                  className="w-6 h-6 rounded-full object-cover border border-pink-200"
                />
              ) : (
                <div className={`w-6 h-6 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-[10px] font-bold ${theme === 'sweet' ? 'from-[#FF69B4] to-[#FF1493]' : 'from-pink-400 to-purple-500'}`}>
                  {message.profiles.display_name[0]}
                </div>
              )}
              <span className={`text-[10px] font-bold uppercase tracking-wider ${theme === 'sweet' ? 'text-[#FF1493]' : 'text-gray-500'}`}>
                {message.profiles.display_name}
              </span>
            </div>
          )}

          <div className={`flex items-end ${isOwn ? 'justify-end' : 'justify-start'} w-full px-0`}>
            <div className={`relative flex flex-col ${isOwn ? 'items-end' : 'items-start'} max-w-[85%] md:max-w-[70%] w-fit`}>
              {/* Same bubble shell as a real message, just muted + an italic
                  "deleted" line instead of content. */}
              <div className={`px-4 py-2.5 shadow-sm ${getMessageClasses(isOwn)} opacity-80`}>
                <p className={`flex items-center gap-2 text-[14px] italic ${isOwn ? 'text-white/90' : theme === 'sweet' ? 'text-[#8B004B]/70' : 'text-gray-400'}`}>
                  <Ban className="w-4 h-4 flex-shrink-0 opacity-80" />
                  This message was deleted
                </p>
              </div>
            </div>
          </div>

          {/* Footer: timestamp + a 3-dot menu whose only action is "Delete"
              (delete-for-me — clears the tombstone on this device only). */}
          <div className={`flex items-center gap-1 mt-1 w-full ${isOwn ? 'ml-auto flex-row-reverse' : 'mr-auto flex-row'} ${theme === 'sweet' ? 'text-[#FF69B4]/80' : 'text-gray-400'}`}>
            <span className="text-[10px] font-bold">{formatTime(message.created_at)}</span>

            <div className="relative opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
              <button
                onClick={openMenu}
                className={`p-1.5 rounded-full border-2 transition-all duration-300 ${
                  theme === 'sweet'
                    ? 'border-[#FFB6C1] text-[#FF69B4] hover:bg-pink-50 hover:scale-110'
                    : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-400 hover:bg-gray-100'
                }`}
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>

              {showMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                  <div
                    style={{ maxHeight: menuMaxHeight }}
                    className={`absolute w-40 max-w-[70vw] rounded-lg shadow-lg border py-1 z-20 overflow-y-auto ${
                      theme === 'sweet' ? 'bg-[#FFF0F5] border-[#FFB6C1]' : theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                    } ${isOwn ? 'right-0' : 'left-0'} ${menuDirection === 'up' ? 'bottom-full mb-1 origin-bottom' : 'top-full mt-1 origin-top'}`}
                  >
                    <button
                      onClick={handleDeleteForMe}
                      className="w-full px-4 py-2 text-left flex items-center gap-2 text-red-600 text-sm border border-transparent hover:border-red-400 transition-all hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Delete</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {showDateSeparator && (
        <div className="flex items-center justify-center my-6 w-full">
          <div className="flex items-center gap-3 w-full max-w-[200px]">
            <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-pink-300/50 to-transparent" />
            <span className={`text-[10px] font-black uppercase tracking-[2px] whitespace-nowrap
              ${theme === 'sweet' ? 'text-[#FF1493] bg-white/50 px-3 py-1 rounded-full backdrop-blur-sm shadow-sm' : 'text-gray-400'}
            `}>
              {formatStickyDate(message.created_at)}
            </span>
            <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-pink-300/50 to-transparent" />
          </div>
        </div>
      )}

      {unreadDivider}

      <div className={`flex flex-col group ${isOwn ? 'items-end' : 'items-start'} mb-4 px-0 w-full`}>
        {!isOwn && showAvatar && (
          <div className="flex items-center gap-2 mb-1 ml-2">
            {message.profiles.avatar_url ? (
              <img
                src={message.profiles.avatar_url}
                alt={message.profiles.display_name}
                className="w-6 h-6 rounded-full object-cover border border-pink-200"
              />
            ) : (
              <div className={`w-6 h-6 rounded-full bg-gradient-to-br flex items-center justify-center text-white text-[10px] font-bold ${theme === 'sweet' ? 'from-[#FF69B4] to-[#FF1493]' : 'from-pink-400 to-purple-500'}`}>
                {message.profiles.display_name[0]}
              </div>
            )}
            <span className={`text-[10px] font-bold uppercase tracking-wider ${theme === 'sweet' ? 'text-[#FF1493]' : 'text-gray-500'}`}>
              {message.profiles.display_name}
            </span>
          </div>
        )}

        <div className={`flex items-end ${isOwn ? 'justify-end' : 'justify-start'} w-full px-0`}>
          <div className={`relative flex flex-col ${isOwn ? 'items-end' : 'items-start'} max-w-[85%] md:max-w-[70%] w-fit`}>
            <div
              className={`
                px-4 py-2.5 shadow-sm transition-all
                ${getMessageClasses(isOwn)}
                break-words [word-break:break-word] overflow-hidden
                min-w-0 max-w-full
              `}
            >
              {/* Quoted preview of the message this one replies to. Tap to
                  jump to the original (loads older pages first if needed). */}
              {repliedTo && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onJumpToReplied?.(repliedTo.id); }}
                  className={`w-full mb-2 rounded-lg border-l-2 pl-2 pr-2 py-1 text-left overflow-hidden transition-opacity hover:opacity-80 active:opacity-70 ${
                    isOwn
                      ? 'bg-white/15 border-white/60'
                      : theme === 'sweet' ? 'bg-[#FF69B4]/10 border-[#FF69B4]' : 'bg-black/5 border-pink-400'
                  }`}
                >
                  <p className={`text-[10px] font-black uppercase tracking-wider truncate ${isOwn ? 'text-white/90' : 'text-[#FF1493]'}`}>
                    {repliedTo.sender_id === currentUserId ? 'You' : (repliedTo.profiles?.display_name || 'Them')}
                  </p>
                  <p className={`text-[11px] truncate ${isOwn ? 'text-white/70' : theme === 'sweet' ? 'text-[#8B004B]/70' : 'text-gray-500'}`}>
                    {formatMessagePreview({ content: repliedTo.content, type: repliedTo.type, is_deleted: repliedTo.is_deleted })}
                  </p>
                </button>
              )}

              {message.type === 'gif' && message.media_url ? (
                <div
                  className="-mx-5 -my-3 overflow-hidden rounded-[28px] relative cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewMedia?.(message.id);
                  }}
                >
                  <img
                    src={message.media_url}
                    alt="GIF"
                    className="max-h-64 w-full object-cover"
                  />
                  <span className="absolute top-2 left-2 px-1.5 py-0.5 bg-black/60 rounded-md text-white text-[9px] font-black uppercase tracking-widest">
                    Gif
                  </span>
                </div>
              ) : message.type === 'image' && message.media_url ? (
                <div
                  className="-mx-5 -my-3 overflow-hidden rounded-[28px] relative transition-all duration-300 active:scale-95"
                  style={{
                    cursor: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='%23ff4d94' stroke='white' stroke-width='2'><path d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'/></svg>") 16 16, pointer`
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewMedia?.(message.id);
                  }}
                >
                  <img
                    src={message.media_url}
                    alt="Shared"
                    className="max-h-80 w-full object-cover transition-transform duration-700 group-hover:scale-110"
                  />
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
                (() => {
                  const coordsMatch = message.content?.match(/([-.\d]+),([-.\d]+)/);
                  const lat = coordsMatch?.[1];
                  const lng = coordsMatch?.[2];
                  const mapPreviewUrl = lat && lng
                    ? `https://static-maps.yandex.ru/1.x/?lang=en_US&ll=${lng},${lat}&z=14&l=map&size=450,300`
                    : null;

                  return (
                    <div className="flex flex-col w-full min-w-[220px] max-w-[280px] -mx-4 -my-2 overflow-hidden rounded-[24px] shadow-sm">
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
                        <div className="absolute bottom-2 left-2 right-2 bg-white/70 backdrop-blur-md py-1 px-2 rounded-lg text-[9px] text-center font-black text-[#FF1493] uppercase tracking-widest shadow-sm border border-white/40">
                          {isOwn ? "Sweet Spot 📍" : "Sweet Spot 📍"}
                        </div>
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none drop-shadow-lg">
                          <Heart className="w-7 h-7 text-[#FF1493] animate-bounce" fill="currentColor" />
                        </div>
                      </div>
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
                <div className="flex flex-col gap-2 py-2 w-full min-w-[200px] xs:min-w-[240px]">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        if (isPlaying) {
                          audioRef.current?.pause();
                        } else {
                          loadWaveformIfNeeded();
                          audioRef.current?.play();
                        }
                      }}
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
                    <div className="flex items-end gap-[2px] h-8 flex-1 px-1 overflow-hidden">
                      {(waveform.length > 0 ? waveform : Array(20).fill(0.2)).map((loudness, i) => (
                        <div
                          key={i}
                          className={`flex-1 min-w-[2px] max-w-[4px] rounded-full transition-opacity duration-300 ${isOwn ? 'bg-white' : 'bg-[#FF1493]'}`}
                          style={{
                            height: `${Math.max(loudness * 100, 20)}%`,
                            maxHeight: '100%',
                            opacity: (currentTime / duration) > (i / 20) ? 1 : 0.25
                          }}
                        />
                      ))}
                    </div>
                  </div>
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
            </div>

            {dbReactions.length > 0 && (
              <div className={`
                absolute -bottom-4 flex flex-row flex-nowrap gap-1 z-20
                ${isOwn ? 'right-2' : 'left-2'}
                animate-in fade-in zoom-in-50 duration-500 ease-out
              `}>
                {dbReactions.map((r) => (
                  <button
                    key={r.reaction}
                    onClick={() => handleReaction(r.reaction)}
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold transition-all shadow-md border whitespace-nowrap ${
                      userReactionMap.get(r.reaction) === user?.id
                        ? (theme === 'sweet' ? 'bg-[#FF69B4] text-white border-[#FF1493] scale-105' : 'bg-pink-100 dark:bg-pink-900/30 border-pink-300')
                        : (theme === 'sweet' ? 'bg-white border-[#FFB6C1] text-[#8B004B]' : 'bg-white dark:bg-gray-800 border-gray-200')
                    }`}
                  >
                    <span>{r.reaction}</span>
                    {r.count > 1 && (
                      <span className={`font-black ${theme === 'sweet' ? 'text-white/90' : 'text-gray-500'}`}>
                        {r.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className={`
          flex items-center gap-1 mt-1 w-full
          ${isOwn ? 'ml-auto flex-row-reverse' : 'mr-auto flex-row'}
          ${theme === 'sweet' ? 'text-[#FF69B4]/80' : 'text-gray-400'}
        `}
      >
        <span className="text-[10px] font-bold">
          {formatTime(message.created_at)}
          {message.is_edited && ' • Edited'}
        </span>

        <div className="relative opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center gap-1">
          <button
            onClick={() => setShowReactions(!showReactions)}
            className={`p-1.5 rounded-full border-2 transition-all duration-300 ${
              theme === 'sweet'
                ? 'border-[#FFB6C1] text-[#FF69B4] hover:bg-pink-50 hover:scale-110'
                : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-400 hover:bg-gray-100'
            }`}
          >
            <Heart className="w-3.5 h-3.5" />
          </button>

          {showReactions && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowReactions(false)} />
              <div
                className={`absolute -bottom-12 p-2 rounded-xl shadow-lg border flex gap-2 z-20 transition-colors duration-300 ${
                  theme === 'sweet' ? 'bg-[#FFF0F5] border-[#FFB6C1]' : theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
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
              onClick={openMenu}
              className={`p-1.5 rounded-full border-2 transition-all duration-300 ${
                theme === 'sweet'
                  ? 'border-[#FFB6C1] text-[#FF69B4] hover:bg-pink-50 hover:scale-110'
                  : 'border-gray-200 text-gray-600 dark:border-gray-700 dark:text-gray-400 hover:bg-gray-100'
              }`}
            >
              <MoreVertical className="w-3.5 h-3.5" />
            </button>

            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div
                  style={{ maxHeight: menuMaxHeight }}
                  className={`absolute w-48 max-w-[70vw] rounded-lg shadow-lg border py-1 z-20 overflow-y-auto transition-all duration-300 ${
                    theme === 'sweet' ? 'bg-[#FFF0F5] border-[#FFB6C1]' : theme === 'dark' ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
                  } ${isOwn ? 'right-0' : 'left-0'} ${
                    menuDirection === 'up' ? 'bottom-full mb-1 origin-bottom' : 'top-full mt-1 origin-top'
                  }`}
                >
                  {[
                    { label: 'Reply', icon: <Reply className="w-4 h-4" />, action: () => onReply?.(message) },
                    { label: 'Forward', icon: <Forward className="w-4 h-4" />, action: () => {} },
                    { label: 'Copy', icon: <Copy className="w-4 h-4" />, action: handleCopy },
                    { label: 'Star', icon: <Star className="w-4 h-4" />, action: () => {} }
                  ].map((item) => (
                    <button
                      key={item.label}
                      onClick={() => { item.action(); setShowMenu(false); }}
                      className={`w-full px-4 py-2 text-left flex items-center gap-2 text-sm border border-transparent transition-all ${
                        theme === 'sweet'
                          ? 'hover:bg-[#FFC0CB]/30 text-[#4B004B] hover:border-[#FFB6C1]'
                          : theme === 'dark'
                          ? 'hover:bg-gray-700 text-white'
                          : 'hover:bg-gray-50 text-black hover:border-gray-400'
                      }`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  ))}

                  <div className={`border-t my-1 ${theme === 'sweet' ? 'border-[#FFB6C1]' : 'border-gray-200 dark:border-gray-700'}`} />

                  {/* Edit — only your own plain text messages (not media, and
                      not a location, which is a text row holding a maps URL). */}
                  {isOwn && isEditableText && (
                    <button
                      onClick={() => { onEdit?.(message.id, message.content || ''); setShowMenu(false); }}
                      className={`w-full px-4 py-2 text-left flex items-center gap-2 text-sm border border-transparent transition-all ${
                        theme === 'sweet'
                          ? 'hover:bg-[#FFC0CB]/30 text-[#4B004B] hover:border-[#FFB6C1]'
                          : theme === 'dark'
                          ? 'hover:bg-gray-700 text-white'
                          : 'hover:bg-gray-50 text-black hover:border-gray-400'
                      }`}
                    >
                      <Edit3 className="w-4 h-4" />
                      <span>Edit</span>
                    </button>
                  )}

                  {/* Delete for me — available on any message, hides it only
                      on this device. */}
                  <button
                    onClick={handleDeleteForMe}
                    className="w-full px-4 py-2 text-left flex items-center gap-2 text-red-600 text-sm border border-transparent hover:border-red-400 transition-all hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    <UserX className="w-4 h-4" />
                    <span>Delete for me</span>
                  </button>

                  {/* Delete for everyone — only your own messages can be
                      pulled back for the other person too. */}
                  {isOwn && (
                    <button
                      onClick={handleDeleteForEveryone}
                      className="w-full px-4 py-2 text-left flex items-center gap-2 text-red-600 text-sm border border-transparent hover:border-red-400 transition-all hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <Users2 className="w-4 h-4" />
                      <span>Delete for everyone</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

    </>
  );
}

// ─── Custom arePropsEqual: message bubble only repaints when its data changes ─
function arePropsEqual(prev: MessageProps, next: MessageProps): boolean {
  return (
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.is_edited === next.message.is_edited &&
    prev.message.is_deleted === next.message.is_deleted &&
    prev.message.media_url === next.message.media_url &&
    prev.message.created_at === next.message.created_at &&
    prev.message.reply_to_id === next.message.reply_to_id &&
    // Re-render the quote if the replied-to message's shown fields change
    // (e.g. it gets edited or deleted).
    prev.repliedTo?.id === next.repliedTo?.id &&
    prev.repliedTo?.content === next.repliedTo?.content &&
    prev.repliedTo?.is_deleted === next.repliedTo?.is_deleted &&
    prev.isOwn === next.isOwn &&
    prev.showAvatar === next.showAvatar &&
    prev.showDateSeparator === next.showDateSeparator &&
    prev.showUnreadDivider === next.showUnreadDivider &&
    prev.theme === next.theme &&
    prev.reactions === next.reactions &&
    prev.initialDbReactions === next.initialDbReactions &&
    prev.initialUserMap === next.initialUserMap
  );
}

export const Message = memo(MessageComponent, arePropsEqual);