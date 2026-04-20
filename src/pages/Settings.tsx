import { useState } from 'react';
import { ChevronRight, X, Bell, Lock, Palette, HardDrive, LogOut, User, Shield } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

type SettingsTab = 'main' | 'account' | 'privacy' | 'notifications' | 'theme' | 'storage' | 'locked';

interface SettingsProps {
  onClose: () => void;
  theme: 'light' | 'dark' | 'romantic';   // current theme
  setTheme: React.Dispatch<React.SetStateAction<'light' | 'dark' | 'romantic'>>; // updater
}

export function Settings({ onClose, theme, setTheme }: SettingsProps) {
  const { profile, updateProfile, signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>('main');
  const [loading, setLoading] = useState(false);

  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [newUsername, setNewUsername] = useState(profile?.username || '');
  const [usernameError, setUsernameError] = useState('');

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
    if (!newUsername.trim()) {
      setUsernameError('Username cannot be empty');
      return;
    }

    if (!/^[A-Za-z0-9_-]+$/.test(newUsername)) {
      setUsernameError('Username can only contain A-Z, a-z, 0-9, - and _');
      return;
    }

    setLoading(true);
    try {
      const { data: existing } = await supabase
        .from('profiles')
        .select('username')
        .eq('username', newUsername.toLowerCase())
        .neq('id', profile?.id)
        .maybeSingle();

      if (existing) {
        setUsernameError('Username already taken');
        return;
      }

      const { error } = await updateProfile({
        username: newUsername.toLowerCase()
      });

      if (error) throw error;
      setUsernameError('');
      setActiveTab('main');
    } catch (error) {
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
    { id: 'privacy', label: 'Privacy Settings', icon: Shield },
    { id: 'notifications', label: 'Notification Settings', icon: Bell },
    { id: 'theme', label: 'Theme Settings', icon: Palette },
    { id: 'storage', label: 'Storage & Media', icon: HardDrive },
    { id: 'locked', label: 'Locked Chats', icon: Lock }
  ];

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full md:w-96 bg-white shadow-2xl z-50 flex flex-col overflow-hidden">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {activeTab === 'main' && (
            <div className="divide-y divide-gray-200">
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
                <X className="w-4 h-4" />
                Back
              </button>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Username</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className={`w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-pink-500 outline-none ${
                    usernameError ? 'border-red-500' : 'border-gray-300'
                  }`}
                />
                {usernameError && <p className="text-sm text-red-600 mt-1">{usernameError}</p>}
              <button
  type="button"
  onClick={handleChangeUsername} // ← call the function
  className="mt-2 px-4 py-2 bg-pink-500 text-white rounded-xl hover:bg-pink-600 transition"
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
                  className="w-full px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-pink-500 outline-none resize-none"
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
                  {['romantic', 'light', 'dark'].map((t) => (
  <label key={t}>
    <input
      type="radio"
      name="theme"
      value={t}
      checked={theme === t}  // ❌ error
      onChange={() => setTheme(t as 'light' | 'dark' | 'romantic')}
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
