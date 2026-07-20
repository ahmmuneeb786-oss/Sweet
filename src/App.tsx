import { useState, useEffect } from 'react';
import { useAuth, AuthProvider } from './contexts/AuthContext';
import { NotificationProvider, useNotify } from './contexts/NotificationContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { PerformanceProvider } from './contexts/PerformanceContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Auth } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { initializeDictionary } from './predictionService';
import { Heart, Paperclip, X, Search } from 'lucide-react';
import { FloatingHearts } from './components/FloatingHearts';
import { StrictLock } from './components/StrictLock';
import { supabase } from './lib/supabase';
import { useHeartbeat } from './hooks/useHeartbeat';
import { usePresence } from './hooks/usePresence';
import { useOfflineSync } from './hooks/useOfflineSync';
import { useMessageSync, catchUpMessages, waitAtMost } from './hooks/useMessageSync';
import { useChatsReady } from './hooks/useChatsReady';
import { localDB } from './db';
import { preloadFaceModels } from './lib/faceModels';

// Define the interface for our GIF objects
export interface GifItem {
  url: string;
  packName: string;
}

export function useAnonymousVisitTracker() {
  useEffect(() => {
    async function trackVisit() {
      try {
        let visitorId = localStorage.getItem('app_visitor_id');

        if (!visitorId) {
          visitorId = 'anon_' + Math.random().toString(36).substring(2, 15);
          localStorage.setItem('app_visitor_id', visitorId);
        }

        const { error } = await supabase.from('visits').insert([{ session_id: visitorId }]);
        if (error) console.error('Error logging visit:', error.message);
      } catch (err) {
        console.error('Could not track visit:', err);
      }
    }

    trackVisit();
  }, []);
}

