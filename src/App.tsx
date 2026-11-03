import { useState, useEffect } from 'react';
import { useAuth, AuthProvider } from './contexts/AuthContext';
import { NotificationProvider, useNotify } from './contexts/NotificationContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { PerformanceProvider } from './contexts/PerformanceContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Auth } from './pages/Auth';
import { UsernameSetup } from './pages/UsernameSetup';
import { Dashboard } from './pages/Dashboard';
import { initializeDictionary } from './predictionService';
import { Heart, Paperclip, X, Search } from 'lucide-react';
import { StrictLock } from './components/StrictLock';
import { AppLockGate } from './components/AppLockGate';
import { supabase } from './lib/supabase';
import { useHeartbeat } from './hooks/useHeartbeat';
import { usePresence } from './hooks/usePresence';
import { useOfflineSync } from './hooks/useOfflineSync';
import { useMessageSync, catchUpMessages, waitAtMost } from './hooks/useMessageSync';
import { useChatsReady } from './hooks/useChatsReady';
import { localDB } from './db';
import { preloadFaceModels } from './lib/faceModels';
import { DEFAULT_VAULT, getCachedVault, getSavedMethods, onVaultChange, saveVault, type VaultSettings } from './lib/vault';
import { getAppLockMethods } from './lib/appLock';
import { getDeviceFingerprintId } from './lib/fingerprint';
import { hasCamera } from './lib/camera';

// Face models (and the face-api.js library itself) are a large download.
// Only fetch them when the App Lock will actually use the face on this
// device — and only hold the splash for them when the face scan is the
// first thing shown (not just a backup behind fingerprint or password,
// where they load quietly in the background).
async function preloadFaceModelsIfUsed(uid: string, vault: VaultSettings | null) {
  if (!vault) return;
  const methods = getAppLockMethods(vault, vault.face_descriptor, getDeviceFingerprintId(uid), await hasCamera());
  if (methods[0] === 'face') await preloadFaceModels();
  else if (methods.includes('face')) preloadFaceModels().catch(() => {});
}

// Same idea for the Locked Chats: if they can be opened with the face on
// this device, warm everything up in the background so the scanner opens
// fast. Never blocks the splash. Reads the device's vault copy, so it's
// instant and works offline; with no copy yet, VaultGate's StrictLock still
// loads everything on demand the first time it opens.
async function preloadFaceModelsForLockedChats(uid: string) {
  const vault = await getCachedVault(uid);
  if (!vault || vault.chat_security_type === 'none') return;
  const saved = getSavedMethods(vault, vault.face_descriptor, getDeviceFingerprintId(uid), await hasCamera());
  if (saved.face !== 'saved') return;
  if (vault.chat_security_type === 'face' || vault.allow_other_methods) {
    preloadFaceModels().catch(() => {});
  }
}
import { VisitTrackingProvider, useVisitTracking } from './contexts/VisitTrackingContext';

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
  const { logEvent } = useVisitTracking();
  const [theme, setTheme] = useState<'light' | 'dark' | 'sweet'>('sweet');
  const [previewGifs, setPreviewGifs] = useState<any[]>([]);
  const [lastSearchQuery, setLastSearchQuery] = useState('');
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

  useEffect(() => {
  if (!loading) return;
  const timer = setTimeout(() => {
    logEvent('stuck', { screen: 'auth_loading', waited_ms: 8000 });
  }, 8000);
  return () => clearTimeout(timer);
  }, [loading]);

  // Whenever we're sitting on ANY loading screen, arm a timer that surfaces a
  // neutral "try reloading" hint if it drags past ~6s. Cleared the moment
  // loading resolves, so a normal fast load never shows it.
  const isSplashUp = loading || profileSyncLoading || (!isAppLocked && !chatsReady && !readyTimedOut);
  useEffect(() => {
    if (!isSplashUp) { setShowSlowHint(false); return; }
    const timer = setTimeout(() => setShowSlowHint(true), 6000);
    return () => clearTimeout(timer);
  }, [isSplashUp]);
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
    // Background only — never part of what holds the splash.
    preloadFaceModelsForLockedChats(uid).catch(() => {});

    const cached = await localDB.getFaceLockDataLocally(uid);
    if (cached?.enabled) {
      if (cached.descriptor) {
        setSavedDescriptor(cached.descriptor);
        setIsFaceRegistered(true);
      }
      setFaceLockEnabled(true);
      setIsAppLocked(true);
      // Models ready before the scanner shows — but only if it will.
      await preloadFaceModelsIfUsed(uid, await getCachedVault(uid));
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
      // below. Same for a user who never touched lock settings at all: they
      // simply have no vault_settings row (owner-only table — see lib/vault).
      const { data, error } = await supabase
        .from('vault_settings')
        .select('face_descriptor, face_lock_enabled, app_lock_face, app_lock_fingerprint, fingerprint_credential_ids')
        .eq('user_id', uid)
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
        await preloadFaceModelsIfUsed(uid, { ...DEFAULT_VAULT, ...data } as VaultSettings);
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

  // Keep the in-memory face-lock state current when it changes mid-session
  // (e.g. a face registered from Locked Chats settings) — otherwise the
  // app-lock toggle keeps the old face until a reload. Deliberately never
  // touches isAppLocked: a setting change shouldn't lock/unlock the app.
  useEffect(() => {
    if (!user?.id) return;
    const uid = user.id;
    return onVaultChange((changedUid, vault) => {
      if (changedUid !== uid) return;
      setSavedDescriptor(vault.face_descriptor);
      setIsFaceRegistered(!!vault.face_descriptor);
      setFaceLockEnabled(vault.face_lock_enabled);
    });
  }, [user?.id]);

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
  // saveVault also writes the device copy immediately — not just the
  // database — so the very next scan (and every one after, including
  // offline) reads from the device instantly instead of a network round trip.
  await saveVault(userId, { face_descriptor: descriptor, face_lock_enabled: true });

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

  // A signed-in account with no username — block here until they pick one.
  // Email signups always have a username by the time a profile row exists,
  // so this is only a safety net (e.g. accounts left over from the removed
  // Telegram login).
  if (profile && !profile.username) {
    return (
      <div className={theme === 'dark' ? 'dark' : ''}>
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
          <UsernameSetup theme={theme} />
        </div>
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
        // Fingerprint / face / app password — the password works on every
        // device, so a PC without a camera can't trap anyone any more.
        <AppLockGate
          userId={user.id}
          purpose="launch"
          onUnlock={() => setIsAppLocked(false)}
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
              <VisitTrackingProvider>
                <AppContent />
              </VisitTrackingProvider>
            </AuthProvider>
          </ConfirmProvider>
        </NotificationProvider>
      </PerformanceProvider>
    </ErrorBoundary>
  );
}