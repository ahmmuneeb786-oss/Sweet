import React, { useState, useEffect } from 'react';
import { ChevronRight, X, Bell, Lock, Palette, HardDrive, LogOut, User, Shield, ShieldCheck, CheckCircle, AlertCircle, ChevronLeft, Zap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { PermissionManager } from '../services/PermissionManager';
import { VaultGate } from '../components/VaultGate';
import { LockedChatsSettings } from '../components/LockedChatsSettings';
import { AppLockGate } from '../components/AppLockGate';
import { AppLockSettings } from '../components/AppLockSettings';
import { OfflineBadge } from '../components/OfflineBadge';
import { localDB } from '../db';
import { useNotify } from '../contexts/NotificationContext';
import { usePerformance, useFps } from '../contexts/PerformanceContext';

// Kept as its own component so only this number re-renders every second,
// not the whole Settings page.
function LiveFpsValue() {
  const fps = useFps();
  return (
    <p className={`text-2xl font-black ${fps < 40 ? 'text-red-500' : fps < 55 ? 'text-amber-500' : 'text-green-600'}`}>
      {fps}
    </p>
  );
}


type SettingsTab ='main' | 'account' | 'privacy' | 'notifications' | 'theme' | 'storage' | 'locked' | 'lock' | 'performance';

interface SettingsProps {
  onClose: () => void;
  theme: 'light' | 'dark' | 'sweet';
  setTheme: React.Dispatch<React.SetStateAction<'light' | 'dark' | 'sweet'>>;
  faceLockEnabled: boolean;
  setFaceLockEnabled: (val: boolean) => void;
  isFaceRegistered: boolean;
  onRegisterFace: () => void;
  user: any;
  savedDescriptor: number[] | null;
  initialTab?: 'main' | 'locked';
  onCloseLockedPanel?: () => void;
  profile: any;
}

// 2. THIS IS THE SECRET STEP: Tell TypeScript what your database profile looks like!
interface SecureProfile {
  id: string;
  username?: string;
  display_name?: string;
  bio?: string;
  avatar_url?: string | null;
}

// faceLockEnabled / setFaceLockEnabled / onRegisterFace / savedDescriptor
// are still passed by the dashboards but no longer used: App Lock settings
// now live in AppLockSettings, which reads and saves vault_settings itself.
export function Settings({ onClose, theme, setTheme, user, onCloseLockedPanel }: SettingsProps) {
  // 3. Destructure and apply the typecast ('as SecureProfile')
  const { profile: rawProfile, updateProfile, signOut } = useAuth();
  const { showSuccess, showInfo } = useNotify();
  const { deviceTier, isLowPerfMode, override, setOverride, showOverlay, setShowOverlay } = usePerformance();
  const profile = rawProfile as SecureProfile; // ✨ This instantly cleans up all profile red marks!

  const [activeTab, setActiveTab] = useState<SettingsTab>('main');


  // Your local states are already correct!
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [newUsername, setNewUsername] = useState(profile?.username || '');
  const [usernameError, setUsernameError] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [storageUsed, setStorageUsed] = React.useState<string>('Calculating...');
  const [isClearing, setIsClearing] = React.useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  React.useEffect(() => {
    if (activeTab === 'storage') {
      getStorageEstimate();
    }
  }, [activeTab]);

  const [privacySettings, setPrivacySettings] = useState({
    lastSeenVisibility: 'everyone',
    profilePhotoVisibility: 'everyone',
    whoCanAdd: 'everyone'
  });

  const [notificationSettings, setNotificationSettings] = useState({
    messageNotifications: true,
    friendRequests: true,
    callNotifications: true,
    muteAll: false
  });

  const getBytesOf = async (records: any[]) =>
    records.reduce((sum, r) => sum + new Blob([JSON.stringify(r)]).size, 0);

  const getCacheStorageBytes = async () => {
    if (!window.caches) return 0;
    let total = 0;
    const cacheNames = await caches.keys();
    for (const name of cacheNames) {
      const cache = await caches.open(name);
      const requests = await cache.keys();
      for (const req of requests) {
        const res = await cache.match(req);
        if (res) total += (await res.blob()).size;
      }
    }
    return total;
  };

  const getStorageEstimate = async () => {
    try {
      const [cacheBytes, chats, messages, profiles] = await Promise.all([
        getCacheStorageBytes(),
        localDB.chats.toArray(),
        localDB.messages.toArray(),
        localDB.profiles.toArray(),
      ]);

      const clearableProfiles = profiles.filter(p => !p.pending_sync);

      const totalBytes =
        cacheBytes +
        (await getBytesOf(chats)) +
        (await getBytesOf(messages)) +
        (await getBytesOf(clearableProfiles));

      if (totalBytes < 1024 * 1024) {
        setStorageUsed(`${(totalBytes / 1024).toFixed(1)} KB`);
      } else {
        setStorageUsed(`${(totalBytes / (1024 * 1024)).toFixed(1)} MB`);
      }
    } catch (err) {
      console.error("Failed to estimate storage usage:", err);
      setStorageUsed('Unknown');
    }
  };

  const handleClearCache = async () => {
    setIsClearing(true);
    try {
      // 1. Service worker asset cache (images/JS/CSS for offline loading) —
      // purely disposable, already handled.
      if (window.caches) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
      }

      // 2. The actual local chat cache — this is the part that was missing,
      // and where most of the storage usage actually lives. `chats` and
      // `messages` are pure mirrors of what's already on the server, so
      // wiping them is safe: the next app open just falls back to a real
      // network fetch, exactly like a first-ever login.
      await localDB.messages.clear();
      await localDB.chats.clear();

      // 3. Profiles cache — only delete entries that are fully synced.
      // A profile edit made while offline (pending_sync: true) hasn't
      // reached the server yet. That's real unsaved data, not cache, so
      // it's deliberately left alone here rather than silently discarded.
      const allProfiles = await localDB.profiles.toArray();
      const safeToDeleteIds = allProfiles.filter(p => !p.pending_sync).map(p => p.id);
      if (safeToDeleteIds.length > 0) {
        await localDB.profiles.bulkDelete(safeToDeleteIds);
      }

      // NOTE: localDB.pendingMessages is deliberately NEVER touched by this
      // button. It's the offline send queue — messages the user actually
      // tried to send that haven't reached the server yet. That's real user
      // data, not cache, and clearing it here would silently drop messages.

      // Give the browser a moment to update, then recalculate metrics
      setTimeout(async () => {
        await getStorageEstimate();
        setIsClearing(false);
      }, 600);

    } catch (err) {
      console.error("Error clearing application cache:", err);
      setIsClearing(false);
    }
  };

  useEffect(() => {
    const CleanedUsername = newUsername.trim().toLowerCase();

    // If input matches their current username, clear warnings and mark available
    if (CleanedUsername === profile?.username?.toLowerCase()) {
      setUsernameError('');
      setUsernameAvailable(true);
      setCheckingUsername(false);
      return;
    }

    if (newUsername.trim()) {
      const timeoutId = setTimeout(async () => {
        // 1. Basic character validation (Supporting uppercase in input, converted down)
        if (!/^[A-Za-z0-9_-]+$/.test(CleanedUsername)) {
          setUsernameError('Username can only contain A-Z, a-z, 0-9, - and _');
          setUsernameAvailable(false);
          return;
        }

        if (!isOnline) {
          setUsernameError('Offline Mode: Username availability will verify on reconnect');
          setUsernameAvailable(true); // Allow them to save to local DB anyway
          return;
        }

        setCheckingUsername(true);
        setUsernameError('');

        try {
          // 2. Querying Supabase while excluding the current user's profile ID
          const { data, error: fetchError } = await supabase
            .from('profiles')
            .select('username')
            .eq('username', CleanedUsername)
            .neq('id', profile?.id)
            .maybeSingle();

          // 3. Explicitly capture database errors safely
          if (fetchError) {
            console.error('Database query issue:', fetchError);
            setUsernameError('Could not verify availability. Try again.');
            setUsernameAvailable(false);
            return;
          }

          // 4. Evaluate data presence
          if (data) {
            setUsernameError('Username already taken');
            setUsernameAvailable(false);
          } else {
            setUsernameError('');
            setUsernameAvailable(true);
          }
        } catch (error) {
          console.error('Error checking username:', error);
          setUsernameAvailable(false);
        } finally {
          setCheckingUsername(false);
        }
      }, 500);

      return () => clearTimeout(timeoutId);
    } else {
      setUsernameError('');
      setUsernameAvailable(false);
    }
  }, [newUsername, profile?.username, profile?.id, isOnline]);

  useEffect(() => {
    async function checkExistingPermission() {
      const status = await PermissionManager.checkPermission('notifications');
      setNotificationsEnabled(status === 'granted');
    }
    checkExistingPermission();
  }, []);

  const handleNotificationToggle = async () => {
  if (!notificationsEnabled) {
    // Passing user.id ensures the subscription gets saved to Supabase!
    const granted = await PermissionManager.requestPermission('notifications', user?.id);
    if (granted) {
      setNotificationsEnabled(true);
    }
  } else {
    // Note: Browsers don't let you programmatically "revoke" permission to 'default', 
    // but we can tell them how to turn it off or handle local state suppression.
    showInfo("To turn off whispers completely, you can tap the lock/info icon next to your browser URL bar at the top! 🍬");
  }
};

  async function handleUpdateProfile() {
    setLoading(true);
    try {
      // 🌸 Fetch existing cache first to preserve avatar or created_at fields
      const currentCache = user?.id ? await localDB.getUserProfile(user.id) : null;

      const profilePayload = {
        display_name: displayName,
        bio: bio,
        avatar_url: currentCache?.avatar_url || profile?.avatar_url || null,
        username: currentCache?.username || profile?.username || '',
        created_at: currentCache?.created_at || user?.created_at || null
      };

      if (user?.id) {
        await localDB.saveUserProfile(user.id, profilePayload);
      }

      // If offline, preserve state, give visual feedback, and head back
      if (!isOnline) {
        setDisplayName(displayName);
        setBio(bio);
        showSuccess('✨ Saved profile changes locally! They will sync automatically when back online.');
        setActiveTab('main');
        return;
      }

      const { error } = await updateProfile({
        display_name: displayName,
        bio: bio
      });

      if (error) throw error;
      setActiveTab('main');
    } catch (error) {
      console.error('Error updating profile:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleChangeUsername() {
    const CleanedUsername = newUsername.trim().toLowerCase();

    if (!CleanedUsername) {
      setUsernameError('Username cannot be empty');
      return;
    }

    if (!/^[A-Za-z0-9_-]+$/.test(CleanedUsername)) {
      setUsernameError('Username can only contain A-Z, a-z, 0-9, - and _');
      return;
    }

    if (CleanedUsername === profile?.username?.toLowerCase()) {
      setActiveTab('main');
      return;
    }

    setLoading(true);
    try {
      const currentCache = user?.id ? await localDB.getUserProfile(user.id) : null;

      const profilePayload = {
        display_name: displayName || currentCache?.display_name || profile?.display_name || '',
        bio: bio || currentCache?.bio || profile?.bio || '',
        avatar_url: currentCache?.avatar_url || profile?.avatar_url || null,
        username: CleanedUsername,
        created_at: currentCache?.created_at || user?.created_at || null
      };

      if (user?.id) {
        await localDB.saveUserProfile(user.id, profilePayload);
      }

      // 🌸 Offline branch: bypass cloud check temporarily, commit to Dexie cache
      if (!isOnline) {
        setNewUsername(CleanedUsername);
        showSuccess('✨ Saved username locally! It will attempt to update on the cloud once online.');
        setActiveTab('main');
        return;
      }

      // Double check availability upon submit click to prevent race conditions
      const { data: existing, error: fetchError } = await supabase
        .from('profiles')
        .select('username')
        .eq('username', CleanedUsername)
        .neq('id', profile?.id)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (existing) {
        setUsernameError('Username already taken');
        setUsernameAvailable(false);
        return;
      }

      const { error } = await updateProfile({
        username: CleanedUsername
      });

      if (error) throw error;
      
      setUsernameError('');
      setActiveTab('main');
    } catch (error) {
      console.error('Error updating profile username data context:', error);
      setUsernameError('Failed to update username');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdatePrivacy() {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('privacy_settings')
        .update({
          last_seen_visibility: privacySettings.lastSeenVisibility,
          profile_photo_visibility: privacySettings.profilePhotoVisibility,
          who_can_add: privacySettings.whoCanAdd
        })
        .eq('user_id', profile?.id);

      if (error) throw error;
      setActiveTab('main');
    } catch (error) {
      console.error('Error updating privacy settings:', error);
    } finally {
      setLoading(false);
    }
  }

  const settingsSections = [
    { id: 'account', label: 'Account Settings', icon: User },
    { id: 'lock', label: 'Lock App Settings', icon: ShieldCheck },
    { id: 'privacy', label: 'Privacy Settings', icon: Shield },
    { id: 'notifications', label: 'Notification Settings', icon: Bell },
    { id: 'theme', label: 'Theme Settings', icon: Palette },
    { id: 'storage', label: 'Storage & Media', icon: HardDrive },
    { id: 'performance', label: 'Performance', icon: Zap },
    { id: 'locked', label: 'Locked Chats Settings', icon: Lock }
  ];

  // Locked Chats settings need the vault check every time the tab is
  // entered — leaving it (or Settings) locks it again.
  const [lockedTabUnlocked, setLockedTabUnlocked] = useState(false);
  const [appLockTabUnlocked, setAppLockTabUnlocked] = useState(false);
  useEffect(() => {
    if (activeTab !== 'locked') setLockedTabUnlocked(false);
    if (activeTab !== 'lock') setAppLockTabUnlocked(false);
  }, [activeTab]);

  const leaveLockedTab = () => {
    if (typeof onCloseLockedPanel === 'function') {
      onCloseLockedPanel(); // Closes standalone overlay if opened directly
    } else {
      setActiveTab('main'); // Falls back to standard settings navigation
    }
  };

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // 🌐 Dynamic Connection Listeners
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    async function hydrateProfile() {
      if (!user?.id) return;

      if (isOnline && profile) {
        setDisplayName(profile.display_name || '');
        setBio(profile.bio || '');
        setNewUsername(profile.username || '');

        await localDB.saveUserProfile(user.id, {
          display_name: profile.display_name,
          bio: profile.bio,
          avatar_url: profile.avatar_url || null,
          username: profile.username,
          created_at: user.created_at || null
        });
      } else {
        const cached = await localDB.getUserProfile(user.id);
        if (cached) {
          setDisplayName(cached.display_name || '');
          setBio(cached.bio || '');
          setNewUsername(cached.username || '');
        }
      }
    }
    hydrateProfile();
  }, [user?.id, isOnline]);

  useEffect(() => {
    const CleanedUsername = newUsername.trim().toLowerCase();

    if (CleanedUsername === profile?.username?.toLowerCase()) {
      setUsernameError('');
      setUsernameAvailable(true);
      setCheckingUsername(false);
      return;
    }

    if (newUsername.trim()) {
      const timeoutId = setTimeout(async () => {
        if (!/^[A-Za-z0-9_-]+$/.test(CleanedUsername)) {
          setUsernameError('Username can only contain A-Z, a-z, 0-9, - and _');
          setUsernameAvailable(false);
          return;
        }

        // 🌸 Gracefully block API querying when disconnected
        if (!isOnline) {
          setUsernameError('Offline Mode: Cannot check username availability in real-time');
          setUsernameAvailable(true); // Allow them to save locally anyway
          return;
        }

        setCheckingUsername(true);
        setUsernameError('');

        try {
          const { data, error: fetchError } = await supabase
            .from('profiles')
            .select('username')
            .eq('username', CleanedUsername)
            .neq('id', profile?.id)
            .maybeSingle();

          if (fetchError) {
            console.error('Database query issue:', fetchError);
            setUsernameError('Could not verify availability. Try again.');
            setUsernameAvailable(false);
            return;
          }

          if (data) {
            setUsernameError('Username already taken');
            setUsernameAvailable(false);
          } else {
            setUsernameError('');
            setUsernameAvailable(true);
          }
        } catch (error) {
          console.error('Error checking username:', error);
          setUsernameAvailable(false);
        } finally {
          setCheckingUsername(false);
        }
      }, 500);

      return () => clearTimeout(timeoutId);
    } else {
      setUsernameError('');
      setUsernameAvailable(false);
    }
  }, [newUsername, profile?.username, profile?.id, isOnline]);

  // Sweet-theme surface levels, modelled on the Theme tab: the panel is dark
  // pink, each card/option on it is light pink with a soft border, and any
  // control nested INSIDE a light-pink card flips back to dark pink so it
  // still stands out. Selected options go white with a hot-pink border.
  const sweetCard = 'border-2 border-[#FFD1DC] bg-[#FFF0F5]';
  const sweetCardHover = 'hover:bg-white hover:border-[#FFB6C1]';
  const sweetInner = 'border border-[#FFB6C1] bg-[#FFE4E1]';

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className={`fixed right-0 top-0 h-full w-full md:w-96 shadow-2xl z-50 flex flex-col overflow-hidden transition-all duration-300 ${
        theme === 'dark' 
          ? 'bg-gray-900 text-white' 
          : theme === 'sweet' 
          ? 'bg-[#FFE4E1] text-[#4B004B]' 
          : 'bg-white text-gray-900'
      }`}>
        <div className={`p-6 border-b flex items-center justify-between ${theme === 'sweet' ? 'border-[#FFB6C1]' : 'border-gray-200'}`}>
          <div className="flex items-center gap-2">
            <h2 className={`text-2xl font-bold ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900'}`}>Settings</h2>
            <OfflineBadge theme={theme} mobileOnly surface="dark" />
          </div>
          <button onClick={onClose} className={`p-2 rounded-full ${theme === 'sweet' ? 'hover:bg-[#FFC0CB]/40' : 'hover:bg-gray-100'}`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === 'main' && (
            <div className={theme === 'sweet' ? 'p-4 space-y-2' : 'divide-y divide-gray-100'}>
              {settingsSections.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveTab(section.id as SettingsTab)}
                    className={`w-full p-4 flex items-center justify-between transition-colors ${theme === 'sweet' ? `rounded-xl ${sweetCard} ${sweetCardHover}` : 'hover:bg-gray-50'}`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`w-5 h-5 ${theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-600'}`} />
                      <span className={`font-medium ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900'}`}>{section.label}</span>
                    </div>
                    <ChevronRight className={`w-5 h-5 ${theme === 'sweet' ? 'text-[#FF69B4]' : 'text-gray-400'}`} />
                  </button>
                );
              })}
              <button
                onClick={async () => {
                  await signOut();
                  onClose();
                }}
                className={`w-full p-4 flex items-center justify-between hover:bg-red-50 transition-colors text-red-600 ${theme === 'sweet' ? `rounded-xl ${sweetCard} hover:border-red-200` : ''}`}
              >
                <div className="flex items-center gap-3">
                  <LogOut className="w-5 h-5" />
                  <span className="font-medium">Logout</span>
                </div>
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}

          {activeTab === 'account' && (
            <div className="p-6 space-y-6">
              <button
                onClick={() => setActiveTab('main')}
                className="flex items-center gap-2 text-pink-600 hover:text-pink-700 mb-4"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>

              <div>
                <label className={`block text-sm font-medium mb-2 ${theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-700'}`}>Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className={`w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-pink-500 outline-none ${
                    theme === 'sweet'
                      ? 'border-[#FFB6C1] focus:ring-[#FFB6C1] bg-[#FFF0F5]'
                      : ''
                  }`}
                />
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-700'}`}>
                  Username
                </label>
                <div className="relative">
                  {/* Left Side User Icon */}
                  <User className={`absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 ${theme === 'sweet' ? 'text-[#FF69B4]' : 'text-gray-400'}`} />

                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="sweet_alex"
                    className={`w-full pl-10 pr-10 py-3 border rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all ${theme === 'sweet' ? 'bg-[#FFF0F5]' : ''} ${
                      usernameError ? 'border-red-500' : newUsername && usernameAvailable ? 'border-green-500' : theme === 'sweet' ? 'border-[#FFB6C1]' : 'border-gray-300'
                    }`}
                  />
                  
                  {/* Right Side Loading Spinner */}
                  {checkingUsername && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="w-5 h-5 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  
                  {/* Right Side Success Icon */}
                  {!checkingUsername && newUsername && usernameAvailable && newUsername.toLowerCase().trim() !== profile?.username?.toLowerCase() && (
                    <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-green-500" />
                  )}
                  
                  {/* Right Side Error Icon */}
                  {!checkingUsername && usernameError && (
                    <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-red-500" />
                  )}
                </div>
                
                {/* Error Messaging */}
                {usernameError && (
                  <p className="mt-1 text-sm text-red-600">{usernameError}</p>
                )}
                
                {/* Success Messaging */}
                {!usernameError && newUsername && usernameAvailable && newUsername.toLowerCase().trim() !== profile?.username?.toLowerCase() && (
                  <p className="mt-1 text-sm text-green-600">Username available!</p>
                )}

                <button
                  type="button"
                  onClick={handleChangeUsername}
                  disabled={loading || !usernameAvailable || checkingUsername}
                  className="mt-3 px-4 py-2 bg-pink-500 text-white rounded-xl hover:bg-pink-600 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium shadow-sm"
                >
                  Save Username
                </button>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-700'}`}>Bio</label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value.slice(0, 250))}
                  maxLength={250}
                  rows={4}
                  className={`w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-pink-500 outline-none resize-none ${
                    theme === 'sweet'
                      ? 'border-[#FFB6C1] focus:ring-[#FFB6C1] bg-[#FFF0F5]'
                      : theme === 'dark'
                      ? 'border-gray-700'
                      : 'border-gray-300'
                  }`}
                />
                <p className={`text-xs mt-1 ${theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-500'}`}>{bio.length}/250</p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleUpdateProfile}
                  disabled={loading}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-xl hover:from-pink-600 hover:to-rose-600 disabled:opacity-50"
                >
                  {loading ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  onClick={() => setActiveTab('main')}
                  className={`px-4 py-2 rounded-xl transition-colors ${theme === 'sweet' ? `${sweetCard} ${sweetCardHover} text-[#4B004B]` : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Same reasoning as the Locked Chats tab: without this, anyone
              holding the unlocked phone could switch the app lock off. */}
          {/* Same reasoning as the Locked Chats tab: without this, anyone
              holding the unlocked phone could switch the App Lock off. */}
          {activeTab === 'lock' && !appLockTabUnlocked && user?.id && (
            <AppLockGate
              userId={user.id}
              purpose="settings"
              onUnlock={() => setAppLockTabUnlocked(true)}
              onCancel={() => setActiveTab('main')}
            />
          )}

          {activeTab === 'lock' && appLockTabUnlocked && user?.id && (
            <AppLockSettings
              theme={theme}
              userId={user.id}
              displayName={profile?.display_name || ''}
              onBack={() => setActiveTab('main')}
            />
          )}

          {activeTab === 'privacy' && (
            <div className="p-6 space-y-6">
              <button
                onClick={() => setActiveTab('main')}
                className="flex items-center gap-2 text-pink-600 hover:text-pink-700 mb-4"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>

              <div>
                <label className={`block text-sm font-medium mb-2 ${theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-700'}`}>Last Seen Visibility</label>
                <select
                  value={privacySettings.lastSeenVisibility}
                  onChange={(e) => setPrivacySettings({ ...privacySettings, lastSeenVisibility: e.target.value })}
                  className={`w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-pink-500 outline-none ${theme === 'sweet' ? 'border-[#FFB6C1] text-[#4B004B] bg-[#FFF0F5]' : 'border-gray-300'}`}
                >
                  <option value="everyone">Everyone</option>
                  <option value="friends">Friends Only</option>
                  <option value="nobody">Nobody</option>
                </select>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-700'}`}>Profile Photo Visibility</label>
                <select
                  value={privacySettings.profilePhotoVisibility}
                  onChange={(e) => setPrivacySettings({ ...privacySettings, profilePhotoVisibility: e.target.value })}
                  className={`w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-pink-500 outline-none ${theme === 'sweet' ? 'border-[#FFB6C1] text-[#4B004B] bg-[#FFF0F5]' : 'border-gray-300'}`}
                >
                  <option value="everyone">Everyone</option>
                  <option value="friends">Friends Only</option>
                  <option value="nobody">Nobody</option>
                </select>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-2 ${theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-700'}`}>Who Can Add You</label>
                <select
                  value={privacySettings.whoCanAdd}
                  onChange={(e) => setPrivacySettings({ ...privacySettings, whoCanAdd: e.target.value })}
                  className={`w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-pink-500 outline-none ${theme === 'sweet' ? 'border-[#FFB6C1] text-[#4B004B] bg-[#FFF0F5]' : 'border-gray-300'}`}
                >
                  <option value="everyone">Everyone</option>
                  <option value="friends">Friends Only</option>
                  <option value="nobody">Nobody</option>
                </select>
              </div>

              <button
                onClick={handleUpdatePrivacy}
                disabled={loading}
                className="w-full px-4 py-2 bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-xl hover:from-pink-600 hover:to-rose-600 disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save Privacy Settings'}
              </button>
            </div>
          )}

          {activeTab === 'notifications' && (
            <div className="p-6 space-y-4">
              <button
                onClick={() => setActiveTab('main')}
                className="flex items-center gap-2 text-pink-600 hover:text-pink-700 mb-4"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>

              <div className={`p-4 rounded-2xl flex items-center justify-between shadow-sm mt-4 ${theme === 'sweet' ? sweetCard : 'bg-white border border-pink-100'}`}>
               <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-pink-500 text-lg ${theme === 'sweet' ? sweetInner : 'bg-pink-50'}`}>
                  🍬
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-black uppercase tracking-wider text-pink-600">Sweet Whispers</span>
                  <span className="text-[10px] text-pink-400 font-bold">BACKGROUND NOTIFICATIONS</span>
                </div>
              </div>
      
              <button
                onClick={handleNotificationToggle}
                className={`w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none relative ${
                  notificationsEnabled ? 'bg-pink-500' : theme === 'sweet' ? 'bg-[#FFC0CB]' : 'bg-gray-200'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 bg-white w-5 h-5 rounded-full shadow-md transform transition-transform duration-200 ${
                    notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <p className="text-[11px] text-pink-400/80 font-medium italic mt-2 px-1">
              "Receive a sweet little notification banner whenever someone messages you, even if your browser tab is entirely closed."
        </p>

              <label className={`flex items-center justify-between p-3 rounded-xl ${theme === 'sweet' ? sweetCard : 'bg-gray-50'}`}>
                <span className={`font-medium ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-700'}`}>Message Notifications</span>
                <input
                  type="checkbox"
                  checked={notificationSettings.messageNotifications}
                  onChange={(e) => setNotificationSettings({ ...notificationSettings, messageNotifications: e.target.checked })}
                  className="w-4 h-4"
                />
              </label>

              <label className={`flex items-center justify-between p-3 rounded-xl ${theme === 'sweet' ? sweetCard : 'bg-gray-50'}`}>
                <span className={`font-medium ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-700'}`}>Friend Requests</span>
                <input
                  type="checkbox"
                  checked={notificationSettings.friendRequests}
                  onChange={(e) => setNotificationSettings({ ...notificationSettings, friendRequests: e.target.checked })}
                  className="w-4 h-4"
                />
              </label>

              <label className={`flex items-center justify-between p-3 rounded-xl ${theme === 'sweet' ? sweetCard : 'bg-gray-50'}`}>
                <span className={`font-medium ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-700'}`}>Call Notifications</span>
                <input
                  type="checkbox"
                  checked={notificationSettings.callNotifications}
                  onChange={(e) => setNotificationSettings({ ...notificationSettings, callNotifications: e.target.checked })}
                  className="w-4 h-4"
                />
              </label>

              <label className={`flex items-center justify-between p-3 rounded-xl border-2 ${theme === 'sweet' ? 'bg-[#FFF0F5] border-[#FFB6C1]' : 'bg-gray-50 border-gray-200'}`}>
                <span className={`font-medium ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-700'}`}>Mute All</span>
                <input
                  type="checkbox"
                  checked={notificationSettings.muteAll}
                  onChange={(e) => setNotificationSettings({ ...notificationSettings, muteAll: e.target.checked })}
                  className="w-4 h-4"
                />
              </label>
            </div>
          )}

          {activeTab === 'theme' && (
            <div className="p-6 space-y-6">
              <button
                onClick={() => setActiveTab('main')}
                className="flex items-center gap-2 text-pink-600 hover:text-pink-700 mb-4"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>

              <div>
                <label className={`block text-sm font-medium mb-3 tracking-wide ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900'}`}>
                  App Theme 🎨
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {['sweet', 'light', 'dark'].map((t) => {
                    const isSelected = theme === t;
                    return (
                      <label
                        key={t}
                        className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 cursor-pointer transition-all duration-200 text-center select-none
                          ${isSelected
                            ? (theme === 'sweet' ? 'border-[#FF1493] bg-white text-[#FF1493] shadow-sm scale-[1.02]' : 'border-pink-400 bg-pink-50/80 text-pink-600 shadow-sm scale-[1.02]')
                            : (theme === 'sweet' ? 'border-[#FFD1DC] bg-[#FFF0F5] text-[#8B004B] hover:bg-white hover:border-[#FFB6C1]' : 'border-gray-300 bg-gray-50 text-gray-600 hover:bg-gray-200 hover:border-gray-400')
                         }`}
                      >
                       <input
                         type="radio"
                         name="theme"
                         value={t}
                         checked={isSelected}
                         className="sr-only" // Hidden visually, but keeps keyboard navigation active for accessibility
                         onChange={() => setTheme(t as 'light' | 'dark' | 'sweet')}
                       />
                       <span className="text-xl mb-1">
                         {t === 'sweet' ? '🍬' : t === 'light' ? '☀️' : '🌙'}
                       </span>
                       <span className="text-xs font-semibold capitalize">
                         {t}
                       </span>
                     </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className={`block text-sm font-medium mb-3 ${theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-700'}`}>Chat Themes</label>
                <div className="space-y-2">
                  {['love', 'best_friend', 'friend', 'default'].map((t) => (
                    <div key={t} className={`p-3 rounded-xl ${theme === 'sweet' ? sweetCard : 'border border-gray-200 bg-gray-50'}`}>
                      <p className={`font-medium capitalize ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-700'}`}>{t} Theme</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

{activeTab === 'storage' && (
  <div className={`p-6 space-y-6 animate-fadeIn ${theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-700'}`}>
    {/* Soft Back Button */}
    <button
      onClick={() => setActiveTab('main')}
      className="flex items-center gap-2 text-pink-500 hover:text-pink-600 font-medium transition-colors group select-none"
    >
      <ChevronLeft className="w-4 h-4 transition-transform group-hover:scale-110" />
      <span className="text-sm">Back</span>
    </button>

    {/* Sweetened Storage Display Card */}
    <div className={`relative overflow-hidden p-5 rounded-2xl shadow-sm backdrop-blur-sm ${theme === 'sweet' ? sweetCard : 'bg-gradient-to-br from-pink-50 via-purple-50 to-pink-100/50 border border-pink-200/60'}`}>
      {/* Decorative background candy element */}
      <div className="absolute -right-2 -bottom-2 text-6xl opacity-10 select-none pointer-events-none transform rotate-12">
        🍬
      </div>
      
      <div className="flex items-center gap-2.5 mb-2">
        <span className="text-base" role="img" aria-label="storage">📦</span>
        <p className="text-xs font-bold uppercase tracking-wider text-pink-600/80">
          Local Storage Occupied
        </p>
      </div>
      
      <p className="text-3xl font-black bg-gradient-to-r from-pink-600 to-purple-600 bg-clip-text text-transparent tracking-tight">
        {storageUsed}
      </p>
    </div>

    {/* Candy-Styled Action Button */}
    <button 
      onClick={handleClearCache}
      disabled={isClearing}
      className={`w-full px-5 py-3.5 rounded-2xl font-bold transition-all duration-300 border shadow-sm select-none flex items-center justify-center gap-2
        ${isClearing 
          ? 'bg-pink-50/50 border-pink-100 text-pink-300 cursor-not-allowed animate-pulse' 
          : 'bg-gradient-to-r from-pink-500 to-rose-500 border-pink-400 text-white hover:from-pink-600 hover:to-rose-600 hover:shadow-pink-200 hover:shadow-md active:scale-[0.97]'
        }`}
    >
      <span>{isClearing ? '✨ Sweeping Cache...' : '🧹 Clear Application Cache'}</span>
    </button>
    
    {/* Cozy Helper Text */}
    <div className={`border border-dashed rounded-xl p-3 ${theme === 'sweet' ? 'bg-[#FFF0F5] border-[#FFB6C1]' : 'bg-pink-50/30 border-pink-200/60'}`}>
      <p className="text-center text-[11px] text-pink-600/70 leading-relaxed">
        💝 <strong>No worries:</strong> Your chats live safely on our servers forever — clearing local storage just re-downloads them next time you're online. Messages you're still waiting to send are never touched.
      </p>
    </div>
  </div>
)}

{activeTab === 'performance' && (
  <div className={`p-6 space-y-6 animate-fadeIn transition-colors ${
    theme === 'sweet' ? 'text-[#4B004B]' : theme === 'dark' ? 'text-gray-200' : 'text-gray-700'
  }`}>
    {/* Soft Back Button */}
    <button
      onClick={() => setActiveTab('main')}
      className="flex items-center gap-2 text-pink-500 hover:text-pink-600 font-medium transition-colors group select-none"
    >
      <ChevronLeft className="w-4 h-4 transition-transform group-hover:scale-110" />
      <span className="text-sm">Back</span>
    </button>

    <div className={`relative overflow-hidden p-5 rounded-2xl shadow-sm ${theme === 'sweet' ? sweetCard : 'bg-gradient-to-br from-pink-50 via-purple-50 to-pink-100/50 border border-pink-200/60'}`}>
      <div className="flex items-center gap-2.5 mb-3">
        <span className="text-base" role="img" aria-label="performance">⚡</span>
        <p className="text-xs font-bold uppercase tracking-wider text-pink-600/80">
          App Performance
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className={`rounded-xl p-3 ${theme === 'sweet' ? sweetInner : 'bg-white/50'}`}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-pink-600/60 mb-1">Live FPS</p>
          <LiveFpsValue />
        </div>
        <div className={`rounded-xl p-3 ${theme === 'sweet' ? sweetInner : 'bg-white/50'}`}>
          <p className="text-[10px] font-bold uppercase tracking-wider text-pink-600/60 mb-1">Device Tier</p>
          <p className="text-2xl font-black capitalize text-[#4B004B]">{deviceTier}</p>
        </div>
      </div>

      <p className="text-[11px] text-pink-600/70 mb-3">
        {override === 'auto' && isLowPerfMode &&
          '✨ Auto: currently running reduced effects because we detected low performance.'}
        {override === 'auto' && !isLowPerfMode &&
          '✨ Auto: currently running full effects — performance looks good.'}
        {override === 'force-low' &&
          'Manually locked to reduced effects, regardless of measured performance.'}
        {override === 'force-high' &&
          'Manually locked to full effects, even if performance is measured as poor.'}
      </p>

      <div className="flex gap-2">
        {(['auto', 'force-low', 'force-high'] as const).map((opt) => (
          <button
            key={opt}
            onClick={() => setOverride(opt)}
            className={`flex-1 py-2 rounded-xl text-[11px] font-bold transition-colors ${
              override === opt
                ? 'bg-pink-500 text-white'
                : theme === 'sweet'
                ? `${sweetInner} text-pink-600/70 hover:bg-white`
                : 'bg-white/60 text-pink-600/70 hover:bg-white'
            }`}
          >
            {opt === 'auto' ? 'Auto' : opt === 'force-low' ? 'Low Effects' : 'Full Effects'}
          </button>
        ))}
      </div>
    </div>

    {/* On-screen FPS overlay toggle */}
    <div className={`rounded-2xl p-4 flex items-center justify-between gap-4 ${
      theme === 'sweet' ? sweetCard : theme === 'dark' ? 'border bg-gray-800/50 border-gray-700' : 'border bg-white/50 border-pink-200/60'
    }`}>
      <div>
        <p className="text-sm font-bold">Show FPS on screen</p>
        <p className={`text-[11px] mt-0.5 ${theme === 'sweet' ? 'text-[#8B004B]' : theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
          A small live readout stays visible on every screen, positioned out of the way of your chats.
        </p>
      </div>
      <button
        onClick={() => setShowOverlay(!showOverlay)}
        className={`shrink-0 w-12 h-7 rounded-full transition-colors relative ${
          showOverlay
            ? (theme === 'sweet' ? 'bg-[#FF1493]' : 'bg-pink-500')
            : (theme === 'sweet' ? 'bg-[#FFD1DC]' : 'bg-gray-300 dark:bg-gray-600')
        }`}
      >
        <span
          className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
            showOverlay ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  </div>
)}

{/* The vault settings can switch the lock off or replace the PIN, so
    they're guarded by the same check as the locked chats themselves —
    otherwise anyone holding the unlocked phone could just turn it off. */}
{activeTab === 'locked' && !lockedTabUnlocked && user?.id && (
  <VaultGate
    theme={theme}
    userId={user.id}
    purpose="settings"
    onUnlock={() => setLockedTabUnlocked(true)}
    onCancel={leaveLockedTab}
  />
)}

{activeTab === 'locked' && lockedTabUnlocked && user?.id && (
            <LockedChatsSettings
              theme={theme}
              userId={user.id}
              displayName={profile?.display_name || ''}
              onBack={leaveLockedTab}
            />
          )}
        </div>
      </div>
    </>
  );
}