function SplashScreen({ message, overlay = false, showReloadHint = false }: { message: string; overlay?: boolean; showReloadHint?: boolean }) {
  return (
    <div className={
      overlay
        ? "fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[#FFF0F3] overflow-hidden"
        : "min-h-screen flex flex-col items-center justify-center bg-[#FFF0F3] overflow-hidden"
    }>
      <div className="relative flex items-center justify-center">
        {/* Central Logo */}
        <div className="relative z-10 w-32 h-32 bg-white rounded-[40px] shadow-2xl shadow-pink-200/50 flex items-center justify-center mb-8 border border-white transition-transform duration-500 hover:scale-105">
          <div className="relative">
            <Heart
              className="w-16 h-16 text-pink-200 fill-pink-100 absolute -top-1 -right-1 opacity-60 animate-[bounce_1.8s_infinite_ease-in-out]"
              style={{ animationDelay: '0.15s' }}
            />
            <Heart className="relative z-10 w-16 h-16 text-[#FF69B4] fill-[#FF69B4] drop-shadow-xl animate-[bounce_1.8s_infinite_ease-in-out]" />
          </div>
        </div>

        {/* Orbiting small hearts */}
        <Heart className="absolute -top-10 -right-10 w-6 h-6 text-pink-300 animate-bounce delay-75" />
        <Heart className="absolute top-20 -left-12 w-4 h-4 text-rose-300 animate-pulse delay-300" />
        <Heart className="absolute -bottom-8 right-12 w-5 h-5 text-pink-200 animate-bounce delay-500" />
      </div>

      <div className="mt-12 space-y-3 text-center flex flex-col items-center">
        <p className="text-[#FF1493] font-bold text-lg tracking-[0.4em] animate-pulse">
          SWEET CHAT
        </p>

        <div className="space-y-3">
          <p className="text-pink-400/60 text-xs font-medium italic">
            {message}
          </p>

          {/* Enhanced Progress Bar */}
          <div className="w-24 h-[3px] bg-pink-100/50 rounded-full overflow-hidden mx-auto">
            <div className="h-full bg-gradient-to-r from-pink-400 to-rose-400 w-1/2 rounded-full animate-[loading_1.5s_infinite_ease-in-out]"></div>
          </div>
        </div>

        {/* Only appears if loading drags on unusually long — a gentle,
            neutral nudge rather than an error, since a stuck load is almost
            always cleared by a simple reload. */}
        {showReloadHint && (
          <div className="mt-6 flex flex-col items-center gap-3 animate-in fade-in duration-500">
            <p className="text-pink-400/70 text-[11px] font-medium max-w-[220px] text-center leading-relaxed">
              This is taking longer than usual. If it doesn't clear, try reloading the app.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-2 rounded-full bg-pink-500 hover:bg-pink-600 text-white text-xs font-bold uppercase tracking-widest transition-colors active:scale-95"
            >
              Reload App
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes loading {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
      `}</style>
    </div>
  );
}

function AppContent() { 
  const { user, profile, loading, signOut } = useAuth(); 
  const { showSuccess } = useNotify();
  useAnonymousVisitTracker();
  useHeartbeat(user?.id);
  usePresence(user?.id);
  useOfflineSync();
  useMessageSync(user?.id);
  const [showGifPanel, setShowGifPanel] = useState(false);
  const [gifSearch, setGifSearch] = useState('');
  const [theme, setTheme] = useState<'light' | 'dark' | 'sweet'>('sweet');
  const [previewGifs, setPreviewGifs] = useState<any[]>([]);
  const [lastSearchQuery, setLastSearchQuery] = useState('');
  const [hasOpened, setHasOpened] = useState(false);
  const [mailStage, setMailStage] = useState<'box-arrival' | 'box-idle' | 'envelope-reveal' | 'letter-unfold'>('box-arrival');
  const [faceLockEnabled, setFaceLockEnabled] = useState(false);
  // Which user id we've finished the profile/face-lock check for. Deriving
  // profileSyncLoading from this (instead of a lagging boolean set inside an
  // effect) is what actually kills the flash: the instant `user` becomes
  // non-null, this still holds the OLD id (or null), so profileSyncLoading is
  // already `true` DURING that same render — there is no frame where `user`
  // is set but the splash gate is open. A boolean flipped in an effect can't
  // do this, because effects run after the (already-flashed) render commits.
  const [profileSyncedFor, setProfileSyncedFor] = useState<string | null>(null);
  // Also hold the splash until `profile` is actually loaded — otherwise a
  // brand-new signup could reveal the app (face check done) while the
  // profile row fetch is still in flight, flashing a "ghost account" with no
  // name/avatar for a beat. If profile genuinely can't load, the 6s reload
  // hint below is the escape hatch rather than an indefinite hang.
  const profileSyncLoading = !!user && (profileSyncedFor !== user.id || !profile);
  // isAppLocked only ever becomes true from a confirmed profile row that
  // explicitly has face_lock_enabled — never as a default, never as a
  // fail-safe guess. See the fetchFaceDescriptor effect below for why.
  const [isAppLocked, setIsAppLocked] = useState(false);
  const chatsReady = useChatsReady();
  const [readyTimedOut, setReadyTimedOut] = useState(false);
  const [showSlowHint, setShowSlowHint] = useState(false);

  // Safety net: if ChatList never reports ready for any reason (a bug, a
  // stalled request, whatever), don't trap the user on the splash forever.
  useEffect(() => {
    if (chatsReady) return;
    const timer = setTimeout(() => setReadyTimedOut(true), 8000);
    return () => clearTimeout(timer);
  }, [chatsReady]);

  // Whenever we're sitting on ANY loading screen, arm a timer that surfaces a
  // neutral "try reloading" hint if it drags past ~6s. Cleared the moment
  // loading resolves, so a normal fast load never shows it.
  const isSplashUp = loading || profileSyncLoading || (!isAppLocked && !chatsReady && !readyTimedOut);
  useEffect(() => {
    if (!isSplashUp) { setShowSlowHint(false); return; }
    const timer = setTimeout(() => setShowSlowHint(true), 6000);
    return () => clearTimeout(timer);
  }, [isSplashUp]);
  const [showLetter, setShowLetter] = useState(() => {
  const hasSeenWelcome = localStorage.getItem('has_seen_welcome');
  return !hasSeenWelcome;
  });
  const [isFaceRegistered, setIsFaceRegistered] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
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
  
  const [savedDescriptor, setSavedDescriptor] = useState<number[] | null>(null);

  useEffect(() => {
  const fetchFaceDescriptor = async () => {
    if (!user?.id) return;
    // Capture the id up front so every "we're done syncing THIS user"
    // signal below records the right one even if `user` changes mid-flight.
    const uid = user.id;

    // Kick off the launch message catch-up in parallel with the face-lock
    // check, and await it below before releasing the splash — so the app
    // reveals already up to date (no flash of stale content, then a pop-in of
    // whatever arrived while the app was closed). Runs behind the loading
    // screen exactly as requested; the reconnect catch-up (in useMessageSync)
    // runs silently instead.
    const catchUpPromise = catchUpMessages(uid);

    // Local first — instant, and works fully offline. This is what makes
    // face-lock actually usable without a connection.
    //
    // Deliberately asymmetric: we only fast-release the splash when cache
    // says LOCKED — that's safe to trust immediately (worst case, a stale
    // "locked" shows the scanner once for someone who actually disabled it
    // elsewhere, harmless). "Unlocked" is exactly the value that can be
    // wrong or stale (e.g. corrupted by an unrelated cache write, which is
    // what caused this bug the first time), so we deliberately do NOT fast
    // release on it — we wait for server confirmation instead. Fail-locked,
    // not fail-open.
    const cached = await localDB.getFaceLockDataLocally(uid);
    if (cached?.enabled) {
      if (cached.descriptor) {
        setSavedDescriptor(cached.descriptor);
        setIsFaceRegistered(true);
      }
      setFaceLockEnabled(true);
      setIsAppLocked(true);
      // Still need models ready before it's safe to show the scanner.
      await preloadFaceModels();
      setProfileSyncedFor(uid);
    }

    // Then quietly reconcile with the server — this is the ONLY path that
    // ever releases the splash when the cache said "unlocked" (or there
    // was no cache at all), and it's also what corrects a stale/corrupted
    // "unlocked" cache before anything gets a chance to render.
    try {
      // maybeSingle(), not single(): right after a fresh signup, a session
      // can exist for a moment before the profile row has actually finished
      // being inserted (completeProfileSetup runs as a separate step after
      // the session is created). single() throws when no row is found yet,
      // which is exactly what was locking brand-new accounts — with no face
      // ever registered — into an unpassable scanner. maybeSingle() just
      // returns null in that case instead, which we treat as "not locked"
      // below, since a user with no profile yet can't have this enabled.
      const { data, error } = await supabase
        .from('profiles')
        .select('face_descriptor, face_lock_enabled')
        .eq('id', uid)
        .maybeSingle();

      if (error) throw error;

      const descriptor: number[] | null = data?.face_descriptor ?? null;
      const enabled = !!data?.face_lock_enabled;

      if (descriptor) {
        setSavedDescriptor(descriptor);
        setIsFaceRegistered(true);
      }
      setFaceLockEnabled(enabled);

      // isAppLocked only ever becomes true here, from a confirmed row that
      // explicitly has it enabled — never as a default, never as a
      // fail-safe guess. This is what actually fixes the flash for
      // everyone: the old code started locked by default and had to
      // "correct itself" back to false on every load for the ~everyone who
      // never turned this on. There's no real trade-off in dropping that
      // default — this whole check already runs behind the blocking splash
      // screen (profileSyncLoading), so by the time anything renders, this
      // has already resolved to the real value either way.
      setIsAppLocked(enabled);

      // Keep the local cache in sync with whatever the server just said —
      // covers face-lock being toggled from a different device.
      await localDB.saveFaceLockDataLocally(uid, descriptor, enabled);

      if (enabled) {
        // Same reasoning as the cached branch above: don't let `finally`
        // release the splash until models are actually ready. This branch
        // was the other half of the bug — it fired preloadFaceModels()
        // without awaiting it, so the splash still closed early for anyone
        // whose local cache came back empty (new device, cleared storage,
        // or a write that hadn't landed yet).
        await preloadFaceModels();
      }

      // Don't reveal the app until the launch catch-up has landed, so the
      // first thing the user sees is already current — but wait at most 6s so
      // a slow network can't hang the splash. The catch-up keeps running and
      // finishes its localDB write even if we stop waiting.
      await waitAtMost(catchUpPromise, 6000);
    } catch (err) {
      // A genuine error (network failure, etc.) — as opposed to "no row
      // found yet", which is handled above and isn't an error at all. If
      // we already applied cached data above, leave it as-is; only affects
      // the outcome when there was nothing cached to fall back on.
      console.error('Failed to check face lock status:', err);
    }
    finally {
      // Mark this user's profile check complete — this is what flips the
      // derived profileSyncLoading to false and reveals the app. Even on
      // error we release (fail-open on the splash), so a network blip can't
      // trap the user on "Preparing your inbox" forever.
      setProfileSyncedFor(uid);
    }
  };

  if (!loading && user) {
    fetchFaceDescriptor();
  } else if (!user) {
    // Cleared on logout so a later login (even the same account in the same
    // tab) always re-shows the splash and re-runs the face-lock check from
    // scratch, instead of the derived gate skipping straight through on a
    // stale "already synced this id" value. No-op when already null.
    setProfileSyncedFor(null);
  }
  // Depending on user?.id (a stable primitive) instead of the whole `user`
  // object was the second half of the tab-refocus splash bug: Supabase
  // hands back a new `user` object reference on every token refresh even
  // when it's the same person, which used to retrigger this effect (and
  // therefore re-flash profileSyncLoading) on every tab refocus.
}, [user?.id, loading]);

  const handleCloseWelcome = () => {
  setShowLetter(false);
  // Save to browser memory permanently
  localStorage.setItem('has_seen_welcome', 'true');
 };

useEffect(() => {
  if (!loading && user && !hasOpened) {
  }
}, [loading, user, showLetter]);

  // --- INITIALIZATION ---
  useEffect(() => {
    initializeDictionary();
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | 'sweet';
    if (savedTheme) setTheme(savedTheme);
  }, []);

  // Persistence
  useEffect(() => {
    localStorage.setItem('sweet_user_gifs', JSON.stringify(myGifs));
  }, [myGifs]);

  useEffect(() => {
    localStorage.setItem('theme', theme);
  }, [theme]);

  const updateFaceDescriptor = async (userId: string, descriptor: number[]) => {
  const { error } = await supabase
    .from('profiles')
    .update({ face_descriptor: descriptor, face_lock_enabled: true })
    .eq('id', userId);

  if (error) throw error;

  // Written to local storage immediately too — not just the database —
  // so the very next scan (and every one after, including offline) reads
  // from the device instantly instead of waiting on a network round trip.
  await localDB.saveFaceLockDataLocally(userId, descriptor, true);

  // Without this, savedDescriptor stayed null in memory until the next
  // full reload — meaning toggling face-lock off then on again in the
  // SAME session would incorrectly think no face was registered yet and
  // re-open the scanner, even though local/remote storage already had it.
  setSavedDescriptor(descriptor);
  };

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

    showSuccess(`Added "${packName}" pack to your library!`);
  };

const handleGifAction = async (input: string) => {
  if (!input.trim()) return;

  // Extension check tolerates a trailing query string (`...giphy.gif?cid=abc`),
  // since real Giphy/Tenor share links almost always have one appended.
  const isUrl = /\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i.test(input) || input.includes('giphy.com/media');

  if (isUrl) {
    // Route it through the same preview grid a search result would use, so
    // the user actually sees the gif that was parsed before it's saved,
    // instead of it vanishing straight into the library with no confirmation.
    setPreviewGifs([input]);
    setLastSearchQuery('Recent');
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

if (loading || profileSyncLoading) {
  return <SplashScreen message="Preparing your inbox..." showReloadHint={showSlowHint} />;
}

  if (!user) {
    return (
      <div className={theme === 'dark' ? 'dark' : ''}>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
          <Auth theme={theme} />
        </div>
      </div>
    );
  }

  if (showLetter) {
  return (
    <div className="min-h-screen bg-[#FFF0F3] flex items-center justify-center p-4 relative overflow-hidden">
      
      {/* Background Hearts - Kept behind everything */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-40">
        <FloatingHearts />
      </div>

      <div className="relative z-10 w-full max-w-lg flex flex-col items-center justify-center">
        
        {/* STAGE 1 & 2: THE 3D MAILBOX (The animation you liked) */}
        {(mailStage === 'box-arrival' || mailStage === 'box-idle') && (
          <div 
            onAnimationEnd={() => mailStage === 'box-arrival' && setMailStage('box-idle')}
            onClick={() => setMailStage('envelope-reveal')}
            className={`group cursor-pointer flex flex-col items-center
              ${mailStage === 'box-arrival' ? 'animate-[slideIn3D_1.5s_ease-out_forwards]' : 'animate-[float_3s_infinite_ease-in-out]'}`}
          >
            <div className="relative w-40 h-32 bg-rose-500 rounded-t-full shadow-[20px_20px_60px_rgba(0,0,0,0.1)] border-b-[12px] border-rose-700">
              <div className="absolute inset-2 border-2 border-rose-400/30 rounded-t-full flex items-center justify-center">
                 <div className="w-2 h-8 bg-rose-800/20 rounded-full" />
              </div>
              <div className="absolute -right-4 top-10 w-2 h-12 bg-red-600 rounded-full origin-bottom rotate-[30deg] group-hover:rotate-0 transition-transform duration-500" />
            </div>
            <div className="mt-8 text-center space-y-2">
              <p className="text-rose-600 font-black tracking-[0.2em] uppercase text-xs">You have got a special message</p>
              <p className="text-rose-400/60 text-[10px] font-bold uppercase tracking-widest animate-pulse">Tap mailbox to see message</p>
            </div>
          </div>
        )}

        {/* STAGE 3: THE ENVELOPE */}
        {mailStage === 'envelope-reveal' && (
          <div 
            onClick={() => setMailStage('letter-unfold')}
            className="relative w-72 aspect-[4/3] bg-white rounded-xl shadow-2xl border-2 border-pink-50 flex flex-col items-center justify-center cursor-pointer animate-[envelopePop_0.8s_ease-out_forwards]"
          >
            <div className="absolute top-0 left-0 w-full h-1/2 border-t-[40px] border-t-pink-50 border-x-[144px] border-x-transparent" />
            <div className="z-10 text-center px-6">
              <p className="text-pink-400 font-serif italic text-xl border-b border-pink-100 pb-2">To My Beautiful Love</p>
              <Heart className="w-8 h-8 text-pink-500 fill-pink-500 mx-auto mt-4 animate-bounce" />
            </div>
          </div>
        )}

        {/* STAGE 4: THE LETTER + FIXED CONFETTI */}
        {mailStage === 'letter-unfold' && (
          <div className="w-full relative animate-[letterExpand_0.8s_ease-out_forwards] origin-top">
            
            {/* FIXED CONFETTI POP */}
            <div className="absolute inset-0 pointer-events-none z-50 overflow-visible">
              {[...Array(16)].map((_, i) => (
                <div 
                  key={i}
                  className="absolute left-1/2 top-1/2 w-3 h-3 rounded-sm animate-[confettiPop_1s_ease-out_forwards]"
                  style={{ 
                    backgroundColor: i % 2 === 0 ? '#f472b6' : '#fb7185',
                    '--tx': `${(Math.random() - 0.5) * 400}px`,
                    '--ty': `${(Math.random() - 0.5) * 400}px`,
                    '--rot': `${Math.random() * 360}deg`
                  } as any}
                />
              ))}
            </div>

            <div className="bg-white/95 backdrop-blur-md rounded-[40px] shadow-[0_30px_100px_rgba(255,182,193,0.5)] p-8 md:p-10 border border-white flex flex-col max-h-[80vh] mx-auto">
              <div className="flex-shrink-0 flex justify-center mb-6">
                 <div className="bg-gradient-to-tr from-pink-500 to-rose-400 p-4 rounded-3xl shadow-lg transform -rotate-3">
                    <Heart className="text-white fill-current w-6 h-6" />
                 </div>
              </div>

              {/* Scrollable Letter Body */}
              <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar text-center space-y-6">
                <h2 className="text-pink-600 font-black tracking-tight text-3xl">Welcome My Love</h2>
                <div className="text-pink-500/80 leading-relaxed font-medium italic text-lg space-y-6">
                  <p>It has been 11 months and 6 days since we last directly communicated, but not a single day went by where I didn't think of you.</p>
                  <p>We have suffered a lot but now it's time to heal and rise again, together.</p>
                  <p>I built this app as a sanctuary—a place where the world can't reach us, and where we will share love with each other.</p>
                  <p>Believe it or not, you are the only one I want to spend my each moment with 💕.</p>
                  <p>To talk with me you have to add me from search section in Find Friends, My username is "ahmad" or just login i'll message you myself.</p>
                  <p>Don't worry in using your own email because my app don't send any code-if there is any problem you fear so just don't worry.</p>
                  <p className="not-italic font-bold text-pink-600">I've missed you more than I can even explain.</p>
                  <p className="not-italic font-bold text-pink-700">I LOVE YOU SO MUCH!</p>
                </div>
              </div>

              <div className="flex-shrink-0 pt-8 flex flex-col items-center">
                <button 
                  onClick={() => { handleCloseWelcome(); setHasOpened(true); }}
                  className="group relative active:scale-95 transition-all w-full max-w-xs"
                >
                  <div className="absolute inset-0 bg-pink-400 rounded-full blur-xl opacity-20" />
                  <div className="relative bg-pink-500 hover:bg-pink-600 text-white py-4 rounded-full font-black uppercase tracking-widest text-xs shadow-xl transition-colors">
                  Enter App
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes confettiPop {
          0% { transform: translate(-50%, -50%) scale(0) rotate(0deg); opacity: 1; }
          100% { transform: translate(var(--tx), var(--ty)) scale(1) rotate(var(--rot)); opacity: 0; }
        }
        @keyframes slideIn3D {
          0% { transform: translateX(-200%) rotateY(-45deg) scale(0.5); opacity: 0; }
          100% { transform: translateX(0) rotateY(0) scale(1); opacity: 1; }
        }
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-20px); }
        }
        @keyframes envelopePop {
          0% { transform: scale(0) translateY(100px); opacity: 0; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes letterExpand {
          0% { transform: scaleY(0); opacity: 0; }
          100% { transform: scaleY(1); opacity: 1; }
        }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #fbcfe8; border-radius: 10px; }
      `}</style>
    </div>
  );
}

  return (
    <div className={theme === 'dark' ? 'dark' : theme === 'sweet' ? 'sweet-theme' : ''}>
      {/* Lock screen always wins over the chats-loading splash — showing
          "Loading your chats..." on top of (or racing against) a lock
          screen was the original flash bug. Overlay, not a blocking early
          return: Dashboard/ChatList still mount and load underneath,
          otherwise markChatsReady() would never fire and every load would
          sit through the full readyTimedOut window, every single time. */}
      {isAppLocked ? (
        <StrictLock
          onUnlock={() => setIsAppLocked(false)}
          mode="verify"
          userId={user.id}
          onSaveDescriptor={updateFaceDescriptor}
          savedDescriptor={savedDescriptor}
          onSignOut={signOut}
        />
      ) : (
        !chatsReady && !readyTimedOut && (
          <SplashScreen message="Loading your chats..." overlay showReloadHint={showSlowHint} />
        )
      )}

      <div className={`min-h-screen transition-colors duration-300 ${
        theme === 'dark' ? 'bg-gray-900 text-white' : theme === 'sweet' ? 'bg-[#FFF0F5] text-[#FF69B4]' : 'bg-gray-50 text-gray-900'
      }`}>

        {isRegistering && (
         <StrictLock 
            mode="register" 
            userId={user?.id}
            onSaveDescriptor={updateFaceDescriptor}
            onRegisterSuccess={() => {
              setIsFaceRegistered(true);
              setFaceLockEnabled(true);
              setIsRegistering(false);
            }}
            onUnlock={() => setIsRegistering(false)} 
          />
        )}
        
        <Dashboard 
          theme={theme}
          onSaveDescriptor={updateFaceDescriptor}
          user={user}
          setTheme={setTheme} 
          onOpenGifPanel={() => setShowGifPanel(true)}
          myGifs={myGifs}
          setMyGifs={setMyGifs}
          isFaceRegistered={isFaceRegistered}
          onRegisterFace={() => setIsRegistering(true)}
          onSaveFace={updateFaceDescriptor}
          savedDescriptor={savedDescriptor}
          faceLockEnabled={faceLockEnabled}
          setFaceLockEnabled={setFaceLockEnabled}
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
                                 showSuccess("Added to Library!");
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
    <ErrorBoundary>
      <PerformanceProvider>
        <NotificationProvider>
          <ConfirmProvider>
            <AuthProvider>
              <AppContent />
            </AuthProvider>
          </ConfirmProvider>
        </NotificationProvider>
      </PerformanceProvider>
    </ErrorBoundary>
  );
}