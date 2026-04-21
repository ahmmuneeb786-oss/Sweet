import { useState, useEffect } from 'react';
import { useAuth, AuthProvider } from './contexts/AuthContext';
import { Auth } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { initializeDictionary } from './predictionService';
import { Heart, Paperclip, X, Search } from 'lucide-react'; 

// Define the interface for our GIF objects
export interface GifItem {
  url: string;
  packName: string;
}

function AppContent() {
  const { user, loading } = useAuth();
  
  // --- STATES ---
  const [showGifPanel, setShowGifPanel] = useState(false);
  const [gifSearch, setGifSearch] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark' | 'romantic'>('light');
  
  // Updated storage to handle objects instead of just strings
  const [myGifs, setMyGifs] = useState<GifItem[]>(() => {
    const saved = localStorage.getItem('sweet_user_gifs');
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    // Migration logic: If old data was just strings, convert them to "Recent" objects
    return parsed.map((item: any) => 
      typeof item === 'string' ? { url: item, packName: 'Recent' } : item
    );
  });

  const [previewGifs, setPreviewGifs] = useState<any[]>([]);
  const [lastSearchQuery, setLastSearchQuery] = useState('');

  // --- INITIALIZATION ---
  useEffect(() => {
    initializeDictionary();
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | 'romantic';
    if (savedTheme) setTheme(savedTheme);
  }, []);

  // Persistence
  useEffect(() => {
    localStorage.setItem('sweet_user_gifs', JSON.stringify(myGifs));
  }, [myGifs]);

  useEffect(() => {
    localStorage.setItem('theme', theme);
  }, [theme]);

  // --- GIF LOGIC ---
  
  const handleAddFullPack = () => {
    if (previewGifs.length === 0) return;

    // Use the last search term or "Imported Pack" as the heading
    const packName = lastSearchQuery || "Imported Pack";

    const newGifs: GifItem[] = previewGifs.map(gif => ({
      url: gif.images?.fixed_height?.url || gif,
      packName: packName
    }));

    setMyGifs(prev => {
      const existingUrls = prev.map(g => g.url);
      const uniqueNewGifs = newGifs.filter(g => !existingUrls.includes(g.url));
      return [...uniqueNewGifs, ...prev];
    });

    alert(`Added "${packName}" pack to your library!`);
  };

const handleGifAction = async (input: string) => {
  if (!input.trim()) return;

  const isUrl = input.match(/\.(jpeg|jpg|gif|png|webp)$/i) || input.includes('giphy.com/media');

  if (isUrl) {
    // For direct links, "Recent" is fine as a default
    setMyGifs(prev => [{ url: input, packName: 'Recent' }, ...prev]);
    setGifSearch('');
  } else {
    const API_KEY = 'JX6l9HNPFvbDyvn5Uazj0xboLaLtd2ev';
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${API_KEY}&q=${encodeURIComponent(input)}&limit=20&rating=g`;
    
    try {
      const res = await fetch(url);
      const { data } = await res.json();
      setPreviewGifs(data || []);
      // STICKY FIX: Save the search term so handleAddFullPack can use it!
      setLastSearchQuery(input); 
    } catch (err) {
      console.error("Fetch failed", err);
    }
  }
};

if (loading) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#FFF0F3] overflow-hidden relative">
      
      {/* ADDITION: Background Floating Particles (Sweet & Subtle) */}
      <div className="absolute inset-0 pointer-events-none">
        <Heart className="absolute top-[15%] left-[10%] w-8 h-8 text-pink-200/40 animate-pulse" />
        <Heart className="absolute top-[20%] right-[15%] w-6 h-6 text-pink-200/30 animate-bounce [animation-duration:3s]" />
        <Heart className="absolute bottom-[25%] left-[20%] w-10 h-10 text-pink-200/20 animate-pulse [animation-duration:4s]" />
        <Heart className="absolute bottom-[10%] right-[12%] w-5 h-5 text-pink-200/50 animate-bounce [animation-duration:5s]" />
      </div>

      <div className="relative flex flex-col items-center">
        
        {/* Your Orbiting Hearts (Kept exactly as is) */}
        <div className="absolute inset-0 flex items-center justify-center animate-[spin_8s_linear_infinite]">
          <Heart className="w-4 h-4 text-pink-300 absolute -top-14 opacity-60" />
          <Heart className="w-4 h-4 text-pink-300 absolute -bottom-14 opacity-60" />
          <Heart className="w-4 h-4 text-pink-300 absolute -left-14 opacity-60" />
          <Heart className="w-4 h-4 text-pink-300 absolute -right-14 opacity-60" />
        </div>

        {/* Your Main White Squircle Container (Kept exactly as is) */}
        <div className="relative z-10 w-32 h-32 bg-white rounded-[40px] shadow-2xl shadow-pink-200/50 flex items-center justify-center mb-8 border border-white transition-transform duration-500 hover:scale-105">
          <div className="relative">
            {/* The Wave Effect (Your favorite part!) */}
            <Heart 
              className="w-16 h-16 text-pink-200 fill-pink-100 absolute -top-1 -right-1 opacity-60 animate-[bounce_1.8s_infinite_ease-in-out]" 
              style={{ animationDelay: '0.15s' }} 
            />
            <Heart className="relative z-10 w-16 h-16 text-[#FF69B4] fill-[#FF69B4] drop-shadow-xl animate-[bounce_1.8s_infinite_ease-in-out]" />
          </div>
        </div>

        {/* Text Branding Section */}
        <div className="text-center space-y-2 mt-4">
          <h1 className="text-2xl font-black tracking-[0.4em] text-[#FF1493] uppercase">
            Sweet Chat
          </h1>
          <div className="flex flex-col items-center gap-1">
            <p className="text-pink-400/80 text-xs font-medium italic animate-pulse">
              Preparing your inbox...
            </p>
            {/* Minimalist Progress Loader */}
            <div className="w-12 h-[2px] bg-pink-100 rounded-full overflow-hidden">
              <div className="h-full bg-pink-400 w-1/2 rounded-full animate-[loading_1.5s_infinite_ease-in-out]"></div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes loading {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
      `}</style>
    </div>
  );
}

  if (!user) {
    return (
      <div className={theme === 'dark' ? 'dark' : ''}>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
          <Auth />
        </div>
      </div>
    );
  }

  return (
    <div className={theme === 'dark' ? 'dark' : theme === 'romantic' ? 'romantic-theme' : ''}>
      <div className={`min-h-screen transition-colors duration-300 ${
        theme === 'dark' ? 'bg-gray-900 text-white' : theme === 'romantic' ? 'bg-[#FFE4E1] text-[#4B004B]' : 'bg-gray-50 text-gray-900'
      }`}>
        
        <Dashboard 
          theme={theme} 
          setTheme={setTheme} 
          onOpenGifPanel={() => setShowGifPanel(true)}
          myGifs={myGifs}
          setMyGifs={setMyGifs}
        />

        {/* --- GIF STUDIO MODAL --- */}
        {showGifPanel && (
          <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-0 md:p-4 animate-in fade-in duration-300">
            <div className="absolute inset-0 bg-pink-900/20 backdrop-blur-md" onClick={() => setShowGifPanel(false)} />

            <div className="relative w-full max-w-lg h-[80vh] bg-white/95 backdrop-blur-2xl rounded-t-[32px] md:rounded-[32px] shadow-2xl border border-white/50 flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 duration-500">
              
              <div className="p-4 border-b border-pink-100 flex justify-between items-center bg-white/50">
                <div className="flex flex-col">
                  <h3 className="text-pink-600 font-black text-xs tracking-widest uppercase">GIF Studio</h3>
                  <span className="text-[10px] text-pink-400 font-bold">Search or add your pack</span>
                </div>
                
                <div className="flex items-center gap-2">
                  {previewGifs.length > 0 && (
                    <button 
                      onClick={handleAddFullPack}
                      className="px-3 py-1.5 bg-pink-500 text-white text-[10px] font-black uppercase rounded-full hover:bg-pink-600 shadow-sm transition-all flex items-center gap-1"
                    >
                      <Heart className="w-3 h-3 fill-current" />
                      Save Pack
                    </button>
                  )}

                  <button 
                    onClick={() => setShowGifPanel(false)}
                    className="w-8 h-8 flex items-center justify-center bg-pink-50 text-pink-500 rounded-full hover:bg-pink-500 hover:text-white transition-all"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-4 space-y-3">
                  <div className="relative">
                    <input 
                      type="text"
                      placeholder="Search Giphy Packs or Paste Link..."
                      value={gifSearch}
                      className="w-full p-4 pr-12 rounded-2xl bg-pink-50 border-none outline-none text-pink-900 placeholder:text-pink-300 font-bold text-sm shadow-inner"
                      onChange={(e) => setGifSearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleGifAction(gifSearch)}
                    />
                    <button onClick={() => handleGifAction(gifSearch)} className="absolute right-4 top-1/2 -translate-y-1/2 text-pink-400 hover:text-pink-600 active:scale-90 transition-transform">
                      {gifSearch.startsWith('http') ? <Paperclip className="w-5 h-5" /> : <Search className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-4 pb-6 scrollbar-hide">
                  {previewGifs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 opacity-30">
                      <div className="w-20 h-20 bg-pink-100 rounded-full flex items-center justify-center mb-4">
                        <Heart className="w-10 h-10 text-pink-500 fill-current" />
                      </div>
                      <p className="font-black text-xs text-pink-900 uppercase tracking-tighter">Search to preview a pack</p>
                    </div>
                  ) : (
                    <div className="columns-2 gap-3 space-y-3 pt-2">
                       {previewGifs.map((gif, index) => {
                         const gifUrl = gif.images?.fixed_height?.url || gif;
                         return (
                           <div key={gif.id || index} className="relative group overflow-hidden rounded-xl border-2 border-white shadow-sm">
                             <img src={gifUrl} className="w-full h-auto block" alt="Gif" />
                             <button 
                               onClick={() => {
                                 setMyGifs(prev => {
                                   if (prev.some(g => g.url === gifUrl)) return prev;
                                   return [{ url: gifUrl, packName: lastSearchQuery || 'Recent' }, ...prev];
                                 });
                                 alert("Added to Library!");
                               }}
                               className="absolute inset-0 bg-pink-500/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                             >
                               <Heart className="text-white fill-current w-6 h-6" />
                             </button>
                           </div>
                         );
                       })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}