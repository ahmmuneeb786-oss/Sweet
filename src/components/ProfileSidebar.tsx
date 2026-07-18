import { useState, useEffect, useRef } from 'react';
import { X, Camera, Save, CreditCard as Edit3, CloudOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { localDB } from '../db'; // 🌸 Integrated our fast offline Dexie store
import { subscribeToProfileSyncEvents } from '../hooks/useOfflineSync';
import { useNotify } from '../contexts/NotificationContext';
import { ImageViewerModal } from './ImageViewerModal';
import { useBackableState } from '../hooks/useBackableState';

interface ProfileSidebarProps {
  onClose: () => void;
  theme: 'light' | 'dark' | 'sweet';
  user: any;
}

export function ProfileSidebar({ onClose, theme, user }: ProfileSidebarProps) {
  const { profile, updateProfile } = useAuth();
  const { showSuccess, showError } = useNotify();
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || null);
  const [createdAt, setCreatedAt] = useState(user?.created_at || null);
  const [username, setUsername] = useState(profile?.username || '');
  
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Reference to the hidden input
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  useBackableState(viewerIndex !== null, () => setViewerIndex(null));
  const [photos, setPhotos] = useState<string[]>([]);
  // Gallery viewer needs a full array — legacy accounts with only the old
  // single avatar_url and no profile_photos rows yet still get a 1-photo view.
  const galleryPhotos = photos.length > 0 ? photos : (avatarUrl ? [avatarUrl] : []);

  // Monitor network state adjustments seamlessly
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

  // 🌸 FIXED CACHE HYDRATION LOOP: Runs reliably without infinite render loops
  useEffect(() => {
    async function hydrateProfile() {
      if (!user?.id) return;

      if (isOnline && profile) {
        const cached = await localDB.getUserProfile(user.id);

        if (cached?.pending_sync) {
          // There's a local edit the server doesn't have yet (e.g. made
          // while offline). Show that instead of overwriting it with
          // `profile`, which may still be stale — useOfflineSync will push
          // it up and clear this flag once it actually succeeds.
          setDisplayName(cached.display_name || '');
          setBio(cached.bio || '');
          setAvatarUrl(cached.avatar_url || null);
          setUsername(cached.username || '');
          setCreatedAt(cached.created_at || null);
          return;
        }

        setDisplayName(profile.display_name || '');
        setBio(profile.bio || '');
        setAvatarUrl(profile.avatar_url || null);
        setUsername(profile.username || '');
        setCreatedAt(user.created_at || null);

        await localDB.saveUserProfile(user.id, {
          display_name: profile.display_name,
          bio: profile.bio,
          avatar_url: profile.avatar_url,
          username: profile.username,
          created_at: user.created_at
        }); // no pendingSync flag — this is just mirroring the server, not an edit
      } else {
        const cached = await localDB.getUserProfile(user.id);
        if (cached) {
          setDisplayName(cached.display_name || '');
          setBio(cached.bio || '');
          setAvatarUrl(cached.avatar_url || null);
          setUsername(cached.username || '');
          setCreatedAt(cached.created_at || null);
        }
      }
    }
    hydrateProfile();
  }, [user?.id, isOnline]); // 🌸 Removed profile reference to stop the crash loop

  useEffect(() => {
    async function loadPhotos() {
      if (!user?.id || !isOnline) return;
      const { data, error } = await supabase
        .from('profile_photos')
        .select('url')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (!error && data) setPhotos(data.map((row) => row.url));
    }
    loadPhotos();
  }, [user?.id, isOnline]);

  // If a profile edit made while offline finishes syncing while this
  // sidebar happens to be open, reflect that instead of leaving a stale
  // "saved locally, will sync" message up.
  useEffect(() => {
    return subscribeToProfileSyncEvents((result) => {
      if (result.status === 'synced') {
        showSuccess('✨ Your offline changes are now synced!');
      }
    });
  }, []);

  // Function to handle the gallery upload
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user?.id) return;

    setLoading(true);
    // errors/success now surface via toast, nothing to reset locally

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onloadend = async () => {
      const base64Image = reader.result as string;

      if (!isOnline) {
        setAvatarUrl(base64Image);
        
        // 🌸 FIXED: Fetch existing cache items first to avoid deleting username metadata
        const currentCache = await localDB.getUserProfile(user.id);
        await localDB.saveUserProfile(user.id, {
          display_name: displayName || currentCache?.display_name || '',
          bio: bio || currentCache?.bio || '',
          avatar_url: base64Image,
          username: username || currentCache?.username || '',
          created_at: createdAt || currentCache?.created_at || null
        }, { pendingSync: true });

        showSuccess('✨ Saved avatar to local pocket! It will sync up when online.');
        setLoading(false);
        return;
      }

      try {
        const fileExt = file.name.split('.').pop();
        const filePath = `${user.id}/${Math.random()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('avatars')
          .getPublicUrl(filePath);

        await updateProfile({ avatar_url: publicUrl });
        setAvatarUrl(publicUrl);

        // Adds to the gallery rather than replacing it — the newest photo
        // also becomes avatar_url above, so every other screen in the app
        // (chat headers, friend lists, etc.) keeps showing the latest one
        // automatically without needing any changes there.
        const { error: photoError } = await supabase
          .from('profile_photos')
          .insert({ user_id: user.id, url: publicUrl });
        if (!photoError) setPhotos((prev) => [publicUrl, ...prev]);

        await localDB.saveUserProfile(user.id, {
          display_name: displayName,
          bio: bio,
          avatar_url: publicUrl,
          username: username,
          created_at: createdAt
        }, { pendingSync: false });

        showSuccess('Profile picture updated across the cloud! ✨');
      } catch (err) {
        showError('Upload failed. Check if "avatars" bucket is public in Supabase.');
      } finally {
        setLoading(false);
      }
    };
  }

  async function handleRemovePhoto(index: number) {
    const url = galleryPhotos[index];
    if (!user?.id || !url) return;

    const { error } = await supabase
      .from('profile_photos')
      .delete()
      .eq('user_id', user.id)
      .eq('url', url);

    if (error) {
      showError('Failed to remove photo.');
      return;
    }

    const remaining = photos.filter((u) => u !== url);
    setPhotos(remaining);

    // Removing the current main photo promotes whichever one is next in
    // line — falls back to nothing if that was the very last photo.
    if (avatarUrl === url) {
      const newMain = remaining[0] || null;
      await updateProfile({ avatar_url: newMain });
      setAvatarUrl(newMain);
      await localDB.saveUserProfile(user.id, {
        display_name: displayName,
        bio,
        avatar_url: newMain,
        username,
        created_at: createdAt
      }, { pendingSync: false });
    }

    showSuccess('Photo removed.');
  }

  async function handleSetMainPhoto(index: number) {
    const url = galleryPhotos[index];
    if (!user?.id || !url || url === avatarUrl) return;

    // No separate "position" column — bumping created_at is what naturally
    // moves this row to the front of the created_at-DESC ordered gallery.
    await supabase
      .from('profile_photos')
      .update({ created_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('url', url);

    await updateProfile({ avatar_url: url });
    setAvatarUrl(url);
    setPhotos((prev) => [url, ...prev.filter((u) => u !== url)]);

    await localDB.saveUserProfile(user.id, {
      display_name: displayName,
      bio,
      avatar_url: url,
      username,
      created_at: createdAt
    }, { pendingSync: false });

    showSuccess('Set as main profile photo! ✨');
  }

  async function handleSave() {
    setLoading(true);
    // errors/success now surface via toast, nothing to reset locally

    const profilePayload = {
      display_name: displayName,
      bio: bio,
      avatar_url: avatarUrl,
      username: username,
      created_at: createdAt
    };

    if (user?.id) {
      await localDB.saveUserProfile(user.id, profilePayload, { pendingSync: true });
    }

    if (!isOnline) {
      // 🌸 FIXED: State preservation prevents values from resetting back to old values
      setDisplayName(displayName);
      setBio(bio);
      showSuccess('✨ Saved changes locally! Your details will sync automatically.');
      setIsEditing(false);
      setLoading(false);
      return;
    }

    try {
      const { error: updateError } = await updateProfile({
        display_name: displayName,
        bio: bio
      });

      if (updateError) throw updateError;

      if (user?.id) {
        await localDB.saveUserProfile(user.id, profilePayload, { pendingSync: false });
      }

      showSuccess('Profile updated successfully!');
      setIsEditing(false);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    if (profile) {
      setDisplayName(profile.display_name || '');
      setBio(profile.bio || '');
      setAvatarUrl(profile.avatar_url || null);
    }
    setIsEditing(false);
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept="image/*" 
        onChange={handleImageUpload} 
      />

      <div className={`fixed right-0 top-0 h-full w-full md:w-96 shadow-2xl z-50 flex flex-col transition-all duration-300 ${
        theme === 'dark' 
          ? 'bg-gray-900 text-white' 
          : theme === 'sweet' 
          ? 'bg-[#FFE4E1] text-[#4B004B]' 
          : 'bg-white text-gray-900'
      }`}>
        
        {/* HEADER */}
        <div className={`p-6 border-b flex items-center justify-between ${
          theme === 'sweet' ? 'border-[#FFB6C1]/50' : 'border-gray-200 dark:border-gray-800'
        }`}>
          <div className="flex items-center gap-2">
            <h2 className={`text-xl font-bold ${
              theme === 'sweet' ? 'text-[#4B004B]' : theme === 'dark' ? 'text-white' : 'text-black'
            }`}>
              Profile
            </h2>
            {!isOnline && (
              <div className="flex items-center gap-1 bg-pink-100 text-pink-700 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
                <CloudOff className="w-3 h-3" />
                <span>Offline Mode</span>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className={`p-2 rounded-full transition-colors ${
              theme === 'sweet' ? 'hover:bg-[#FFC0CB]/50' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            <X className={`w-5 h-5 ${theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-600 dark:text-gray-400'}`} />
          </button>
        </div>

        {/* CONTAINER CONTENT */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex flex-col items-center space-y-4">
            <div className="relative">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={displayName}
                  onClick={() => setViewerIndex(0)}
                  className="w-32 h-32 rounded-full object-cover border-4 border-pink-200 shadow-md cursor-pointer active:scale-95 transition-transform"
                />
              ) : (
                <div
                  className="w-32 h-32 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white font-bold text-4xl uppercase shadow-lg"
                >
                  {displayName?.[0] || username?.[0] || 'U'}
                </div>
              )}

              {isEditing && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute bottom-1 right-1 w-10 h-10 rounded-full bg-pink-500 hover:bg-pink-600 border-4 border-white shadow-lg flex items-center justify-center transition-colors active:scale-90"
                >
                  <Camera className="w-4 h-4 text-white" />
                </button>
              )}
            </div>

            {viewerIndex !== null && galleryPhotos.length > 0 && (
              <ImageViewerModal
                images={galleryPhotos}
                initialIndex={viewerIndex}
                alt={displayName}
                onClose={() => setViewerIndex(null)}
                onRemove={handleRemovePhoto}
                onSetMain={handleSetMainPhoto}
              />
            )}

            {!isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-all shadow-sm active:scale-95 ${
                  theme === 'sweet' ? 'bg-[#FF69B4] text-white hover:bg-[#FF1493]' : 
                  theme === 'dark' ? 'bg-gray-800 text-gray-200 border border-gray-700 hover:bg-gray-700' : 
                  'bg-[#FF4D6D] text-white hover:bg-[#FF758F]'
                }`}
              >
                <Edit3 className="w-4 h-4" />
                Edit Profile
              </button>
            )}
          </div>

          <div className="space-y-4">
            {/* USERNAME */}
            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'sweet' ? 'text-[#8B004B]' : theme === 'dark' ? 'text-gray-400' : 'text-gray-700'
              }`}>
                Username
              </label>
              <input
                type="text"
                value={username || ''}
                disabled
                className={`w-full px-4 py-2 rounded-xl border cursor-not-allowed transition-colors ${
                  theme === 'sweet' 
                    ? 'bg-[#FFC0CB]/30 border-[#FFB6C1] text-[#8B004B]' 
                    : theme === 'dark' ? 'bg-gray-800 border-gray-700 text-gray-400' : 'bg-gray-50 border-gray-300 text-black'
                }`}
              />
              <p className={`mt-1 text-xs ${theme === 'sweet' ? 'text-[#8B004B]/60' : 'text-gray-500'}`}>
                Head toward settings to change your username.
              </p>
            </div>

            {/* DISPLAY NAME */}
            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'sweet' ? 'text-[#8B004B]' : theme === 'dark' ? 'text-gray-400' : 'text-gray-700'
              }`}>
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={!isEditing}
                className={`w-full px-4 py-2 border rounded-xl outline-none transition-all focus:ring-2 focus:ring-pink-500 focus:border-transparent ${
                  theme === 'sweet' ? 'border-[#FFB6C1] text-[#4B004B]' : theme === 'dark' ? 'border-gray-700 text-white' : 'border-gray-300 text-black'
                } ${
                  !isEditing 
                    ? theme === 'sweet' ? 'bg-[#FFC0CB]/30 text-[#8B004B] cursor-not-allowed' : theme === 'dark' ? 'bg-gray-800 text-gray-400 cursor-not-allowed' : 'bg-gray-100 text-black cursor-not-allowed'
                    : theme === 'sweet' ? 'bg-white' : theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-black'
                }`}
              />
            </div>

            {/* BIO */}
            <div>
              <label className={`block text-sm font-medium mb-2 ${
                theme === 'sweet' ? 'text-[#8B004B]' : theme === 'dark' ? 'text-gray-400' : 'text-gray-700'
              }`}>
                Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                disabled={!isEditing}
                rows={4}
                maxLength={250}
                className={`w-full px-4 py-2 border rounded-xl outline-none transition-all resize-none focus:ring-2 focus:ring-pink-500 focus:border-transparent ${
                  theme === 'sweet' ? 'border-[#FFB6C1] text-[#4B004B] placeholder:text-[#8B004B]/50' : theme === 'dark' ? 'border-gray-700 text-white' : 'border-gray-300 text-black'
                } ${
                  !isEditing 
                    ? theme === 'sweet' ? 'bg-[#FFC0CB]/30 text-[#8B004B] cursor-not-allowed' : theme === 'dark' ? 'bg-gray-800 text-gray-400 cursor-not-allowed' : 'bg-gray-100 text-black cursor-not-allowed'
                    : theme === 'sweet' ? 'bg-white' : theme === 'dark' ? 'bg-gray-900 text-white' : 'bg-white text-black'
                }`}
                placeholder="Tell us about yourself..."
              />
              <div className="flex justify-between items-center mt-1">
                <p className={`text-xs ${theme === 'sweet' ? 'text-[#8B004B]/60' : 'text-gray-500'}`}>
                  {bio.length}/250 characters
                </p>
              </div>
            </div>

            {/* EDITING ACTIONS CONTROLS */}
            {isEditing && (
              <div className="flex gap-2 pt-2 animate-in fade-in duration-200">
                <button
                  onClick={handleSave}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-xl hover:from-pink-600 hover:to-rose-600 transition-all disabled:opacity-50 font-bold text-xs uppercase tracking-wider shadow-sm"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={loading}
                  className={`px-4 py-2 rounded-xl transition-colors disabled:opacity-50 text-xs font-bold uppercase tracking-wider ${
                    theme === 'sweet' ? 'bg-[#FF69B4] text-[#4B004B] hover:bg-[#FF1493]' : 
                    theme === 'dark' ? 'bg-gray-800 text-[#9ca3af] hover:bg-gray-700' : 
                    'bg-gray-100 text-black hover:bg-gray-200'
                  }`}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* ACCOUNT METRICS FOOTER */}
          <div className={`border-t pt-6 ${
            theme === 'sweet' ? 'border-[#FFB6C1]/50' : 'border-gray-200 dark:border-gray-800'
          }`}>
            <h3 className={`text-sm font-semibold mb-4 ${
              theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'
            }`}>
              Account Information
            </h3>
            
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className={`text-sm ${theme === 'sweet' ? 'text-[#8B004B]/70' : 'text-gray-700 dark:text-gray-500'}`}>
                  Status
                </span>
                <span className={`text-sm font-medium flex items-center gap-1 ${isOnline ? 'text-green-600' : 'text-pink-500'}`}>
                  <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-pink-400'}`} />
                  {isOnline ? 'Online' : 'Offline'}
                </span>
              </div>

              <div className="flex justify-between items-center">
                <span className={`text-sm ${theme === 'sweet' ? 'text-[#8B004B]/70' : 'text-gray-700 dark:text-gray-500'}`}>
                  Member since
                </span>
                <span className={`text-sm font-bold ${
                  theme === 'sweet' ? 'text-[#8B004B]' : theme === 'dark' ? 'text-gray-400' : 'text-black'
                }`}>
                  {createdAt ? new Date(createdAt).toLocaleDateString() : 'N/A'}
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}