import { useState, useRef } from 'react';
import { X, Camera, Save, CreditCard as Edit3 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

interface ProfileSidebarProps {
  onClose: () => void;
  theme: 'light' | 'dark' | 'sweet'; // Add this line!
}

export function ProfileSidebar({ onClose, theme }: ProfileSidebarProps) {
  const { profile, updateProfile } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Reference to the hidden input
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Function to handle the gallery upload
  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !profile) return;

    setLoading(true);
    setError('');
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `${profile.id}/${Math.random()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      await updateProfile({ avatar_url: publicUrl });
      setSuccess('Profile picture updated!');
    } catch (err) {
      setError('Upload failed. Check if "avatars" bucket is public in Supabase.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // This calls the function in your AuthContext
      const { error: updateError } = await updateProfile({
        display_name: displayName,
        bio: bio
      });

      if (updateError) throw updateError;

      setSuccess('Profile updated successfully!');
      setIsEditing(false); // Exit edit mode on success
      
      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    setDisplayName(profile?.display_name || '');
    setBio(profile?.bio || '');
    setIsEditing(false);
    setError('');
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />
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
        <div className={`p-6 border-b flex items-center justify-between ${
  theme === 'sweet' ? 'border-[#FFB6C1]/50' : 'border-gray-200 dark:border-gray-800'
}`}>
  <h2 className={`text-xl font-bold ${
  theme === 'sweet' 
    ? 'text-[#4B004B]' 
    : theme === 'dark' 
    ? 'text-white' 
    : 'text-black'
}`}>
  Profile
</h2>
  <button
    onClick={onClose}
    className={`p-2 rounded-full transition-colors ${
      theme === 'sweet' ? 'hover:bg-[#FFC0CB]/50' : 'hover:bg-gray-100 dark:hover:bg-gray-800'
    }`}
  >
    <X className={`w-5 h-5 ${theme === 'sweet' ? 'text-[#8B004B]' : 'text-gray-600 dark:text-gray-400'}`} />
  </button>
</div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-xl text-sm">
              {success}
            </div>
          )}

          <div className="flex flex-col items-center space-y-4">
            <div className="relative group">
              {profile?.avatar_url ? (
                <img
                  src={profile.avatar_url}
                  alt={profile.display_name}
                  className="w-32 h-32 rounded-full object-cover border-4 border-pink-200"
                />
              ) : (
                <div className="w-32 h-32 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white font-bold text-4xl uppercase shadow-lg">
                  {profile?.display_name?.[0] || profile?.username?.[0] || 'U'}
                </div>
              )}
              
              {/* Camera overlay only shows when isEditing is true */}
              {isEditing && (
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                >
                  <Camera className="w-8 h-8 text-white" />
                </button>
              )}
            </div>

            {/* Edit Profile Button only shows when NOT editing */}
            {!isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-all shadow-sm ${
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
            <div>
              <label className={`block text-sm font-medium mb-2 ${
  theme === 'sweet' 
    ? 'text-[#8B004B]' 
    : theme === 'dark'
    ? 'text-gray-400' // This makes it visible (silver/grey) in Dark Mode
    : 'text-gray-700'   // This is your "perfect" Light Mode color
}`}>
                Username
              </label>
              <input
                type="text"
                value={profile?.username || ''}
                disabled
                className={`w-full px-4 py-2 rounded-xl border cursor-not-allowed transition-colors ${
  theme === 'sweet' 
    ? 'bg-[#FFC0CB]/30 border-[#FFB6C1] text-[#8B004B]' 
    : theme === 'dark'
    ? 'bg-gray-800 border-gray-700 text-gray-400' 
    : 'bg-gray-50 border-gray-300 text-black'
}`}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Username cannot be changed
              </p>
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${
  theme === 'sweet' 
    ? 'text-[#8B004B]' 
    : theme === 'dark'
    ? 'text-gray-400' // This makes it visible (silver/grey) in Dark Mode
    : 'text-gray-700'   // This is your "perfect" Light Mode color
}`}>
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                disabled={!isEditing}
                className={`w-full px-4 py-2 border rounded-xl outline-none transition-all focus:ring-2 focus:ring-pink-500 focus:border-transparent ${
  theme === 'sweet' 
    ? 'border-[#FFB6C1] text-[#4B004B]' 
    : theme === 'dark'
    ? 'border-gray-700 text-white' 
    : 'border-gray-300 text-black' // Forced Light to Black
} ${
  !isEditing 
    ? theme === 'sweet'
      ? 'bg-[#FFC0CB]/30 text-[#8B004B] cursor-allowed'
      : theme === 'dark'
      ? 'bg-gray-800 text-gray-400 cursor-allowed' // Original Dark colors
      : 'bg-gray-100 text-black cursor-allowed'    // Forced Light to Black
    : theme === 'sweet'
      ? 'bg-white'
      : theme === 'dark'
      ? 'bg-gray-900 text-white'
      : 'bg-white text-black'
}`}
              />
            </div>

            <div>
              <label className={`block text-sm font-medium mb-2 ${
  theme === 'sweet' 
    ? 'text-[#8B004B]' 
    : theme === 'dark'
    ? 'text-gray-400' // This makes it visible (silver/grey) in Dark Mode
    : 'text-gray-700'   // This is your "perfect" Light Mode color
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
  theme === 'sweet' 
    ? 'border-[#FFB6C1] text-[#4B004B] placeholder:text-[#8B004B]/50' 
    : theme === 'dark'
    ? 'border-gray-700 text-white' 
    : 'border-gray-300 text-black' // Forced Light to Black
} ${
  !isEditing 
    ? theme === 'sweet'
      ? 'bg-[#FFC0CB]/30 text-[#8B004B] cursor-allowed'
      : theme === 'dark'
      ? 'bg-gray-800 text-gray-400 cursor-allowed' // Original Dark colors
      : 'bg-gray-100 text-black cursor-allowed'    // Forced Light to Black
    : theme === 'sweet'
      ? 'bg-white'
      : theme === 'dark'
      ? 'bg-gray-900 text-white'
      : 'bg-white text-black'
}`}
                placeholder="Tell us about yourself..."
              />
              <div className="flex justify-between items-center mt-1">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {bio.length}/250 characters
                </p>
              </div>
            </div>

            {isEditing && (
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={loading}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-500 to-rose-500 text-white rounded-xl hover:from-pink-600 hover:to-rose-600 transition-all disabled:opacity-50"
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
  className={`px-4 py-2 rounded-xl transition-colors disabled:opacity-50 font-medium ${
    theme === 'sweet'
      ? 'bg-[#FF69B4] text-[#4B004B] hover:bg-[#FF1493]' // Pink bg with Plum text
      : theme === 'dark'
      ? 'bg-gray-800 text-[#9ca3af] hover:bg-gray-700'  // Dark bg with Grey text
      : 'bg-gray-100 text-black hover:bg-gray-200'      // Light bg with Black text
  }`}
>
  Cancel
</button>
              </div>
            )}
          </div>

          {/* Account Information Section */}
          <div className={`border-t pt-6 ${
            theme === 'sweet' ? 'border-[#FFB6C1]/50' : 'border-gray-200 dark:border-gray-800'
          }`}>
            <h3 className={`text-sm font-semibold mb-4 ${
              theme === 'sweet' ? 'text-[#4B004B]' : 'text-gray-900 dark:text-white'
            }`}>
              Account Information
            </h3>
            
            <div className="space-y-3">
              {/* Status Row */}
              <div className="flex justify-between items-center">
                <span className={`text-sm ${
                  theme === 'sweet' ? 'text-[#8B004B]/70' : 'text-gray-700 dark:text-gray-500'
                }`}>
                  Status
                </span>
                <span className="text-sm font-medium text-green-600 flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-500 rounded-full" />
                  Online
                </span>
              </div>

              {/* Member Since Row */}
              <div className="flex justify-between items-center">
                <span className={`text-sm ${
                  theme === 'sweet' ? 'text-[#8B004B]/70' : 'text-gray-700 dark:text-gray-500'
                }`}>
                  Member since
                </span>
                <span className={`text-sm font-bold ${
  theme === 'sweet'
    ? 'text-[#8B004B]' 
    : theme === 'dark'
    ? 'text-gray-400' // This is the grey you wanted for Dark Theme
    : 'text-black'    // This is the black you like for Light Theme
}`}>
                  {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : 'N/A'}
                </span>
              </div>
            </div>
          </div> {/* End of Account Info */}
        </div> {/* End of Overflow-y-auto div */}
      </div> {/* End of Sidebar div */}
    </>
  );
}
