import React, { useState, useEffect } from 'react';
import { ChevronRight, X, Bell, Lock, Palette, HardDrive, LogOut, User, Shield, ShieldCheck, CheckCircle, AlertCircle, ChevronLeft, Zap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { VaultGate } from '../components/VaultGate';
import { LockedChatsSettings } from '../components/LockedChatsSettings';
import { AppLockGate } from '../components/AppLockGate';
import { AppLockSettings } from '../components/AppLockSettings';
import { OfflineBadge } from '../components/OfflineBadge';
import { localDB } from '../db';
import { useNotify } from '../contexts/NotificationContext';
import { usePerformance, useFps } from '../contexts/PerformanceContext';
import { StorageTab } from '../components/storage/StorageTab';
import { ThemeTab } from '../components/theme/ThemeTab';
import { NotificationsTab } from '../components/notifications/NotificationsTab';

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
export function Settings({ onClose, theme, user, onCloseLockedPanel }: SettingsProps) {
  // 3. Destructure and apply the typecast ('as SecureProfile')
  const { profile: rawProfile, updateProfile, signOut } = useAuth();
  const { showSuccess } = useNotify();
  const { deviceTier, perfLevel, override, setOverride, showOverlay, setShowOverlay } = usePerformance();
  const profile = rawProfile as SecureProfile; // ✨ This instantly cleans up all profile red marks!

  const [activeTab, setActiveTab] = useState<SettingsTab>('main');


  // Your local states are already correct!
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [newUsername, setNewUsername] = useState(profile?.username || '');
  const [usernameError, setUsernameError] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const [privacySettings, setPrivacySettings] = useState({
    lastSeenVisibility: 'everyone',
    profilePhotoVisibility: 'everyone',
    whoCanAdd: 'everyone'
  });

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

  // Every colour here comes from the active theme (th-* classes = CSS
  // variables set by ThemeProvider), so Settings follows presets and custom
  // themes alike. Surface levels: the panel, cards on it, and a softer inner
  // level for things nested inside a card.
  const ui = {
    card: 'border-2 border-th-border bg-th-card',
    cardHover: 'hover:bg-th-card-hover',
    inner: 'border border-th-border bg-th-secondary',
    label: 'block text-sm font-medium mb-2 text-th-ink-soft',
    field: 'w-full border-2 border-th-border rounded-xl bg-th-input text-th-ink placeholder:text-th-ink-faint outline-none focus:ring-2 focus:ring-th-primary/40 focus:border-th-primary',
    back: 'flex items-center gap-2 text-th-link hover:opacity-80 mb-4',
    mainBtn: 'bg-gradient-to-r from-th-bubble-mine to-th-bubble-mine-to text-th-on-bubble-mine hover:opacity-90 disabled:opacity-50',
    softBtn: 'border border-th-border bg-th-secondary text-th-on-secondary hover:bg-th-card-hover',
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full md:w-96 shadow-2xl z-50 flex flex-col overflow-hidden transition-colors duration-300 bg-th-panel text-th-ink">
        <div className="p-6 border-b border-th-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-th-ink">Settings</h2>
            <OfflineBadge theme={theme} mobileOnly surface="dark" />
          </div>
          <button onClick={onClose} aria-label="Close settings" className="p-2 rounded-full text-th-ink-soft hover:bg-th-card-hover hover:text-th-ink transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === 'main' && (
            <div className="p-4 space-y-2">
              {settingsSections.map((section) => {
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveTab(section.id as SettingsTab)}
                    className={`w-full p-4 flex items-center justify-between transition-colors rounded-xl ${ui.card} ${ui.cardHover}`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="w-5 h-5 text-th-ink-soft" />
                      <span className="font-medium text-th-ink">{section.label}</span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-th-link" />
                  </button>
                );
              })}
              <button
                onClick={async () => {
                  await signOut();
                  onClose();
                }}
                className={`w-full p-4 flex items-center justify-between transition-colors text-th-danger rounded-xl ${ui.card} hover:bg-th-danger/10`}
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
                className={ui.back}
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>

              <div>
                <label className={ui.label}>Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className={`${ui.field} px-4 py-2`}
                />
              </div>

              <div>
                <label className={ui.label}>
                  Username
                </label>
                <div className="relative">
                  {/* Left Side User Icon */}
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-th-ink-faint" />

                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="sweet_alex"
                    className={`${ui.field} pl-10 pr-10 py-3 transition-all ${
                      usernameError ? '!border-th-danger' : newUsername && usernameAvailable ? '!border-green-500' : ''
                    }`}
                  />

                  {/* Right Side Loading Spinner */}
                  {checkingUsername && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="w-5 h-5 border-2 border-th-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  
                  {/* Right Side Success Icon */}
                  {!checkingUsername && newUsername && usernameAvailable && newUsername.toLowerCase().trim() !== profile?.username?.toLowerCase() && (
                    <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-green-500" />
                  )}
                  
                  {/* Right Side Error Icon */}
                  {!checkingUsername && usernameError && (
                    <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-th-danger" />
                  )}
                </div>

                {/* Error Messaging */}
                {usernameError && (
                  <p className="mt-1 text-sm text-th-danger">{usernameError}</p>
                )}
                
                {/* Success Messaging */}
                {!usernameError && newUsername && usernameAvailable && newUsername.toLowerCase().trim() !== profile?.username?.toLowerCase() && (
                  <p className="mt-1 text-sm text-green-600">Username available!</p>
                )}

                <button
                  type="button"
                  onClick={handleChangeUsername}
                  disabled={loading || !usernameAvailable || checkingUsername}
                  className="mt-3 px-4 py-2 bg-th-primary text-th-on-primary rounded-xl hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium shadow-sm"
                >
                  Save Username
                </button>
              </div>

              <div>
                <label className={ui.label}>Bio</label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value.slice(0, 250))}
                  maxLength={250}
                  rows={4}
                  className={`${ui.field} px-4 py-2 resize-none`}
                />
                <p className="text-xs mt-1 text-th-ink-soft">{bio.length}/250</p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleUpdateProfile}
                  disabled={loading}
                  className={`flex-1 px-4 py-2 rounded-xl ${ui.mainBtn}`}
                >
                  {loading ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  onClick={() => setActiveTab('main')}
                  className={`px-4 py-2 rounded-xl transition-colors ${ui.softBtn}`}
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
                className={ui.back}
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>

              <div>
                <label className={ui.label}>Last Seen Visibility</label>
                <select
                  value={privacySettings.lastSeenVisibility}
                  onChange={(e) => setPrivacySettings({ ...privacySettings, lastSeenVisibility: e.target.value })}
                  className={`${ui.field} px-4 py-2`}
                >
                  <option value="everyone">Everyone</option>
                  <option value="friends">Friends Only</option>
                  <option value="nobody">Nobody</option>
                </select>
              </div>

              <div>
                <label className={ui.label}>Profile Photo Visibility</label>
                <select
                  value={privacySettings.profilePhotoVisibility}
                  onChange={(e) => setPrivacySettings({ ...privacySettings, profilePhotoVisibility: e.target.value })}
                  className={`${ui.field} px-4 py-2`}
                >
                  <option value="everyone">Everyone</option>
                  <option value="friends">Friends Only</option>
                  <option value="nobody">Nobody</option>
                </select>
              </div>

              <div>
                <label className={ui.label}>Who Can Add You</label>
                <select
                  value={privacySettings.whoCanAdd}
                  onChange={(e) => setPrivacySettings({ ...privacySettings, whoCanAdd: e.target.value })}
                  className={`${ui.field} px-4 py-2`}
                >
                  <option value="everyone">Everyone</option>
                  <option value="friends">Friends Only</option>
                  <option value="nobody">Nobody</option>
                </select>
              </div>

              <button
                onClick={handleUpdatePrivacy}
                disabled={loading}
                className={`w-full px-4 py-2 rounded-xl ${ui.mainBtn}`}
              >
                {loading ? 'Saving...' : 'Save Privacy Settings'}
              </button>
            </div>
          )}

          {activeTab === 'notifications' && (
            <NotificationsTab theme={theme} userId={user?.id} onBack={() => setActiveTab('main')} />
          )}

          {activeTab === 'theme' && <ThemeTab onBack={() => setActiveTab('main')} />}

