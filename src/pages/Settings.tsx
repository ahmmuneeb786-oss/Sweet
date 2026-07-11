import React, { useState, useEffect } from 'react';
import { ChevronRight, X, Bell, Lock, Palette, HardDrive, LogOut, User, Shield, ShieldCheck, Smile, CheckCircle, AlertCircle, ChevronLeft, Zap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { PermissionManager } from '../services/PermissionManager';
import { StrictLock } from '../components/StrictLock';
import { localDB } from '../db';
import { hashSecret } from '../lib/secureHash';
import { useNotify } from '../contexts/NotificationContext';
import { usePerformance } from '../contexts/PerformanceContext';


type SettingsTab = 'main' | 'account' | 'privacy' | 'notifications' | 'theme' | 'storage' | 'locked' | 'lock' | 'performance';

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
  face_lock_enabled?: boolean;
  face_descriptor?: number[] | null;
  chat_security_type?: 'none' | 'pin' | 'password' | 'biometric';
  chat_biometric_type?: 'face' | 'fingerprint' | null;
  chat_pin?: string | null;
  chat_password?: string | null;
}

export function Settings({ onClose, theme, setTheme, faceLockEnabled, setFaceLockEnabled, onRegisterFace, user, savedDescriptor, onCloseLockedPanel }: SettingsProps) {
  // 3. Destructure and apply the typecast ('as SecureProfile')
  const { profile: rawProfile, updateProfile, signOut } = useAuth();
  const { showSuccess, showError, showInfo } = useNotify();
  const { fps, deviceTier, isLowPerfMode, override, setOverride, showOverlay, setShowOverlay } = usePerformance();
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
  const [showFaceScanner, setShowFaceScanner] = useState(false);
  const [faceScannerMode, setFaceScannerMode] = useState<'verify' | 'register'>('verify');
  const [showPinModal, setPinModal] = useState(false);
  const [pinStep, setPinStep] = useState<'enter' | 'confirm'>('enter');
  const [tempPin, setTempPin] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [tempPassword, setTempPassword] = useState('');
  const [savedPin, setSavedPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [securityType, setSecurityType] = useState<'none' | 'pin' | 'password' | 'biometric'>(
    profile?.chat_security_type || 'none'
  );

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

  // Handles PIN code entry flow sequence logic
  const handlePinKeyPress = async (digit: string) => {
    if (tempPin.length >= 4) return;
    const nextPin = tempPin + digit;
    setTempPin(nextPin);

    // If it reaches exactly 4 numbers, process validation step
    if (nextPin.length === 4) {
      if (pinStep === 'enter') {
        // First entry step complete. Save it temporarily and switch to confirm view step
        setSavedPin(nextPin);
        setTimeout(() => {
          setTempPin('');
          setPinStep('confirm');
        }, 300);
      } else if (pinStep === 'confirm') {
        // Check if secondary confirmation pattern matches first try perfectly
        if (nextPin === savedPin) {
          try {
            setSecurityType('pin');
            const hashedPin = await hashSecret(nextPin, user?.id || '');
            await supabase
              .from('profiles')
              .update({ 
                chat_pin: hashedPin,
                chat_security_type: 'pin' 
              })
              .eq('id', user?.id);
            
            showSuccess("Security PIN successfully set up!");
            setPinModal(false);
            setTempPin('');
            setPinStep('enter');
          } catch (err) {
            console.error(err);
            showError("Could not update secure PIN configuration framework layers.");
          }
        } else {
          showError("PIN codes did not match up! Let's try again.");
          setTempPin('');
          setPinStep('enter');
        }
      }
    }
  };
  
  useEffect(() => {
    if (profile?.chat_security_type) {
      setSecurityType(profile.chat_security_type);
    }
  }, [profile?.chat_security_type]);

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
        <div className="p-6 border-b border-[#FFB6C1] flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === 'main' && (
            <div className="divide-y divide-[#FFB6C1]">
              {settingsSections.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveTab(section.id as SettingsTab)}
                    className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="w-5 h-5 text-gray-600" />
                      <span className="text-gray-900 font-medium">{section.label}</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  </button>
                );
              })}
              <button
                onClick={async () => {
                  await signOut();
                  onClose();
                }}
                className="w-full p-4 flex items-center justify-between hover:bg-red-50 transition-colors text-red-600"
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
                <label className="block text-sm font-medium text-gray-700 mb-2">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className={`w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-pink-500 outline-none ${
                    theme === 'sweet'
                      ? 'border-[#FFB6C1] focus:ring-[#FFB6C1]'
                      : ''
                  }`}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Username
                </label>
                <div className="relative">
                  {/* Left Side User Icon */}
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="sweet_alex"
                    className={`w-full pl-10 pr-10 py-3 border rounded-xl focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none transition-all ${
                      usernameError ? 'border-red-500' : newUsername && usernameAvailable ? 'border-green-500' : 'border-gray-300'
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
                <label className="block text-sm font-medium text-gray-700 mb-2">Bio</label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value.slice(0, 250))}
                  maxLength={250}
                  rows={4}
                  className={`w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-pink-500 outline-none resize-none ${
                    theme === 'sweet'
                      ? 'border-[#FFB6C1] focus:ring-[#FFB6C1]'
                      : theme === 'dark'
                      ? 'border-gray-700'
                      : 'border-gray-300'
                  }`}
                />
                <p className="text-xs text-gray-500 mt-1">{bio.length}/250</p>
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
                  className="px-4 py-2 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {activeTab === 'lock' && (
  <div className="p-6 space-y-6">
    <button
      onClick={() => setActiveTab('main')}
      className="flex items-center gap-2 text-pink-600 hover:text-pink-700 mb-4"
    >
      <X className="w-4 h-4" />
      Back
    </button>

    <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white rounded-lg text-pink-500 shadow-sm">
            <Smile size={20} />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-800">Face lock</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-tight">Biometric Security</p>
          </div>
        </div>

        {/* The Toggle Button */}
<button
  type="button"
  onClick={async () => {
    if (!user?.id) return;

    const nextState = !faceLockEnabled;

    // 1. IF THE USER IS TURNING IT ON: Check if they actually have a face registered
    if (nextState) {
      const hasFaceData = Array.isArray(savedDescriptor) && savedDescriptor.length > 0;
      
      if (!hasFaceData) {
        // Stop here! Open the face scanner overlay, but DO NOT flip the main toggle yet.
        onRegisterFace();
        return; 
      }
    }

    // 2. IF THEY HAVE DATA (or are turning it OFF): Safely run the state change
    try {
      // Snappy local update
      setFaceLockEnabled(nextState);

      // Persist to database
      const { error } = await supabase
        .from('profiles')
        .update({ face_lock_enabled: nextState })
        .eq('id', user.id);

      if (error) {
        setFaceLockEnabled(faceLockEnabled); // Rollback on failure
        throw error;
      }
    } catch (err) {
      console.error("Failed to save toggle state to cloud:", err);
      showError("Could not update settings. Check network connection.");
    }
  }}
  className={`w-12 h-6 rounded-full transition-all duration-300 relative p-1 cursor-pointer outline-none ${
    faceLockEnabled ? 'bg-pink-500 shadow-md shadow-pink-200' : 'bg-gray-300'
  }`}
>
  {/* The sliding white dot indicator */}
  <div 
    className={`w-4 h-4 bg-white rounded-full shadow-md transition-transform duration-300 ease-out ${
      faceLockEnabled ? 'translate-x-6' : 'translate-x-0'
    }`}
  />
</button>
      </div>
      
      <p className="mt-4 text-xs text-gray-500 leading-relaxed italic">
        "An inbuilt biometric lock that uses your unique facial features to secure the app. When enabled, you'll need to verify your identity with a quick face scan each time you open the app, ensuring that only you can access your messages and data. It's like having a personal security guard that's always on duty, providing an extra layer of protection for your private conversations."
      </p>
    </div>
  </div>
)}

          {activeTab === 'privacy' && (
            <div className="p-6 space-y-6">
              <button
                onClick={() => setActiveTab('main')}
                className="flex items-center gap-2 text-pink-600 hover:text-pink-700 mb-4"
              >
                <X className="w-4 h-4" />
                Back
              </button>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Last Seen Visibility</label>
                <select
                  value={privacySettings.lastSeenVisibility}
                  onChange={(e) => setPrivacySettings({ ...privacySettings, lastSeenVisibility: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none"
                >
                  <option value="everyone">Everyone</option>
                  <option value="friends">Friends Only</option>
                  <option value="nobody">Nobody</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Profile Photo Visibility</label>
                <select
                  value={privacySettings.profilePhotoVisibility}
                  onChange={(e) => setPrivacySettings({ ...privacySettings, profilePhotoVisibility: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none"
                >
                  <option value="everyone">Everyone</option>
                  <option value="friends">Friends Only</option>
                  <option value="nobody">Nobody</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Who Can Add You</label>
                <select
                  value={privacySettings.whoCanAdd}
                  onChange={(e) => setPrivacySettings({ ...privacySettings, whoCanAdd: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none"
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
                <X className="w-4 h-4" />
                Back
              </button>

              <div className="p-4 bg-white rounded-2xl border border-pink-100 flex items-center justify-between shadow-sm mt-4">
               <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-pink-50 flex items-center justify-center text-pink-500 text-lg">
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
                  notificationsEnabled ? 'bg-pink-500' : 'bg-gray-200'
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

              <label className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                <span className="text-gray-700 font-medium">Message Notifications</span>
                <input
                  type="checkbox"
                  checked={notificationSettings.messageNotifications}
                  onChange={(e) => setNotificationSettings({ ...notificationSettings, messageNotifications: e.target.checked })}
                  className="w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                <span className="text-gray-700 font-medium">Friend Requests</span>
                <input
                  type="checkbox"
                  checked={notificationSettings.friendRequests}
                  onChange={(e) => setNotificationSettings({ ...notificationSettings, friendRequests: e.target.checked })}
                  className="w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                <span className="text-gray-700 font-medium">Call Notifications</span>
                <input
                  type="checkbox"
                  checked={notificationSettings.callNotifications}
                  onChange={(e) => setNotificationSettings({ ...notificationSettings, callNotifications: e.target.checked })}
                  className="w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border-2 border-gray-200">
                <span className="text-gray-700 font-medium">Mute All</span>
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
                <X className="w-4 h-4" />
                Back
              </button>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-3 tracking-wide">
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
                            ? 'border-pink-400 bg-pink-50/80 text-pink-600 shadow-sm scale-[1.02]' 
                            : 'border-gray-300 bg-gray-50 text-gray-600 hover:bg-gray-200 hover:border-gray-400'
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
                <label className="block text-sm font-medium text-gray-700 mb-3">Chat Themes</label>
                <div className="space-y-2">
                  {['love', 'best_friend', 'friend', 'default'].map((t) => (
                    <div key={t} className="p-3 border border-gray-200 rounded-xl bg-gray-50">
                      <p className="text-gray-700 font-medium capitalize">{t} Theme</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

{activeTab === 'storage' && (
  <div className="p-6 space-y-6 animate-fadeIn text-gray-700">
    {/* Soft Back Button */}
    <button
      onClick={() => setActiveTab('main')}
      className="flex items-center gap-2 text-pink-500 hover:text-pink-600 font-medium transition-colors group select-none"
    >
      <X className="w-4 h-4 transition-transform group-hover:scale-110" />
      <span className="text-sm">Back</span>
    </button>

    {/* Sweetened Storage Display Card */}
    <div className="relative overflow-hidden bg-gradient-to-br from-pink-50 via-purple-50 to-pink-100/50 border border-pink-200/60 p-5 rounded-2xl shadow-sm backdrop-blur-sm">
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
    <div className="bg-pink-50/30 border border-dashed border-pink-200/60 rounded-xl p-3">
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
    <div className="relative overflow-hidden bg-gradient-to-br from-pink-50 via-purple-50 to-pink-100/50 border border-pink-200/60 p-5 rounded-2xl shadow-sm">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="text-base" role="img" aria-label="performance">⚡</span>
        <p className="text-xs font-bold uppercase tracking-wider text-pink-600/80">
          App Performance
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-white/50 rounded-xl p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-pink-600/60 mb-1">Live FPS</p>
          <p className={`text-2xl font-black ${fps < 40 ? 'text-red-500' : fps < 55 ? 'text-amber-500' : 'text-green-600'}`}>
            {fps}
          </p>
        </div>
        <div className="bg-white/50 rounded-xl p-3">
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
                : 'bg-white/60 text-pink-600/70 hover:bg-white'
            }`}
          >
            {opt === 'auto' ? 'Auto' : opt === 'force-low' ? 'Low Effects' : 'Full Effects'}
          </button>
        ))}
      </div>
    </div>

    {/* On-screen FPS overlay toggle */}
    <div className="bg-white/50 dark:bg-gray-800/50 border border-pink-200/60 dark:border-gray-700 rounded-2xl p-4 flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-bold">Show FPS on screen</p>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
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

