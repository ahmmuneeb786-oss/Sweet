import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Paperclip, Delete, Heart, ImageIcon, MapPin, FileText, ArrowUpCircle, Clipboard, Video, Smile, Keyboard, Search, ArrowLeft, Plus, Trash2, X } from 'lucide-react';
import { getSuggestions } from '../predictionService';
import { usePerformance } from '../contexts/PerformanceContext';

interface GifItem {
  url: string;
  packName: string;
}

interface SweetKeyboardProps {
  onInput: (char: string | File | Blob) => void;
  onDelete: () => void;
  onSend: () => void;
  newMessage: string;
  onOpenGifPanel: () => void;
  myGifs: GifItem[];
  setMyGifs: React.Dispatch<React.SetStateAction<GifItem[]>>;
  onDocsClick: () => void;
}

type KeyboardMode = 'abc' | 'emoji' | 'gif';
type ShiftState = 'off' | 'shift' | 'caps';

const CLIP_HISTORY_LIMIT = 25;
const CLIP_HISTORY_STORAGE_KEY = 'sweet_clip_history';

const RECENT_EMOJIS_LIMIT = 30;
const RECENT_EMOJIS_STORAGE_KEY = 'sweet_recent_emojis';

interface EmojiCategoryDef {
  key: string;
  label: string;
  icon: string;
  emojis: string[];
}

const EMOJI_CATEGORIES: EmojiCategoryDef[] = [
  {
    key: 'smileys', label: 'Smileys', icon: '😀',
    emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '😵', '🤯', '🥳', '😎', '🤓', '🧐', '😕', '🙁', '😮', '😲'],
  },
  {
    key: 'love', label: 'Love', icon: '❤️',
    emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '💌', '💋', '😍', '🥰', '😘'],
  },
  {
    key: 'people', label: 'People', icon: '👋',
    emojis: ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '👏', '🙌', '👐', '🤲', '🙏', '💪', '👂', '👃', '🧠', '👀', '👄', '👶', '🧒', '👦', '👧', '🧑', '👨', '👩', '👴', '👵', '🙋', '🤦', '🤷', '💃', '🕺', '🧘'],
  },
  {
    key: 'animals', label: 'Animals', icon: '🐶',
    emojis: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐢', '🐍', '🦎', '🐙', '🦑', '🦀', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🦓', '🐘', '🦒', '🦘', '🐐', '🦌', '🐕', '🐈', '🐓', '🦃', '🐇', '🦔', '🌵', '🌲', '🌴', '🌱', '🌿', '🍀', '🍁', '🌷', '🌹', '🌺', '🌸', '🌼', '🌻', '🌞', '🌙', '⭐', '🌟', '✨', '🔥', '🌈', '☀️', '☁️', '⛄', '❄️', '💧', '🌊'],
  },
  {
    key: 'food', label: 'Food', icon: '🍔',
    emojis: ['🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥕', '🌽', '🥔', '🍠', '🥐', '🍞', '🧀', '🥚', '🍳', '🥞', '🥓', '🍗', '🍖', '🌭', '🍔', '🍟', '🍕', '🌮', '🌯', '🥗', '🍝', '🍜', '🍲', '🍣', '🍱', '🍤', '🍙', '🍚', '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🍫', '🍬', '🍭', '🍿', '☕'],
  },
  {
    key: 'activities', label: 'Activities', icon: '⚽',
    emojis: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏉', '🎱', '🏓', '🏸', '🏒', '🏑', '🏏', '🥅', '⛳', '🎣', '🥊', '🥋', '🎽', '🛹', '🎿', '🏋️', '🤼', '🤸', '🏌️', '🏇', '🏄', '🏊', '🚣', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎮', '🎲', '🎯', '🎳', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🎸', '🎻', '🎺'],
  },
  {
    key: 'travel', label: 'Travel', icon: '✈️',
    emojis: ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🚚', '🚛', '🚜', '🚲', '🛵', '🏍️', '✈️', '🚀', '🚁', '⛵', '🚤', '🚢', '⚓', '🚦', '🗺️', '🗽', '🗼', '🏰', '🏟️', '🎡', '🎢', '⛲', '🏖️', '🏝️', '🌋', '⛰️', '🏔️', '⛺', '🏠', '🏢', '🏥', '🏦', '🏨', '🏫', '⛪', '🕌', '🕋', '🛕'],
  },
  {
    key: 'objects', label: 'Objects', icon: '💡',
    emojis: ['⌚', '📱', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '📷', '📹', '🎥', '📞', '☎️', '📺', '📻', '🔋', '🔌', '💡', '🔦', '🕯️', '💰', '💳', '💎', '🔧', '🔨', '🛠️', '🔩', '⚙️', '🔫', '💣', '🔪', '💊', '💉', '🧪', '🧹', '🚽', '🛁', '🧼', '🪒', '🧴', '🎁', '📦', '✉️', '📧', '📅', '📖', '🔖', '🔗', '📎', '📐', '📌', '✂️', '🔍', '🔒', '🔓', '🔔'],
  },
  {
    key: 'symbols', label: 'Symbols', icon: '❗',
    emojis: ['❗', '❓', '‼️', '⁉️', '✅', '❌', '⭕', '🚫', '💯', '💢', '💥', '💫', '💦', '💨', '💬', '💭', '♻️', '⚠️', '🔞', '📵', '🚭', '⬆️', '⬇️', '⬅️', '➡️', '🔄', '🔀', '🔁', '🔂', '▶️', '⏸️', '⏹️', '⏭️', '⏮️', '🔊', '🔇', '📢', '📣', '🔟', '#️⃣'],
  },
  {
    key: 'flags', label: 'Flags', icon: '🏳️',
    emojis: ['🏳️', '🏴', '🏁', '🚩', '🎌', '🏳️‍🌈', '🇺🇸', '🇬🇧', '🇨🇦', '🇦🇺', '🇫🇷', '🇩🇪', '🇮🇹', '🇪🇸', '🇯🇵', '🇰🇷', '🇨🇳', '🇮🇳', '🇧🇷', '🇵🇰'],
  },
];