{activeTab === 'storage' && (
  <StorageTab theme={theme} userId={user?.id} onBack={() => setActiveTab('main')} />
)}

{activeTab === 'performance' && (
  <div className="p-6 space-y-6 animate-fadeIn transition-colors text-th-ink">
    {/* Soft Back Button */}
    <button
      onClick={() => setActiveTab('main')}
      className="flex items-center gap-2 text-th-link hover:opacity-80 font-medium transition-colors group select-none"
    >
      <ChevronLeft className="w-4 h-4 transition-transform group-hover:scale-110" />
      <span className="text-sm">Back</span>
    </button>

    <div className={`relative overflow-hidden p-5 rounded-2xl shadow-sm ${ui.card}`}>
      <div className="flex items-center gap-2.5 mb-3">
        <span className="text-base" role="img" aria-label="performance">⚡</span>
        <p className="text-xs font-bold uppercase tracking-wider text-th-link">
          App Performance
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className={`rounded-xl p-3 ${ui.inner}`}>
          <p className="text-[10px] font-bold uppercase tracking-wider mb-1 text-th-ink-soft">Live FPS</p>
          <LiveFpsValue />
        </div>
        <div className={`rounded-xl p-3 ${ui.inner}`}>
          <p className="text-[10px] font-bold uppercase tracking-wider mb-1 text-th-ink-soft">Device Guess</p>
          <p className="text-2xl font-black capitalize text-th-ink">{deviceTier}</p>
        </div>
      </div>

      <p className="text-[11px] mb-3 text-th-ink-soft">
        {/* Auto steps back up at most once per session (see
            usePerformanceMonitor), so say so — otherwise a good FPS reading
            next to "reduced effects" looks like a bug. */}
        {override === 'auto' && perfLevel !== 'full' &&
          `✨ Auto: running ${perfLevel} effects to keep this device smooth (it lagged before, or your device asks for less motion or data). If things stay smooth for 30 seconds, it can step back up once per session.`}
        {override === 'auto' && perfLevel === 'full' &&
          '✨ Auto: currently running full effects — performance looks good.'}
        {override === 'force-high' &&
          'Manually locked to full effects, even if this device lags.'}
        {override === 'force-low' &&
          'Manually locked to reduced effects: no blur, decorative animations paused.'}
        {override === 'force-minimal' &&
          'Manually locked to minimal effects: reduced, plus no transitions and no floating hearts.'}
      </p>

      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Effects mode">
        {(['auto', 'force-high', 'force-low', 'force-minimal'] as const).map((opt) => (
          <button
            key={opt}
            onClick={() => setOverride(opt)}
            aria-pressed={override === opt}
            className={`py-2 rounded-xl text-[11px] font-bold transition-colors ${
              override === opt
                ? 'bg-th-primary text-th-on-primary'
                : `${ui.inner} text-th-on-secondary hover:bg-th-card-hover`
            }`}
          >
            {opt === 'auto' ? 'Auto' : opt === 'force-high' ? 'Full Effects' : opt === 'force-low' ? 'Reduced' : 'Minimal'}
          </button>
        ))}
      </div>
    </div>

    {/* On-screen FPS overlay toggle */}
    <div className={`rounded-2xl p-4 flex items-center justify-between gap-4 ${ui.card}`}>
      <div>
        <p id="perf-overlay-label" className="text-sm font-bold">Show FPS on screen</p>
        <p id="perf-overlay-desc" className="text-[11px] mt-0.5 text-th-ink-soft">
          A small live readout stays visible on every screen, positioned out of the way of your chats.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={showOverlay}
        aria-labelledby="perf-overlay-label"
        aria-describedby="perf-overlay-desc"
        onClick={() => setShowOverlay(!showOverlay)}
        className={`shrink-0 w-12 h-7 rounded-full transition-colors relative ${
          showOverlay ? 'bg-th-toggle-on' : 'bg-th-toggle-off'
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