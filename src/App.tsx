import { useState, useEffect } from 'react';
import { useAuth, AuthProvider } from './contexts/AuthContext';
import { Auth } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { initializeDictionary } from './predictionService';
import { Heart, Paperclip, X } from 'lucide-react'; // Added X for the close button

function AppContent() {
  const { user, loading } = useAuth();
  
  // --- THE BIG THREE STATES ---
  const [showGifPanel, setShowGifPanel] = useState(false);
  const [gifSearch, setGifSearch] = useState('');
  const [myGifs, setMyGifs] = useState<string[]>([]);

  const [theme, setTheme] = useState<'light' | 'dark' | 'romantic'>('light');

  useEffect(() => {
    initializeDictionary();
  }, []);

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | 'romantic';
    if (savedTheme) setTheme(savedTheme);
  }, []);

  useEffect(() => {
    localStorage.setItem('theme', theme);
  }, [theme]);

  const handleAddExternalPack = async (input: string) => {
    if (!input) return;
    if (input.startsWith('http')) {
      try {
        const response = await fetch(input);
        const urls = await response.json(); 
        setMyGifs((prev) => [...urls, ...prev]);
      } catch (err) {
        console.error("Failed to fetch pack link", err);
      }
    } else {
      setGifSearch(input); 
    }
  };

  // 1. Loading State
  if (loading) {
    return (
      <div className={theme === 'dark' ? 'dark' : ''}>
        <div className={`min-h-screen flex items-center justify-center transition-colors duration-300 ${
          theme === 'romantic' ? 'bg-[#FFE4E1]' : 'bg-gradient-to-br from-pink-50 via-purple-50 to-blue-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-700'
        }`}>
          <div className="text-center space-y-4">
            <div className={`w-16 h-16 border-4 border-pink-500 border-t-transparent rounded-full animate-spin mx-auto`} />
            <p className="font-medium text-gray-600">Loading Sweet...</p>
          </div>
        </div>
      </div>
    );
  }

  // 2. Auth State
  if (!user) {
    return (
      <div className={theme === 'dark' ? 'dark' : ''}>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
          <Auth />
        </div>
      </div>
    );
  }

  // 3. Main App State
  return (
    <div className={theme === 'dark' ? 'dark' : theme === 'romantic' ? 'romantic-theme' : ''}>
      <div className={`min-h-screen transition-colors duration-300 ${
        theme === 'dark' ? 'bg-gray-900 text-white' : theme === 'romantic' ? 'bg-[#FFE4E1] text-[#4B004B]' : 'bg-gray-50 text-gray-900'
      }`}>
        
        {/* Pass the set function to Dashboard so it can open the panel */}
        <Dashboard 
          theme={theme} 
          setTheme={setTheme} 
          onOpenGifPanel={() => setShowGifPanel(true)} 
        />

        {/* --- GIF STUDIO PANEL (Moved inside the return) --- */}
        {showGifPanel && (
          <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-0 md:p-4 animate-in fade-in duration-300">
            <div 
              className="absolute inset-0 bg-pink-900/20 backdrop-blur-md"
              onClick={() => setShowGifPanel(false)}
            />

            <div className="relative w-full max-w-lg h-[80vh] bg-white/95 backdrop-blur-2xl rounded-t-[32px] md:rounded-[32px] shadow-2xl border border-white/50 flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 duration-500">
              
              <div className="p-4 border-b border-pink-100 flex justify-between items-center bg-white/50">
                <div className="flex flex-col">
                  <h3 className="text-pink-600 font-black text-xs tracking-widest uppercase">GIF Studio</h3>
                  <span className="text-[10px] text-pink-400 font-bold">Search or add your pack</span>
                </div>
                <button 
                  onClick={() => setShowGifPanel(false)}
                  className="w-8 h-8 flex items-center justify-center bg-pink-50 text-pink-500 rounded-full hover:bg-pink-500 hover:text-white transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
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
                    />
                    <button 
                      onClick={() => handleAddExternalPack(gifSearch)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-pink-400 hover:text-pink-600 active:scale-90 transition-transform"
                    >
                      <Paperclip className="w-5 h-5" />
                    </button>
                  </div>
                  <p className="text-[10px] text-center text-pink-300 font-black uppercase tracking-widest">
                    Paste a GIF pack URL to import instantly
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto px-4 pb-6">
                  {myGifs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 opacity-30">
                      <div className="w-20 h-20 bg-pink-100 rounded-full flex items-center justify-center mb-4">
                        <Heart className="w-10 h-10 text-pink-500 fill-current" />
                      </div>
                      <p className="font-black text-xs text-pink-900 uppercase tracking-tighter">Search for a pack to see previews</p>
                    </div>
                  ) : (
                    <div className="columns-2 gap-3 space-y-3">
                       {myGifs.map((url, i) => (
                         <img key={i} src={url} className="w-full rounded-xl border-2 border-white shadow-sm" alt="Gif" />
                       ))}
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