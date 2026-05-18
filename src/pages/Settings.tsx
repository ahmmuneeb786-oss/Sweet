import { useState, useEffect } from 'react';
import { ChevronRight, X, Bell, Lock, Palette, HardDrive, LogOut, User, Shield, ShieldCheck, Smile, CheckCircle, AlertCircle, ChevronLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { PermissionManager } from '../services/PermissionManager';

type SettingsTab = 'main' | 'account' | 'privacy' | 'notifications' | 'theme' | 'storage' | 'locked' | 'lock';

interface SettingsProps {
  onClose: () => void;
  theme: 'light' | 'dark' | 'sweet';   // current theme
  setTheme: React.Dispatch<React.SetStateAction<'light' | 'dark' | 'sweet'>>;
  faceLockEnabled: boolean;
  setFaceLockEnabled: (val: boolean) => void;
  isFaceRegistered: boolean;
  onRegisterFace: () => void;
  user: any;
  savedDescriptor: number[] | null;
}

export function Settings({ onClose, theme, setTheme, faceLockEnabled, setFaceLockEnabled, onRegisterFace, user, savedDescriptor }: SettingsProps) {
  const { profile, updateProfile, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>('main');
  const [loading, setLoading] = useState(false);

  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [newUsername, setNewUsername] = useState(profile?.username || '');
  const [usernameError, setUsernameError] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

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
  }, [newUsername, profile?.username, profile?.id]);

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
    alert("To turn off whispers completely, you can tap the lock/info icon next to your browser URL bar at the top! 🍬");
  }
};

  async function handleUpdateProfile() {
    setLoading(true);
    try {
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

    // If they didn't even alter their current username, just go back to main menu
    if (CleanedUsername === profile?.username?.toLowerCase()) {
      setActiveTab('main');
      return;
    }

    setLoading(true);
    try {
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

      // Everything looks completely valid; execute profile data update row rewrite
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
    { id: 'locked', label: 'Locked Chats', icon: Lock }
  ];

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
      alert("Could not update settings. Check network connection.");
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
                <label className="block text-sm font-medium text-gray-700 mb-3">App Theme</label>
                <div className="space-y-2">
                  {['sweet', 'light', 'dark'].map((t) => (
                    <label key={t}>
                     <input
                       type="radio"
                       name="theme"
                       value={t}
                       checked={theme === t}
                       onChange={() => setTheme(t as 'light' | 'dark' | 'sweet')}
                     />
                    <span>{t} Mode</span>
                   </label>
              ))}
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
            <div className="p-6 space-y-6">
              <button
                onClick={() => setActiveTab('main')}
                className="flex items-center gap-2 text-pink-600 hover:text-pink-700 mb-4"
              >
                <X className="w-4 h-4" />
                Back
              </button>

              <div className="bg-gray-50 p-4 rounded-xl">
                <p className="text-sm text-gray-600 mb-2">Total Storage Used</p>
                <p className="text-2xl font-bold text-gray-900">0 GB</p>
              </div>

              <button className="w-full px-4 py-2 bg-red-100 text-red-600 rounded-xl hover:bg-red-200 transition-colors font-medium">
                Clear Cache
              </button>
            </div>
          )}

          {activeTab === 'locked' && (
            <div className="p-6">
              <button
                onClick={() => setActiveTab('main')}
                className="flex items-center gap-2 text-pink-600 hover:text-pink-700 mb-4"
              >
                <X className="w-4 h-4" />
                Back
              </button>

              <div className="flex flex-col items-center justify-center h-64 text-center">
                <Lock className="w-16 h-16 text-gray-300 mb-3" />
                <p className="text-gray-500 font-medium">No Locked Chats Yet</p>
                <p className="text-gray-400 text-sm mt-1">Locked chats will show here</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
