import { useState, useRef, useEffect } from 'react';
import { Paperclip, Delete, Heart, ImageIcon, MapPin, FileText, ArrowUpCircle, Clipboard, Video, Smile, Keyboard, Search, ArrowLeft, Plus } from 'lucide-react';
import { getSuggestions } from '../predictionService';

// Updated Interface: myGifs is now an array of objects to support grouping
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
  myGifs: GifItem[]; // Changed from string[]
  setMyGifs: React.Dispatch<React.SetStateAction<GifItem[]>>;
  onDocsClick: () => void;
}

type KeyboardMode = 'abc' | 'emoji' | 'gif';
const EMOJIS = ['❤️', '✨', '🔥', '😂', '🥰', '😊', '😭', '💀', '🥺', '🙌', '👍', '🍦', '🌸', '🎀', '🍭', '🧸', '⚡', '💯', '👋', '🦄'];

export const SweetKeyboard = ({ onInput, onDelete, onDocsClick, newMessage, onOpenGifPanel, myGifs = [], setMyGifs }: SweetKeyboardProps) => {
  const [isCaps, setIsCaps] = useState(false);
  const [showSymbols, setShowSymbols] = useState(false);
  const [showMediaBar, setShowMediaBar] = useState(false);
  const [mode, setMode] = useState<KeyboardMode>('abc');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [suggestions, setSuggestions] = useState<string[]>(['', '', '']);
  const [giphyGifs, setGiphyGifs] = useState<any[]>([]);
  const [gifSearch, setGifSearch] = useState('');
  const [gifSubTab, setGifSubTab] = useState<'library' | 'discover'>('library');

  // Logic to group GIFs by their packName
 const groupedGifs = myGifs.reduce((acc, gif) => {
   const name = gif.packName || 'Recent';
   if (!acc[name]) acc[name] = [];
   acc[name].push(gif.url);
   return acc;
 }, {} as Record<string, string[]>);

 {Object.entries(groupedGifs).map(([packName, urls]) => (
  <div key={packName}>
    <h4 className="text-[10px] font-bold uppercase p-2 text-pink-400">{packName}</h4>
    <div className="grid grid-cols-2 gap-2">
      {urls.map(url => (
        <img key={url} src={url} onClick={() => onInput(url)} />
      ))}
    </div>
  </div>
))}

  const fetchGifs = async (query: string) => {
    const API_KEY = 'JX6l9HNPFvbDyvn5Uazj0xboLaLtd2ev';
    const limit = 25; 
    const endpoint = query && query !== 'trending' ? 'search' : 'trending';
    const url = `https://api.giphy.com/v1/gifs/${endpoint}?api_key=${API_KEY}${query && query !== 'trending' ? `&q=${query}` : ''}&limit=${limit}&rating=g`;
    
    try {
      const res = await fetch(url);
      const { data } = await res.json();
      setGiphyGifs(data || []);
    } catch (err) {
      console.error("Giphy fetch failed", err);
    }
  };

  useEffect(() => {
    if (mode === 'gif' && gifSubTab === 'discover') {
      fetchGifs(gifSearch || 'trending');
    }
  }, [mode, gifSearch, gifSubTab]);

  const handleGifSend = (url: string) => {
    onInput(url);
    // When a GIF is sent, it moves to the "Recent" pack
    setMyGifs(prev => {
      const filtered = prev.filter(item => item.url !== url);
      return [{ url, packName: 'Recent' }, ...filtered].slice(0, 100);
    });
  };

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
    <div className="w-full bg-[#FFE4E1]/90 backdrop-blur-2xl border-t border-[#FFB6C1] p-2 pb-6 select-none transition-all duration-300 touch-none">
      <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) { onInput(file); setShowMediaBar(false); }
      }} />

      {/* --- CONTEXTUAL TOP ROW --- */}
      <div className="h-14 mb-2">
        {mode === 'abc' ? (
          <div className="h-full flex items-center justify-center px-4 bg-white/20 rounded-xl overflow-hidden relative animate-in fade-in slide-in-from-top-2">
            {showMediaBar ? (
              <div className="flex gap-7 items-center justify-center w-full">
                <button type="button" onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center gap-1 active:scale-90 group">
                  <div className="p-2 bg-white/80 rounded-full text-pink-500 group-active:bg-pink-500 group-active:text-white"><ImageIcon className="w-4 h-4" /></div>
                  <span className="text-[9px] font-black text-pink-600 uppercase">Gallery</span>
                </button>
                <button type="button" onClick={() => onInput('VIDEO_START')} className="flex flex-col items-center gap-1 active:scale-90 group">
                  <div className="p-2 bg-white/80 rounded-full text-pink-500 group-active:bg-pink-500 group-active:text-white"><Video className="w-4 h-4" /></div>
                  <span className="text-[9px] font-black text-pink-600 uppercase">Video</span>
                </button>
                <button className="flex flex-col items-center gap-1 active:scale-90 group">
                  <div className="p-2 bg-white/80 rounded-full text-pink-500 group-active:bg-pink-500 group-active:text-white"><Clipboard className="w-4 h-4" /></div>
                  <span className="text-[9px] font-black text-pink-600 uppercase">Clip</span>
                </button>
                <button type="button" onClick={() => onInput('LOCATION_START')} className="flex flex-col items-center gap-1 active:scale-90 group">
                  <div className="p-2 bg-white/80 rounded-full text-pink-500 group-active:bg-pink-500 group-active:text-white"><MapPin className="w-4 h-4" /></div>
                  <span className="text-[9px] font-black text-pink-600 uppercase">Place</span>
                </button>
                <button type="button" onClick={onDocsClick} className="flex flex-col items-center gap-1 active:scale-90 group">
                  <div className="p-2 bg-white/80 rounded-full text-pink-500 group-active:bg-pink-500 group-active:text-white"><FileText className="w-4 h-4" /></div>
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
        ) : (
          <div className="flex gap-2 h-full animate-in slide-in-from-top-2">
             <button onClick={() => setMode(mode === 'gif' ? 'emoji' : 'abc')} className="w-12 h-full bg-white/40 rounded-xl flex items-center justify-center text-[#4B004B] active:bg-pink-200 transition-all">
                <ArrowLeft className="w-5 h-5" />
             </button>
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
                  <span className="flex-1 text-center text-[10px] font-black text-pink-500 uppercase tracking-[0.2em]">Emojis</span>
                )}
             </div>
             <button onClick={() => setMode(mode === 'emoji' ? 'gif' : 'abc')} className="w-14 h-full bg-gradient-to-tr from-pink-400 to-rose-500 rounded-xl flex items-center justify-center text-white shadow-lg active:scale-95">
                {mode === 'emoji' ? <span className="text-[10px] font-black uppercase">Gif</span> : <Keyboard className="w-5 h-5" />}
             </button>
          </div>
        )}
      </div>

      {/* --- CONTENT AREA --- */}
      <div className={`transition-all duration-300 ${mode === 'abc' ? 'h-[160px]' : 'h-[250px]'}`}>
        <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; } .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }`}</style>
        
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
          <div className="grid grid-cols-5 gap-2 h-full p-1 overflow-y-auto scrollbar-hide animate-in slide-in-from-bottom-3">
            {EMOJIS.map(emoji => (
              <button key={emoji} onClick={() => onInput(emoji)} className="text-2xl h-12 bg-white/40 rounded-xl flex items-center justify-center active:bg-pink-100">{emoji}</button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col h-full animate-in slide-in-from-bottom-3">
            <div className="flex-1 overflow-y-auto scrollbar-hide px-1 pb-4">
              {gifSubTab === 'library' ? (
                <div className="space-y-6">
                  {myGifs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <p className="text-[10px] font-black text-[#8B004B]/60 uppercase mb-3">No Gifs added yet.</p>
                      <button onClick={onOpenGifPanel} className="bg-pink-500 text-white px-5 py-2 rounded-2xl text-[9px] font-black uppercase shadow-lg">+ Add Pack</button>
                    </div>
                  ) : (
                    Object.entries(groupedGifs).map(([packName, urls]) => (
                      <div key={packName} className="animate-in fade-in slide-in-from-left-2">
                        {/* Group Heading */}
                        <div className="flex items-center gap-2 mb-3 px-1">
                          <h4 className="text-[10px] font-black uppercase p-2 pt-4 text-pink-500 border-b border-pink-50 mb-2 tracking-widest">
                            {packName}
                          </h4>
                          <div className="h-[1px] flex-1 bg-pink-200/50"></div>
                        </div>
                        {/* Group Grid */}
                        <div className="columns-2 gap-2">
                          {urls.map((url, i) => (
                            <button key={i} onClick={() => handleGifSend(url)} className="mb-2 w-full rounded-xl overflow-hidden border-2 border-white shadow-sm active:scale-95 transition-transform">
                              <img src={url} className="w-full h-auto block" alt="saved" />
                            </button>
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
                        <button onClick={() => handleGifSend(gif.images.fixed_height.url)} className="w-full rounded-xl overflow-hidden border-2 border-transparent active:border-pink-300"><img src={gif.images.fixed_height.url} className="w-full h-auto block" /></button>
                        <button onClick={(e) => { e.stopPropagation(); setMyGifs(prev => [{url: gif.images.fixed_height.url, packName: 'Recent'}, ...prev]); }} className="absolute top-1 right-1 p-1 bg-white/80 rounded-full text-pink-500 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"><Heart className="w-3 h-3 fill-current" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* --- FOOTER ROW --- */}
      {mode === 'abc' && (
        <div className="flex justify-center gap-2 mt-1 px-1 animate-in fade-in">
          <button onClick={() => setShowMediaBar(!showMediaBar)} className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${showMediaBar ? 'bg-pink-500 text-white rotate-[135deg]' : 'bg-white/40 text-[#4B004B]'}`}><Paperclip className="w-5 h-5" /></button>
          <button onClick={() => setShowSymbols(!showSymbols)} className="w-12 h-12 bg-white/40 rounded-xl text-[#4B004B] font-black text-[10px]">{showSymbols ? 'ABC' : '123'}</button>
          <button onClick={() => onInput(' ')} className="flex-1 h-12 bg-white/80 rounded-2xl text-[#4B004B]/40 font-bold text-xs uppercase tracking-widest active:bg-pink-50">Sweet Space</button>
          <button onClick={() => setMode('emoji')} className="w-14 h-12 bg-gradient-to-tr from-pink-400 to-rose-500 rounded-2xl flex items-center justify-center text-white shadow-lg active:scale-95"><Smile className="w-6 h-6" /></button>
        </div>
      )}
    </div>
  );
};