function loadRecentEmojis(): string[] {
  try {
    const saved = localStorage.getItem(RECENT_EMOJIS_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // corrupted/unavailable storage — fall back to no recents
  }
  return [];
}

// ─── OPTIMIZED KEYBOARD MATRIX ───────────────────────────────────────────────
// Handlers are guaranteed stable via useCallback in the parent.
// shiftState display is derived from a ref so handleKey never gets a new
// identity when shift changes — the matrix NEVER repaints during typing.
const KeyboardMatrix = React.memo(({
  showSymbols,
  shiftState,
  onKeyClick,
  onShiftClick,
  onDeleteStart,
  onDeleteStop,
}: {
  showSymbols: boolean;
  shiftState: ShiftState;
  onKeyClick: (k: string, e: React.PointerEvent) => void;
  onShiftClick: (e: React.PointerEvent) => void;
  onDeleteStart: (e: React.PointerEvent) => void;
  onDeleteStop: () => void;
}) => {
  const rows = showSymbols
    ? [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'], ['.', ',', '?', '!', "'"]]
    : [['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'], ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'], ['Z', 'X', 'C', 'V', 'B', 'N', 'M']];

  const isUpper = shiftState !== 'off';

  return (
    <div className="animate-in fade-in duration-150">
      <div className="flex justify-center gap-1 mb-2">
        {rows[0].map(k => (
          <button
            key={k}
            onPointerDown={(e) => onKeyClick(k, e)}
            className="flex-1 h-11 bg-white/60 rounded-xl text-[#4B004B] font-bold shadow-sm active:bg-pink-200 select-none touch-none will-change-transform"
          >
            {isUpper && !showSymbols ? k : k.toLowerCase()}
          </button>
        ))}
      </div>
      <div className="flex justify-center gap-1 mb-2 px-[4%]">
        {rows[1].map(k => (
          <button
            key={k}
            onPointerDown={(e) => onKeyClick(k, e)}
            className="flex-1 h-11 bg-white/60 rounded-xl text-[#4B004B] font-bold shadow-sm active:bg-pink-200 select-none touch-none will-change-transform"
          >
            {isUpper && !showSymbols ? k : k.toLowerCase()}
          </button>
        ))}
      </div>
      <div className="flex justify-center gap-1">
        <button
          onPointerDown={onShiftClick}
          className={`w-[14%] h-11 rounded-xl flex items-center justify-center transition-all select-none touch-none will-change-transform ${shiftState !== 'off' ? 'bg-pink-500 text-white' : 'bg-white/40 text-[#4B004B]'}`}
        >
          <ArrowUpCircle className={`w-5 h-5 ${shiftState === 'caps' ? 'fill-white text-pink-500' : ''}`} />
        </button>

        {rows[2].map(k => (
          <button
            key={k}
            onPointerDown={(e) => onKeyClick(k, e)}
            className="flex-1 h-11 bg-white/60 rounded-xl text-[#4B004B] font-bold shadow-sm active:bg-pink-200 select-none touch-none will-change-transform"
          >
            {isUpper && !showSymbols ? k : k.toLowerCase()}
          </button>
        ))}

        <button
          onPointerDown={onDeleteStart}
          onPointerUp={onDeleteStop}
          onPointerLeave={onDeleteStop}
          className="w-[14%] h-11 bg-white/40 rounded-xl flex items-center justify-center text-[#4B004B] active:bg-pink-200 select-none touch-none will-change-transform"
        >
          <Delete className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
});
KeyboardMatrix.displayName = 'KeyboardMatrix';

// ─── MAIN KEYBOARD WRAPPER ────────────────────────────────────────────────────
export const SweetKeyboard = ({ onInput, onDelete, onDocsClick, newMessage, onOpenGifPanel, myGifs = [], setMyGifs }: SweetKeyboardProps) => {
  const { isLowPerfMode } = usePerformance();
  const [shiftState, setShiftState] = useState<ShiftState>('off');
  const [showSymbols, setShowSymbols] = useState(false);
  const [showMediaBar, setShowMediaBar] = useState(false);
  const [mode, setMode] = useState<KeyboardMode>('abc');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [suggestions, setSuggestions] = useState<string[]>(['', '', '']);
  const [giphyGifs, setGiphyGifs] = useState<any[]>([]);
  const [gifSearch, setGifSearch] = useState('');
  const [gifSubTab, setGifSubTab] = useState<'library' | 'discover'>('library');

  // Refs for rapid-fire delete timers
  const lastShiftTap = useRef<number>(0);
  const gifTimerRef = useRef<NodeJS.Timeout | null>(null);
  const deleteDelayRef = useRef<NodeJS.Timeout | null>(null);
  const deleteIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [longPressedUrl, setLongPressedUrl] = useState<string | null>(null);
  const [clipHistory, setClipHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(CLIP_HISTORY_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // corrupted/unavailable storage — fall through to the sample defaults
    }
    return [
      'Hey sweetie! 💕',
      "Let's meet at our sweet spot! 🍦",
      '(❁´◡`❁)'
    ];
  });
  const [pasteStatus, setPasteStatus] = useState<'idle' | 'success' | 'denied'>('idle');
  const [showClipPanel, setShowClipPanel] = useState(false);

  useEffect(() => {
    localStorage.setItem(CLIP_HISTORY_STORAGE_KEY, JSON.stringify(clipHistory));
  }, [clipHistory]);

  const [recentEmojis, setRecentEmojis] = useState<string[]>(loadRecentEmojis);
  const [emojiCategory, setEmojiCategory] = useState<string>(() => (
    loadRecentEmojis().length > 0 ? 'recent' : EMOJI_CATEGORIES[0].key
  ));

  useEffect(() => {
    localStorage.setItem(RECENT_EMOJIS_STORAGE_KEY, JSON.stringify(recentEmojis));
  }, [recentEmojis]);

  const visibleEmojiCategories = useMemo(() => (
    recentEmojis.length > 0
      ? [{ key: 'recent', label: 'Recent', icon: '🕓', emojis: recentEmojis }, ...EMOJI_CATEGORIES]
      : EMOJI_CATEGORIES
  ), [recentEmojis]);

  const activeEmojiList = useMemo(() => {
    if (emojiCategory === 'recent') return recentEmojis;
    return EMOJI_CATEGORIES.find(c => c.key === emojiCategory)?.emojis ?? EMOJI_CATEGORIES[0].emojis;
  }, [emojiCategory, recentEmojis]);

  const handleEmojiPick = useCallback((emoji: string) => {
    onInput(emoji);
    setRecentEmojis(prev => [emoji, ...prev.filter(e => e !== emoji)].slice(0, RECENT_EMOJIS_LIMIT));
    if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate(8);
  }, [onInput]);

  // ─── Ref mirror of shiftState so handleKey never recreates ───────────────────
  // This is the key fix: KeyboardMatrix handlers depend only on stable refs,
  // not on shiftState directly — so the matrix never repaints from shift changes.
  const shiftStateRef = useRef<ShiftState>(shiftState);
  shiftStateRef.current = shiftState;

  useEffect(() => {
    if (!newMessage || newMessage.trim() === '') {
      setSuggestions(['', '', '']);
      return;
    }
    const task = setTimeout(() => {
      setSuggestions(getSuggestions(newMessage));
    }, 50);
    return () => clearTimeout(task);
  }, [newMessage]);

  const groupedGifs = useMemo(() => {
    return myGifs.reduce((acc, gif) => {
      const name = gif.packName || 'Recent';
      if (!acc[name]) acc[name] = [];
      acc[name].push(gif.url);
      return acc;
    }, {} as Record<string, string[]>);
  }, [myGifs]);

  // Reads shiftState from ref — stable as long as onInput is stable
  const handleKey = useCallback((key: string, e: React.PointerEvent) => {
    e.preventDefault();
    const current = shiftStateRef.current;
    const isUpper = current === 'shift' || current === 'caps';
    const char = isUpper ? key.toUpperCase() : key.toLowerCase();
    onInput(char);
    if (current === 'shift') setShiftState('off');
    if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate(8);
  }, [onInput]);

  const handleShift = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const now = Date.now();
    if (now - lastShiftTap.current < 250) {
      setShiftState('caps');
    } else {
      setShiftState(prev => prev === 'off' ? 'shift' : 'off');
    }
    lastShiftTap.current = now;
  }, []);

  const startDelete = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    onDelete();
    if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate(8);
    deleteDelayRef.current = setTimeout(() => {
      deleteIntervalRef.current = setInterval(() => {
        onDelete();
        if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate(5);
      }, 70);
    }, 400);
  }, [onDelete]);

  const stopDelete = useCallback(() => {
    if (deleteDelayRef.current) clearTimeout(deleteDelayRef.current);
    if (deleteIntervalRef.current) clearInterval(deleteIntervalRef.current);
  }, []);

  const fetchGifs = async (query: string) => {
    const API_KEY = 'JX6l9HNPFvbDyvn5Uazj0xboLaLtd2ev';
    const endpoint = query && query !== 'trending' ? 'search' : 'trending';
    const url = `https://api.giphy.com/v1/gifs/${endpoint}?api_key=${API_KEY}${query && query !== 'trending' ? `&q=${query}` : ''}&limit=25&rating=g`;
    try {
      const res = await fetch(url);
      const { data } = await res.json();
      setGiphyGifs(data || []);
    } catch (err) {
      console.error("Giphy fetch failed", err);
    }
  };

  // Tapping the paste button opens the clipboard history panel (like
  // Windows' Win+V) instead of blindly pasting the most recent item.
  // Browsers give no way to observe clipboard changes in the background, so
  // the only point we can legally sample it (one user-gesture-triggered
  // readText() call) is right here, on open — that's what feeds new entries
  // into the history over time.
  const handleOpenClipPanel = async () => {
    const opening = !showClipPanel;
    setShowClipPanel(opening);
    if (!opening) return;

    try {
      if (typeof window === 'undefined' || !navigator.clipboard) return;
      const text = await navigator.clipboard.readText();
      if (text && text.trim() !== '' && text !== clipHistory[0]) {
        setClipHistory(prev => [text, ...prev.filter(item => item !== text)].slice(0, CLIP_HISTORY_LIMIT));
        setPasteStatus('success');
        setTimeout(() => setPasteStatus('idle'), 900);
      }
    } catch (err) {
      console.warn("Clipboard access denied or unavailable", err);
      setPasteStatus('denied');
      setTimeout(() => setPasteStatus('idle'), 900);
    }
  };

  const handlePickClip = (text: string) => {
    onInput(text);
    setClipHistory(prev => [text, ...prev.filter(item => item !== text)].slice(0, CLIP_HISTORY_LIMIT));
    if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate([10, 40]);
    setShowClipPanel(false);
  };

  const handleDeleteClipItem = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setClipHistory(prev => prev.filter(item => item !== text));
  };

  const handleClearClipHistory = () => setClipHistory([]);

  useEffect(() => {
    if (mode === 'gif' && gifSubTab === 'discover') fetchGifs(gifSearch || 'trending');
  }, [mode, gifSearch, gifSubTab]);

  const handleRemoveGif = (urlToRemove: string) => {
    setMyGifs(prev => prev.filter(gif => gif.url !== urlToRemove));
    setLongPressedUrl(null);
    if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate([30, 50]);
  };

  const startGifPress = (url: string) => {
    if (gifSubTab !== 'library') return;
    gifTimerRef.current = setTimeout(() => {
      setLongPressedUrl(url);
      if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate(50);
    }, 500);
  };

  const cancelGifPress = () => {
    if (gifTimerRef.current) clearTimeout(gifTimerRef.current);
  };

  const handleGifSend = (url: string) => {
    if (longPressedUrl) return;
    // Sentinel string, same pattern as VIDEO_START/LOCATION_START — lets
    // ChatWindow show a real GIF preview (and later send it as its own
    // message type) instead of dropping the raw URL into the text as if it
    // were something the user typed.
    onInput(`GIF_SELECT:${url}`);
    setMyGifs(prev => [{ url, packName: 'Recent' }, ...prev.filter(item => item.url !== url)].slice(0, 100));
  };

  return (
    <div className={`relative w-full bg-[#FFE4E1]/90 ${isLowPerfMode ? '' : 'backdrop-blur-2xl'} border-t border-[#FFB6C1] p-2 pb-6 select-none transition-all duration-300`}>
      {showClipPanel && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowClipPanel(false)} />
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 z-50 w-72 max-w-[calc(100vw-2rem)] max-h-80 flex flex-col bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-[#FFB6C1] overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-pink-100 shrink-0">
              <div className="flex items-center gap-2">
                <Clipboard className="w-4 h-4 text-pink-500" />
                <span className="text-xs font-black text-[#4B004B] uppercase tracking-widest">Clipboard</span>
              </div>
              <div className="flex items-center gap-1">
                {clipHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearClipHistory}
                    className="text-[9px] font-black text-pink-400 uppercase px-2 py-1 rounded-full hover:bg-pink-50 active:scale-95 transition-all"
                  >
                    Clear all
                  </button>
                )}
                <button type="button" onClick={() => setShowClipPanel(false)} className="p-1 rounded-full text-pink-400 hover:bg-pink-50">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide px-2 py-2 space-y-1">
              {clipHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                  <Clipboard className="w-8 h-8 text-pink-200 mb-2" />
                  <p className="text-[10px] font-black text-[#8B004B]/50 uppercase">Nothing copied yet</p>
                  <p className="text-[9px] text-pink-300 mt-1">Copy some text, then tap paste again</p>
                </div>
              ) : (
                clipHistory.map((item, i) => (
                  <div
                    key={`${item}-${i}`}
                    onClick={() => handlePickClip(item)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-pink-50 active:bg-pink-100 cursor-pointer transition-colors"
                  >
                    <p className="flex-1 text-xs text-[#4B004B] font-medium line-clamp-2 break-words text-left">
                      {item}
                    </p>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteClipItem(item, e)}
                      className="p-1 rounded-full text-pink-300 hover:bg-pink-100 hover:text-pink-500 active:scale-90 transition-all shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}

      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) { onInput(file); setShowMediaBar(false); }
      }} />

      {/* --- PREDICTION & MEDIA BAR --- */}
      <div className="h-14 mb-2">
        {mode === 'abc' ? (
          <div className="h-full flex items-center justify-center px-4 bg-white/20 rounded-xl overflow-hidden relative">
            {showMediaBar ? (
              <div className="flex gap-7 items-center justify-center w-full">
                <button type="button" onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center gap-1 active:scale-90 group">
                  <div className="p-2 bg-white/80 rounded-full text-pink-500"><ImageIcon className="w-4 h-4" /></div>
                  <span className="text-[9px] font-black text-pink-600 uppercase">Gallery</span>
                </button>
                <button type="button" onClick={() => onInput('VIDEO_START')} className="flex flex-col items-center gap-1 active:scale-90 group">
                  <div className="p-2 bg-white/80 rounded-full text-pink-500"><Video className="w-4 h-4" /></div>
                  <span className="text-[9px] font-black text-pink-600 uppercase">Video</span>
                </button>
                <button type="button" onClick={handleOpenClipPanel} className="flex flex-col items-center gap-1 active:scale-90 transition-transform relative">
                  <div className={`p-2 rounded-full transition-all duration-300 ${
                    pasteStatus === 'success' ? 'bg-green-400 text-white scale-110' :
                    pasteStatus === 'denied' ? 'bg-rose-400 text-white scale-110' :
                    showClipPanel ? 'bg-pink-500 text-white scale-110' : 'bg-white/80 text-pink-500'
                  }`}>
                    <Clipboard className="w-4 h-4" />
                  </div>
                  <span className="text-[9px] font-black text-pink-600 uppercase">
                    {pasteStatus === 'success' ? 'Synced!' : pasteStatus === 'denied' ? 'Blocked' : 'Paste'}
                  </span>
                </button>
                <button type="button" onClick={() => onInput('LOCATION_START')} className="flex flex-col items-center gap-1 active:scale-90 group">
                  <div className="p-2 bg-white/80 rounded-full text-pink-500"><MapPin className="w-4 h-4" /></div>
                  <span className="text-[9px] font-black text-pink-600 uppercase">Place</span>
                </button>
                <button type="button" onClick={onDocsClick} className="flex flex-col items-center gap-1 active:scale-90 group">
                  <div className="p-2 bg-white/80 rounded-full text-pink-500"><FileText className="w-4 h-4" /></div>
                  <span className="text-[9px] font-black text-pink-600 uppercase">Docs</span>
                </button>
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                {newMessage.length === 0 ? (
                  <div className="flex gap-4 text-[#8B004B]/40 text-[10px] font-bold tracking-[0.2em]">
                    <span>SWEET</span><Heart className="w-3 h-3 fill-current opacity-30" /><span>MESSAGES</span>
                  </div>
                ) : (
                  <div className="flex w-full justify-around items-center">
                    {suggestions.map((word, index) => word && (
                      <button
                        key={index}
                        onPointerDown={(e) => { e.preventDefault(); onInput(`REPLACE_WORD:${word}`); }}
                        className={`px-3 py-1 rounded-lg text-xs font-black transition-all ${index === 1 ? 'bg-pink-500 text-white scale-105' : 'text-[#8B004B]/50 active:bg-pink-100'}`}
                      >
                        {word.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex gap-2 h-full">
            <button onClick={() => setMode('abc')} className="w-12 h-full bg-white/40 rounded-xl flex items-center justify-center text-[#4B004B] active:bg-pink-200"><ArrowLeft className="w-5 h-5" /></button>
            <div className="flex-1 bg-white/20 rounded-xl flex items-center px-1 gap-1">
              {mode === 'gif' ? (
                <>
                  <button onClick={() => setGifSubTab('library')} className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${gifSubTab === 'library' ? 'bg-pink-500 text-white shadow-md' : 'text-pink-400'}`}>Library</button>
                  <button onClick={() => setGifSubTab('discover')} className={`flex-1 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${gifSubTab === 'discover' ? 'bg-pink-500 text-white shadow-md' : 'text-pink-400'}`}>Discover</button>
                  <button onClick={onOpenGifPanel} className="w-8 h-8 bg-white/40 rounded-lg flex items-center justify-center text-pink-500 active:scale-90 ml-1">
                    <Plus className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <div className="flex-1 flex items-center gap-1 overflow-x-auto scrollbar-hide">
                  {visibleEmojiCategories.map(cat => (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => setEmojiCategory(cat.key)}
                      className={`shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-base transition-all ${
                        emojiCategory === cat.key ? 'bg-pink-500 shadow-md scale-105' : 'opacity-50'
                      }`}
                    >
                      {cat.icon}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setMode(mode === 'emoji' ? 'gif' : 'abc')} className="w-14 h-full bg-gradient-to-tr from-pink-400 to-rose-500 rounded-xl flex items-center justify-center text-white shadow-lg active:scale-95">
              {mode === 'emoji' ? <span className="text-[10px] font-black uppercase">Gif</span> : <Keyboard className="w-5 h-5" />}
            </button>
          </div>
        )}
      </div>

      {/* --- CONTENT KEY MATRIX --- */}
      <div className={mode === 'abc' ? 'h-[160px]' : 'h-[250px]'}>
        <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; } .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }`}</style>

        {mode === 'abc' ? (
          <KeyboardMatrix
            showSymbols={showSymbols}
            shiftState={shiftState}
            onKeyClick={handleKey}
            onShiftClick={handleShift}
            onDeleteStart={startDelete}
            onDeleteStop={stopDelete}
          />
        ) : mode === 'emoji' ? (
          <div className="grid grid-cols-7 gap-1.5 h-full overflow-y-auto scrollbar-hide pr-1 pb-4 content-start">
            {activeEmojiList.map((emoji, i) => (
              <button
                key={`${emoji}-${i}`}
                type="button"
                onPointerDown={(e) => { e.preventDefault(); handleEmojiPick(emoji); }}
                className="text-xl h-9 bg-white/40 rounded-lg flex items-center justify-center active:bg-pink-100"
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col h-full overflow-y-auto scrollbar-hide px-1 pb-4">
            {gifSubTab === 'library' ? (
              <div className="space-y-6">
                {myGifs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <p className="text-[10px] font-black text-[#8B004B]/60 uppercase mb-3">No Gifs added yet.</p>
                    <button onClick={onOpenGifPanel} className="bg-pink-500 text-white px-5 py-2 rounded-2xl text-[9px] font-black uppercase shadow-lg">+ Add Pack</button>
                  </div>
                ) : (
                  Object.entries(groupedGifs).map(([packName, urls]) => (
                    <div key={packName}>
                      <h4 className="text-[10px] font-black uppercase p-2 pt-4 text-pink-500 border-b border-pink-50 mb-2 tracking-widest">{packName}</h4>
                      <div className="columns-2 gap-2">
                        {urls.map((url, i) => (
                          <div key={i} className="relative mb-2 group">
                            <button
                              onPointerDown={() => startGifPress(url)}
                              onPointerUp={cancelGifPress}
                              onPointerLeave={cancelGifPress}
                              onTouchMove={cancelGifPress}
                              onClick={() => handleGifSend(url)}
                              className={`w-full rounded-xl overflow-hidden border-2 transition-all ${longPressedUrl === url ? 'border-pink-500 scale-95' : 'border-white shadow-sm active:scale-95'}`}
                            >
                              <img src={url} className="w-full h-auto block" loading="lazy" />
                              {longPressedUrl === url && (
                                <div className={`absolute inset-0 bg-pink-500/40 ${isLowPerfMode ? '' : 'backdrop-blur-[2px]'} flex items-center justify-center animate-in zoom-in-50`}>
                                  <button onClick={(e) => { e.stopPropagation(); handleRemoveGif(url); }} className="bg-white p-2 rounded-full text-pink-600 shadow-xl scale-110 active:scale-90"><Trash2 className="w-5 h-5" /></button>
                                  <button onClick={(e) => { e.stopPropagation(); setLongPressedUrl(null); }} className="absolute top-1 right-1 bg-white/80 p-1 rounded-full text-gray-500"><X className="w-3 h-3" /></button>
                                </div>
                              )}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              <div className="flex flex-col h-full">
                <div className="relative mb-2">
                  <input type="text" placeholder="Search Giphy..." value={gifSearch} onChange={(e) => setGifSearch(e.target.value)} className="w-full p-2.5 pr-10 rounded-xl bg-white/60 border-none outline-none text-[#4B004B] font-bold text-xs placeholder:text-pink-300" />
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-pink-300" />
                </div>
                <div className="columns-2 gap-2">
                  {giphyGifs.map((gif) => (
                    <div key={gif.id} className="relative group mb-2">
                      <button onClick={() => handleGifSend(gif.images.fixed_height.url)} className="w-full rounded-xl overflow-hidden border-2 border-transparent active:border-pink-300"><img src={gif.images.fixed_height.url} className="w-full h-auto block" loading="lazy" /></button>
                      <button onClick={(e) => { e.stopPropagation(); setMyGifs(prev => [{ url: gif.images.fixed_height.url, packName: 'Recent' }, ...prev]); if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate(10); }} className="absolute top-1 right-1 p-1.5 bg-white/90 rounded-full text-pink-500 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity active:scale-90"><Heart className="w-3 h-3 fill-current" /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* --- FOOTER UTILITIES --- */}
      {mode === 'abc' && (
        <div className="flex justify-center gap-2 mt-1 px-1">
          <button onClick={() => setShowMediaBar(!showMediaBar)} className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${showMediaBar ? 'bg-pink-500 text-white rotate-[135deg]' : 'bg-white/40 text-[#4B004B]'}`}><Paperclip className="w-5 h-5" /></button>
          <button onClick={() => setShowSymbols(!showSymbols)} className="w-12 h-12 bg-white/40 rounded-xl text-[#4B004B] font-black text-[10px]">{showSymbols ? 'ABC' : '123'}</button>
          <button onPointerDown={(e) => { e.preventDefault(); onInput(' '); }} className="flex-1 h-12 bg-white/80 rounded-2xl text-[#4B004B]/40 font-bold text-xs uppercase tracking-widest active:bg-pink-50">Space</button>
          <button onClick={() => setMode('emoji')} className="w-14 h-12 bg-gradient-to-tr from-pink-400 to-rose-500 rounded-2xl flex items-center justify-center text-white shadow-lg"><Smile className="w-6 h-6" /></button>
        </div>
      )}
    </div>
  );
};