{activeTab === 'locked' && (
            <div className={`p-6 space-y-6 animate-fadeIn transition-colors ${
              theme === 'sweet' ? 'text-[#4B004B]' : theme === 'dark' ? 'text-gray-200' : 'text-gray-700'
            }`}>
              {/* Biometric FaceID Overlay Controller */}
              {showFaceScanner && (
                <StrictLock
                  userId={user?.id || 'guest'}
                  mode={faceScannerMode}
                  savedDescriptor={profile?.face_descriptor || null}
                  onSaveDescriptor={async (uid, descriptorArray) => {
                    try {
                      const { error } = await supabase
                        .from('profiles')
                        .update({ 
                          face_descriptor: descriptorArray,
                          chat_security_type: 'biometric',
                          chat_biometric_type: 'face'
                        })
                        .eq('id', uid);

                      if (error) throw error;
                      setSecurityType('biometric');
                      setShowFaceScanner(false);
                    } catch (err) {
                      console.error("Cloud saving descriptor failed:", err);
                      showError("Could not sync biometric information to cloud.");
                    }
                  }}
                  onUnlock={() => {
                    if (faceScannerMode === 'verify') {
                      const updateSecurity = async () => {
                        await supabase
                          .from('profiles')
                          .update({ chat_security_type: 'biometric', chat_biometric_type: 'face' })
                          .eq('id', user?.id);
                        setSecurityType('biometric');
                      };
                      updateSecurity();
                    }
                    setShowFaceScanner(false);
                  }}
                  onRegisterSuccess={() => {
                    setSecurityType('biometric');
                    setShowFaceScanner(false);
                  }}
                />
              )}

              {/* Header Navigation Bar */}
              <div className={`flex items-center justify-between border-b pb-3 transition-colors ${
                theme === 'sweet' ? 'border-[#FFB6C1]' : theme === 'dark' ? 'border-gray-800' : 'border-gray-100'
              }`}>
                <button
                  onClick={() => {
                    setPinModal(false);
                    setShowPasswordModal(false);
                    if (typeof onCloseLockedPanel === 'function') {
                      onCloseLockedPanel(); // Closes standalone overlay if opened directly
                    } else {
                      setActiveTab('main'); // Falls back to standard settings navigation
                    }
                  }}
                  className={`flex items-center gap-2 font-medium transition-colors select-none ${
                    theme === 'sweet' ? 'text-[#FF69B4] hover:text-[#FF1493]' : theme === 'dark' ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span className="text-sm">Back</span>
                </button>
                <span className={`text-xs font-bold px-2 py-1 rounded-full border transition-colors ${
                  theme === 'sweet' ? 'bg-[#FFC0CB]/30 text-[#8B004B] border-[#FFB6C1]' : theme === 'dark' ? 'bg-gray-800 text-gray-400 border-gray-700' : 'bg-gray-100 text-gray-600 border-gray-200'
                }`}>
                  Vault Security 🔒
                </span>
              </div>

              {/* Primary Controls Interface */}
              {!showPinModal && !showPasswordModal && (
                <div className="space-y-3">
                  <div className={`p-4 rounded-2xl border transition-colors ${
                    theme === 'sweet' ? 'bg-[#FFC0CB]/20 border-[#FFB6C1]' : theme === 'dark' ? 'bg-gray-800/30 border-gray-800' : 'bg-gray-50 border-gray-200'
                  }`}>
                    <p className={`text-xs font-medium leading-relaxed ${
                      theme === 'sweet' ? 'text-[#8B004B]' : theme === 'dark' ? 'text-gray-400' : 'text-gray-500'
                    }`}>
                      Choose your signature security barrier configuration. Secured chats are decoupled from the main thread rendering layout until authentic responses are verified.
                    </p>
                  </div>

                  {/* OPTION 1: REMOVE LOCK PROTECTION */}
                  <label className={`flex items-center justify-between p-3.5 border rounded-2xl cursor-pointer transition-all ${
                    theme === 'sweet'
                      ? securityType === 'none' ? 'border-[#FF69B4] bg-[#FFC0CB]/10' : 'border-[#FFB6C1] bg-[#FFE4E1]'
                      : theme === 'dark'
                        ? securityType === 'none' ? 'border-gray-600 bg-gray-800' : 'border-gray-800 bg-gray-900/50 hover:border-gray-700'
                        : securityType === 'none' ? 'border-gray-400 bg-gray-50' : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`text-lg p-2 rounded-xl ${theme === 'dark' ? 'bg-gray-800' : theme === 'sweet' ? 'bg-[#FFC0CB]/40' : 'bg-gray-100'}`}>
                        🔓
                      </div>
                      <div className="space-y-0.5">
                        <h4 className={`text-sm font-bold ${theme === 'dark' ? 'text-gray-200' : theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-800'}`}>Unprotected</h4>
                        <p className={`text-[11px] ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Chats stay visible inside your standard lists.</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold ${securityType === 'none' ? (theme === 'sweet' ? 'text-[#FF69B4]' : theme === 'dark' ? 'text-gray-300' : 'text-gray-700') : 'text-gray-400'}`}>
                        {securityType === 'none' ? 'Active' : ''}
                      </span>
                      <input 
                        type="radio" 
                        name="security_type" 
                        checked={securityType === 'none'}
                        onChange={async () => {
                          setSecurityType('none');
                          await supabase.from('profiles').update({ chat_security_type: 'none' }).eq('id', user?.id);
                        }}
                        className={`h-4 w-4 ${theme === 'sweet' ? 'accent-[#FF69B4]' : theme === 'dark' ? 'accent-gray-400' : 'accent-gray-800'}`}
                      />
                    </div>
                  </label>

                  {/* OPTION 2: THE 4-DIGIT PIN */}
                  <label className={`flex items-center justify-between p-3.5 border rounded-2xl cursor-pointer transition-all ${
                    theme === 'sweet'
                      ? securityType === 'pin' ? 'border-[#FF69B4] bg-[#FFC0CB]/10' : 'border-[#FFB6C1] bg-[#FFE4E1]'
                      : theme === 'dark'
                        ? securityType === 'pin' ? 'border-gray-600 bg-gray-800' : 'border-gray-800 bg-gray-900/50 hover:border-gray-700'
                        : securityType === 'pin' ? 'border-gray-400 bg-gray-50' : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`text-lg p-2 rounded-xl ${theme === 'dark' ? 'bg-gray-800' : theme === 'sweet' ? 'bg-[#FFC0CB]/40' : 'bg-gray-100'}`}>
                        🔢
                      </div>
                      <div className="space-y-0.5">
                        <h4 className={`text-sm font-bold ${theme === 'dark' ? 'text-gray-200' : theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-800'}`}>4-Digit Security PIN</h4>
                        <p className={`text-[11px] ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Secure entry using lightweight numbers code sequence.</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold ${securityType === 'pin' ? (theme === 'sweet' ? 'text-[#FF69B4]' : theme === 'dark' ? 'text-gray-300' : 'text-gray-700') : 'text-gray-400'}`}>
                        {securityType === 'pin' ? 'Engaged' : ''}
                      </span>
                      <input 
                        type="radio" 
                        name="security_type" 
                        checked={securityType === 'pin'}
                        onChange={() => {
                          setTempPin("");
                          setPinStep('enter');
                          setPinModal(true);
                        }}
                        className={`h-4 w-4 ${theme === 'sweet' ? 'accent-[#FF69B4]' : theme === 'dark' ? 'accent-gray-400' : 'accent-gray-800'}`}
                      />
                    </div>
                  </label>

                  {/* OPTION 3: THE COMPACT TEXT PASSWORD PROTECTOR */}
                  <label className={`flex items-center justify-between p-3.5 border rounded-2xl cursor-pointer transition-all ${
                    theme === 'sweet'
                      ? securityType === 'password' ? 'border-[#FF69B4] bg-[#FFC0CB]/10' : 'border-[#FFB6C1] bg-[#FFE4E1]'
                      : theme === 'dark'
                        ? securityType === 'password' ? 'border-gray-600 bg-gray-800' : 'border-gray-800 bg-gray-900/50 hover:border-gray-700'
                        : securityType === 'password' ? 'border-gray-400 bg-gray-50' : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className={`text-lg p-2 rounded-xl ${theme === 'dark' ? 'bg-gray-800' : theme === 'sweet' ? 'bg-[#FFC0CB]/40' : 'bg-gray-100'}`}>
                        🔏
                      </div>
                      <div className="space-y-0.5">
                        <h4 className={`text-sm font-bold ${theme === 'dark' ? 'text-gray-200' : theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-800'}`}>Text Alphanumeric Password</h4>
                        <p className={`text-[11px] ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Deploy custom string codes rules.</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold ${securityType === 'password' ? (theme === 'sweet' ? 'text-[#FF69B4]' : theme === 'dark' ? 'text-gray-300' : 'text-gray-700') : 'text-gray-400'}`}>
                        {securityType === 'password' ? 'Active' : ''}
                      </span>
                      <input 
                        type="radio" 
                        name="security_type" 
                        checked={securityType === 'password'}
                        onChange={() => {
                          setTempPassword("");
                          setShowPasswordModal(true);
                        }}
                        className={`h-4 w-4 ${theme === 'sweet' ? 'accent-[#FF69B4]' : theme === 'dark' ? 'accent-gray-400' : 'accent-gray-800'}`}
                      />
                    </div>
                  </label>

                  {/* OPTION 4: BIOMETRIC RECOGNITION PANEL */}
                  <div className={`p-3.5 border rounded-2xl transition-all space-y-3 ${
                    theme === 'sweet'
                      ? securityType === 'biometric' ? 'border-[#FF69B4] bg-[#FFC0CB]/10' : 'border-[#FFB6C1] bg-[#FFE4E1]'
                      : theme === 'dark'
                        ? securityType === 'biometric' ? 'border-gray-600 bg-gray-800/40' : 'border-gray-800 bg-gray-900/50'
                        : securityType === 'biometric' ? 'border-gray-400 bg-gray-50' : 'border-gray-200 bg-white'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`text-lg p-2 rounded-xl ${theme === 'dark' ? 'bg-gray-800' : theme === 'sweet' ? 'bg-[#FFC0CB]/40' : 'bg-gray-100'}`}>
                          🧬
                        </div>
                        <div className="space-y-0.5">
                          <h4 className={`text-sm font-bold ${theme === 'dark' ? 'text-gray-200' : theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-800'}`}>Biometric Verification Array</h4>
                          <p className={`text-[11px] ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Locks conversational nodes using biometric configurations.</p>
                        </div>
                      </div>
                      <input 
                        type="radio" 
                        name="security_type" 
                        checked={securityType === 'biometric'}
                        onChange={() => {
                          const runtimeDescriptor = profile?.face_descriptor;
                          if (Array.isArray(runtimeDescriptor) && runtimeDescriptor.length > 0) {
                            setFaceScannerMode('verify');
                          } else {
                            setFaceScannerMode('register');
                          }
                          setShowFaceScanner(true);
                        }}
                        className={`h-4 w-4 ${theme === 'sweet' ? 'accent-[#FF69B4]' : theme === 'dark' ? 'accent-gray-400' : 'accent-gray-800'}`}
                      />
                    </div>

                    {/* Sub-choices configuration panel */}
                    <div className="grid grid-cols-2 gap-2.5 pt-1">
                      {/* FACE VECTOR TOGGLE */}
                      <button
                        type="button"
                        onClick={() => {
                          const runtimeDescriptor = profile?.face_descriptor;
                          if (Array.isArray(runtimeDescriptor) && runtimeDescriptor.length > 0) {
                            setFaceScannerMode('verify');
                          } else {
                            setFaceScannerMode('register');
                          }
                          setShowFaceScanner(true);
                        }}
                        className={`p-3 text-left rounded-xl border flex flex-col gap-1 transition-all ${
                          theme === 'sweet'
                            ? securityType === 'biometric' && profile?.chat_biometric_type === 'face' ? 'border-[#FF69B4] bg-[#FFE4E1]' : 'border-[#FFB6C1] bg-white/40'
                            : theme === 'dark'
                              ? securityType === 'biometric' && profile?.chat_biometric_type === 'face' ? 'border-gray-500 bg-gray-900' : 'border-gray-700 bg-gray-800/30'
                              : securityType === 'biometric' && profile?.chat_biometric_type === 'face' ? 'border-gray-400 bg-gray-100' : 'border-gray-200 bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className={`text-xs font-bold ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>📸 FaceID Map</span>
                          <div className={`w-2 h-2 rounded-full ${profile?.face_descriptor ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                        </div>
                        <span className="text-[10px] text-gray-400">
                          {profile?.face_descriptor ? "Verified & Saved" : "Setup Missing"}
                        </span>
                      </button>

                      {/* TOUCH MATRIX TOGGLE */}
                      <button
                        type="button"
                        onClick={async () => {
                          if (window.PublicKeyCredential) {
                            try {
                              const nativeHardwareAvailable = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
                              if (nativeHardwareAvailable) {
                                setSecurityType('biometric');
                                await supabase.from('profiles').update({ 
                                  chat_security_type: 'biometric',
                                  chat_biometric_type: 'fingerprint'
                                }).eq('id', user?.id);
                                showSuccess("Fingerprint hardware checked successfully!");
                              } else {
                                showError("Biometric module missing on current device profile.");
                              }
                            } catch (e) {
                              console.warn(e);
                            }
                          } else {
                            showError("Authentication framework not supported by container layers.");
                          }
                        }}
                        className={`p-3 text-left rounded-xl border flex flex-col gap-1 transition-all ${
                          theme === 'sweet'
                            ? securityType === 'biometric' && profile?.chat_biometric_type === 'fingerprint' ? 'border-[#FF69B4] bg-[#FFE4E1]' : 'border-[#FFB6C1] bg-white/40'
                            : theme === 'dark'
                              ? securityType === 'biometric' && profile?.chat_biometric_type === 'fingerprint' ? 'border-gray-500 bg-gray-900' : 'border-gray-700 bg-gray-800/30'
                              : securityType === 'biometric' && profile?.chat_biometric_type === 'fingerprint' ? 'border-gray-400 bg-gray-100' : 'border-gray-200 bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className={`text-xs font-bold ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>☝️ TouchID Matrix</span>
                          <div className={`w-2 h-2 rounded-full ${securityType === 'biometric' && profile?.chat_biometric_type === 'fingerprint' ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                        </div>
                        <span className="text-[10px] text-gray-400">
                          Hardware Matrix Check
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* INLINE PIN NUMPAD DESIGN VIEW */}
              {showPinModal && (
                <div className={`text-center space-y-4 py-4 rounded-2xl border p-4 shadow-sm animate-scaleIn transition-colors ${
                  theme === 'sweet' ? 'bg-[#FFE4E1] border-[#FFB6C1]' : theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
                }`}>
                  <p className={`text-sm font-black ${theme === 'sweet' ? 'text-[#FF69B4]' : theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>
                    {pinStep === 'enter' ? 'Create Secure Vault PIN 🔑' : 'Confirm Your Secure Vault PIN 🌸'}
                  </p>
                  
                  <div className="flex justify-center gap-4 py-2">
                    {[0, 1, 2, 3].map((index) => (
                      <div 
                        key={index} 
                        className={`w-3 h-3 rounded-full border-2 transition-all duration-150 ${
                          tempPin.length > index 
                            ? theme === 'sweet' ? 'bg-[#FF69B4] border-[#FF69B4]' : theme === 'dark' ? 'bg-gray-400 border-gray-400' : 'bg-gray-800 border-gray-800 scale-110 shadow-sm' 
                            : theme === 'dark' ? 'border-gray-700 bg-gray-800' : 'border-gray-300 bg-gray-50'
                        }`}
                      />
                    ))}
                  </div>

                  <div className="max-w-[220px] mx-auto grid grid-cols-3 gap-3 pt-2">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                      <button
                        key={num}
                        onClick={() => handlePinKeyPress(num.toString())}
                        className={`h-11 w-11 mx-auto flex items-center justify-center rounded-full font-bold transition-all text-sm active:scale-90 border ${
                          theme === 'sweet' ? 'bg-[#FFC0CB]/40 border-[#FFB6C1] text-[#4B004B] hover:border-[#FF69B4]' : theme === 'dark' ? 'bg-gray-800 border-gray-700 text-gray-200 hover:border-gray-500' : 'bg-gray-50 border border-gray-200 text-gray-700 hover:border-gray-400'
                        }`}
                      >
                        {num}
                      </button>
                    ))}
                    <button 
                      onClick={() => setTempPin(prev => prev.slice(0, -1))}
                      className="h-11 w-11 mx-auto flex items-center justify-center text-xs font-semibold text-gray-400 hover:text-red-500 select-none"
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => handlePinKeyPress("0")}
                      className={`h-11 w-11 mx-auto flex items-center justify-center rounded-full font-bold text-sm active:scale-90 border ${
                        theme === 'sweet' ? 'bg-[#FFC0CB]/40 border-[#FFB6C1] text-[#4B004B]' : theme === 'dark' ? 'bg-gray-800 border-gray-700 text-gray-200' : 'bg-gray-50 border border-gray-200 text-gray-700'
                      }`}
                    >
                      0
                    </button>
                    <button 
                      onClick={() => {
                        setPinModal(false);
                        setTempPin('');
                        setPinStep('enter');
                      }}
                      className="h-11 w-11 mx-auto flex items-center justify-center text-xs font-semibold text-gray-400 hover:text-gray-600 select-none"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* ALPHANUMERIC PASSWORD VIEW MODAL */}
              {showPasswordModal && (
                <div className={`rounded-2xl border p-5 shadow-sm space-y-4 animate-scaleIn transition-colors ${
                  theme === 'sweet' ? 'bg-[#FFE4E1] border-[#FFB6C1]' : theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
                }`}>
                  <div className="space-y-1">
                    <h4 className={`text-sm font-black ${theme === 'sweet' ? 'text-[#FF69B4]' : theme === 'dark' ? 'text-gray-200' : 'text-gray-800'}`}>Establish Alphanumeric Password</h4>
                    <p className={`text-[11px] ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Type structural sequence keys to hide conversation trees.</p>
                  </div>
                  <input 
                    type="password"
                    placeholder="Enter secret phrase..."
                    value={tempPassword}
                    onChange={(e) => setTempPassword(e.target.value)}
                    className={`w-full px-4 py-2.5 rounded-xl text-sm outline-none transition-all border ${
                      theme === 'sweet' ? 'bg-[#FFC0CB]/20 border-[#FFB6C1] focus:ring-2 focus:ring-[#FF69B4] text-[#4B004B]' : theme === 'dark' ? 'bg-gray-800 border-gray-700 focus:ring-2 focus:ring-gray-600 text-gray-100' : 'bg-gray-50 border border-gray-200 focus:ring-2 focus:ring-gray-400 focus:bg-white text-gray-800'
                    }`}
                  />
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!tempPassword.trim()) return showError("Password configuration requirements can't be blank!");
                        setSecurityType('password');
                        const hashedPassword = await hashSecret(tempPassword, user?.id || '');
                        await supabase.from('profiles').update({ 
                          chat_password: hashedPassword,
                          chat_security_type: 'password'
                        }).eq('id', user?.id);
                        setShowPasswordModal(false);
                      }}
                      className={`flex-1 py-2 text-white rounded-xl text-xs font-bold transition-colors ${
                        theme === 'sweet' ? 'bg-[#FF1493] hover:bg-[#FF69B4]' : theme === 'dark' ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-800 hover:bg-gray-900'
                      }`}
                    >
                      Apply Protection
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPasswordModal(false)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
                        theme === 'dark' ? 'bg-gray-800 hover:bg-gray-700 text-gray-300' : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                      }`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}