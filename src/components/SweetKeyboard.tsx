import { useState, useRef, useEffect } from 'react';
import { Paperclip, Delete, Heart, ImageIcon, MapPin, FileText, ArrowUpCircle, Clipboard, Video, Smile, Keyboard } from 'lucide-react';
import { getSuggestions } from '../predictionService';

interface SweetKeyboardProps {
  onInput: (char: string | File | Blob) => void;
  onDelete: () => void;
  onSend: () => void;
  newMessage: string;
  onDocsClick: () => void;
}

type KeyboardMode = 'abc' | 'emoji' | 'gif';
const EMOJIS = ['❤️', '✨', '🔥', '😂', '🥰', '😊', '😭', '💀', '🥺', '🙌', '👍', '🍦', '🌸', '🎀', '🍭', '🧸', '⚡', '💯', '👋', '🦄'];

export const SweetKeyboard = ({ onInput, onDelete, onDocsClick, newMessage }: SweetKeyboardProps) => {
  const [isCaps, setIsCaps] = useState(false);
  const [showSymbols, setShowSymbols] = useState(false);
  const [showMediaBar, setShowMediaBar] = useState(false);
  const [mode, setMode] = useState<KeyboardMode>('abc');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [suggestions, setSuggestions] = useState<string[]>(['', '', '']);
  const [giphyGifs, setGiphyGifs] = useState<any[]>([]);
  const [gifSearch, setGifSearch] = useState('');
  const [myGifs, setMyGifs] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const fetchGifs = async (query: string) => {
    const API_KEY = 'JX6l9HNPFvbDyvn5Uazj0xboLaLtd2ev';
    const limit = 25; // Increased limit for better UI
    const endpoint = query && query !== 'trending' ? 'search' : 'trending';
    const url = `https://api.giphy.com/v1/gifs/${endpoint}?api_key=${API_KEY}${query ? `&q=${query}` : ''}&limit=${limit}&rating=g`;
    
    try {
      const res = await fetch(url);
      const { data } = await res.json();
      setGiphyGifs(data || []);
    } catch (err) {
      console.error("Giphy fetch failed", err);
    }
  };

  useEffect(() => {
    if (mode === 'gif') {
      fetchGifs(gifSearch || 'trending');
    }
  }, [mode, gifSearch]);

  const handleKey = (key: string) => {
    const char = isCaps ? key.toUpperCase() : key.toLowerCase();
    onInput(char);
    if (isCaps) setIsCaps(false);
    if (typeof window !== 'undefined' && navigator.vibrate) navigator.vibrate(10);
  };

  const rows = showSymbols 
    ? [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'], ['.', ',', '?', '!', "'"]]
    : [['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'], ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'], ['Z', 'X', 'C', 'V', 'B', 'N', 'M']];

  useEffect(() => {
    setSuggestions(getSuggestions(newMessage));
  }, [newMessage]);

  return (
    <div className="w-full bg-[#FFE4E1]/90 backdrop-blur-2xl border-t border-[#FFB6C1] p-2 pb-6 select-none transition-all duration-300">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) { onInput(file); setShowMediaBar(false); }
      }} />

      {/* TOP BAR: Only shows in ABC mode to save space for GIFs/Emojis */}
      {mode === 'abc' && (
        <div className="h-14 flex items-center justify-center mb-2 px-4 bg-white/20 rounded-xl overflow-hidden relative animate-in fade-in slide-in-from-top-2">
          {showMediaBar ? (
            <div className="flex gap-7 items-center justify-center w-full">
              <button type="button" onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center gap-1 active:scale-90 group">
                <div className="p-2 bg-white/80 rounded-full text-pink-500 group-active:bg-pink-500 group-active:text-white"><ImageIcon className="w-4 h-4" /></div>
                <span className="text-[9px] font-black text-pink-600">GALLERY</span>
              </button>
              <button type="button" onClick={() => onInput('VIDEO_START')} className="flex flex-col items-center gap-1 active:scale-90 group">
                <div className="p-2 bg-white/80 rounded-full text-pink-500 group-active:bg-pink-500 group-active:text-white"><Video className="w-4 h-4" /></div>
                <span className="text-[9px] font-black text-pink-600">VIDEO</span>
              </button>
              <button className="flex flex-col items-center gap-1 active:scale-90 group">
                <div className="p-2 bg-white/80 rounded-full text-pink-500 group-active:bg-pink-500 group-active:text-white"><Clipboard className="w-4 h-4" /></div>
                <span className="text-[9px] font-black text-pink-600">CLIP</span>
              </button>
              <button type="button" onClick={() => onInput('LOCATION_START')} className="flex flex-col items-center gap-1 active:scale-90 group">
                <div className="p-2 bg-white/80 rounded-full text-pink-500 group-active:bg-pink-500 group-active:text-white"><MapPin className="w-4 h-4" /></div>
                <span className="text-[9px] font-black text-pink-600">PLACE</span>
              </button>
              <button type="button" onClick={onDocsClick} className="flex flex-col items-center gap-1 active:scale-90 group">
                <div className="p-2 bg-white/80 rounded-full text-pink-500 group-active:bg-pink-500 group-active:text-white"><FileText className="w-4 h-4" /></div>
                <span className="text-[9px] font-black text-pink-600">DOCS</span>
              </button>
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              {newMessage.length === 0 ? (
                <div className="flex gap-4 text-[#8B004B]/40 text-[10px] font-bold tracking-[0.2em]">
                  <span>SWEET</span><Heart className="w-3 h-3 fill-current opacity-30" /><span>MESSAGES</span>
                </div>
              ) : (
                <div className="flex w-full justify-around items-center animate-in slide-in-from-top-2">
                  {suggestions.map((word, index) => (
                    <button key={index} onClick={() => onInput(`REPLACE_WORD:${word}`)} className={`px-3 py-1 rounded-lg text-xs font-black transition-all ${index === 1 ? 'bg-pink-500 text-white scale-110' : 'text-[#8B004B]/50'}`}>
                      {word.toUpperCase()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* MAIN CONTENT AREA: Expands when top bar is hidden */}
      <div className={`transition-all duration-300 ${mode === 'abc' ? 'h-[160px]' : 'h-[220px]'}`}>
        {mode === 'abc' ? (
          <div className="animate-in fade-in duration-200">
            <div className="flex justify-center gap-1 mb-2">
              {rows[0].map(k => <button key={k} onClick={() => handleKey(k)} className="flex-1 h-11 bg-white/60 rounded-xl text-[#4B004B] font-bold shadow-sm active:bg-pink-200">{k}</button>)}
            </div>
            <div className="flex justify-center gap-1 mb-2 px-[4%]">
              {rows[1].map(k => <button key={k} onClick={() => handleKey(k)} className="flex-1 h-11 bg-white/60 rounded-xl text-[#4B004B] font-bold shadow-sm active:bg-pink-200">{k}</button>)}
            </div>
            <div className="flex justify-center gap-1">
              <button onClick={() => setIsCaps(!isCaps)} className={`w-[14%] h-11 rounded-xl flex items-center justify-center transition-all ${isCaps ? 'bg-pink-500 text-white' : 'bg-white/40 text-[#4B004B]'}`}><ArrowUpCircle className="w-5 h-5" /></button>
              {rows[2].map(k => <button key={k} onClick={() => handleKey(k)} className="flex-1 h-11 bg-white/60 rounded-xl text-[#4B004B] font-bold shadow-sm active:bg-pink-200">{k}</button>)}
              <button onClick={onDelete} className="w-[14%] h-11 bg-white/40 rounded-xl flex items-center justify-center text-[#4B004B] active:bg-pink-200"><Delete className="w-5 h-5" /></button>
            </div>
          </div>
        ) : mode === 'emoji' ? (
          <div className="grid grid-cols-5 gap-2 h-full p-1 overflow-y-auto animate-in slide-in-from-bottom-3">
            {EMOJIS.map(emoji => (
              <button key={emoji} onClick={() => onInput(emoji)} className="text-2xl h-12 bg-white/40 rounded-xl flex items-center justify-center active:bg-pink-100">{emoji}</button>
            ))}
          </div>
) : (
  <div className="flex flex-col h-full animate-in slide-in-from-bottom-3">
    
    {/* SEARCH BOX WITH "ADD" BUTTON */}
    <div className="px-1 mb-2 flex gap-2">
      <div className="relative flex-1">
        <input 
          type="text"
          placeholder="Search GIPHY..."
          value={gifSearch}
          onChange={(e) => {
            setGifSearch(e.target.value);
            setIsSearching(e.target.value.length > 0);
          }}
          className="w-full p-2 pr-10 text-[11px] rounded-xl bg-white/50 border-none outline-none text-pink-900 placeholder:text-pink-300 font-bold"
        />
        {/* THE "ADD PACK" BUTTON */}
        <button 
          onClick={() => {
            const packName = prompt("Enter a GIF Pack Name or Tag (e.g. 'Anime', 'Cute'):");
            if (packName) setGifSearch(packName); 
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-pink-500 active:scale-90"
        >
          <Paperclip className="w-4 h-4" />
        </button>
      </div>
    </div>

    <div className="block w-full overflow-y-auto flex-1 pb-4 scrollbar-hide px-1">
      <div className="columns-2 gap-2 w-full">
        
        {/* SECTION 1: USER'S OWN GIFS (Only show if not searching) */}
        {!isSearching && myGifs.length > 0 && (
          <>
            <div className="col-span-2 text-[8px] font-black text-pink-400 uppercase mb-2 px-1 tracking-widest">My Collection</div>
            {myGifs.map((url, idx) => (
              <div key={`my-${idx}`} className="break-inside-avoid mb-2 w-full relative group"> 
                <button onClick={() => onInput(url)} className="w-full bg-pink-100/50 rounded-xl overflow-hidden block border-2 border-white">
                  <img src={url} className="w-full h-auto block" />
                </button>
              </div>
            ))}
            <div className="col-span-2 border-t border-pink-200 my-4"></div>
          </>
        )}

        {/* SECTION 2: SEARCHED GIFS */}
        <div className="col-span-2 text-[8px] font-black text-pink-400 uppercase mb-2 px-1 tracking-widest">
          {isSearching ? 'Search Results' : 'Trending'}
        </div>
        
        {giphyGifs.map((gif) => (
          <div key={gif.id} className="break-inside-avoid mb-2 w-full relative"> 
            <button 
              onClick={() => onInput(gif.images.fixed_height.url)} 
              className="w-full bg-white/10 rounded-xl overflow-hidden block"
            >
              <img src={gif.images.fixed_height.url} className="w-full h-auto block" />
            </button>
            {/* BUTTON TO ADD TO PERSONAL COLLECTION */}
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setMyGifs([gif.images.fixed_height.url, ...myGifs]);
              }}
              className="absolute top-1 right-1 p-1 bg-white/80 rounded-full text-pink-500 shadow-sm active:scale-125 transition-transform"
            >
              <Heart className="w-3 h-3 fill-current" />
            </button>
          </div>
        ))}
      </div>
    </div>
  </div>
)}
      </div>

      {/* BOTTOM CONTROL ROW */}
      <div className="flex justify-center gap-2 mt-1 px-1">
        <button onClick={() => setShowMediaBar(!showMediaBar)} className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${showMediaBar ? 'bg-pink-500 text-white rotate-[135deg]' : 'bg-white/40 text-[#4B004B]'}`}><Paperclip className="w-5 h-5" /></button>
        <button onClick={() => { setMode('abc'); setShowSymbols(!showSymbols); }} className="w-12 h-12 bg-white/40 rounded-xl text-[#4B004B] font-black text-[10px]">{showSymbols ? 'ABC' : '123'}</button>
        
        <button 
          onClick={() => mode === 'abc' ? onInput(' ') : setMode('abc')} 
          className="flex-1 h-12 bg-white/80 rounded-2xl text-[#4B004B]/40 font-bold text-xs uppercase tracking-widest"
        >
          {mode === 'abc' ? 'Sweet Space' : <div className="flex items-center justify-center gap-2"><Keyboard className="w-4 h-4" /> ABC</div>}
        </button>

        <button 
          onClick={() => setMode(mode === 'emoji' ? 'gif' : 'emoji')}
          className="w-14 h-12 bg-gradient-to-tr from-pink-400 to-rose-500 rounded-2xl flex flex-col items-center justify-center text-white shadow-lg active:scale-95"
        >
          {mode === 'emoji' ? <span className="text-[10px] font-black">GIF</span> : <Smile className="w-6 h-6" />}
        </button>
      </div>
    </div>
  );
};