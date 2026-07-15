import { useState, useEffect } from 'react';
import { ArrowLeft, Heart } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePresence } from '../hooks/usePresence';
import { ImageViewerModal } from './ImageViewerModal';
import { usePerformance } from '../contexts/PerformanceContext';

interface UserProfileViewProps {
  userId: string;
  theme: 'light' | 'dark' | 'sweet';
  onClose: () => void;
}

interface ViewedProfile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  last_seen: string | null;
  created_at: string | null;
}

function formatLastSeen(timestamp: string | null) {
  if (!timestamp) return 'a while ago';
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatJoined(timestamp: string | null) {
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function UserProfileView({ userId, theme, onClose }: UserProfileViewProps) {
  const [profile, setProfile] = useState<ViewedProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showImageViewer, setShowImageViewer] = useState(false);
  const { isOnline } = usePresence(userId);
  const { isLowPerfMode } = usePerformance();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_url, bio, last_seen, created_at')
        .eq('id', userId)
        .maybeSingle();

      if (!cancelled) {
        if (!error && data) setProfile(data);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const online = isOnline(userId);

  return (
    <>
      <div className={`fixed inset-0 z-40 bg-black/20 ${isLowPerfMode ? '' : 'backdrop-blur-[1px]'}`} onClick={onClose} />

      <div className={`fixed top-0 right-0 bottom-0 z-50 w-full max-w-sm h-full flex flex-col shadow-2xl border-l animate-in slide-in-from-right duration-300 ${
        theme === 'sweet' ? 'bg-[#FFF0F5] border-[#FFB6C1]' : theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200'
      }`}>
        {/* Header */}
        <div className={`p-4 border-b flex items-center gap-3 ${theme === 'sweet' ? 'border-[#FFB6C1]' : theme === 'dark' ? 'border-gray-800' : 'border-gray-200'}`}>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
            <ArrowLeft className={`w-5 h-5 ${theme === 'sweet' ? 'text-[#8B004B]' : theme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`} />
          </button>
          <h2 className={`font-bold text-lg ${theme === 'sweet' ? 'text-[#4B004B]' : theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
            Profile
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex flex-col items-center gap-4 pt-8 animate-pulse">
              <div className="w-28 h-28 rounded-full bg-pink-100" />
              <div className="h-5 w-32 rounded-full bg-pink-100" />
              <div className="h-3 w-24 rounded-full bg-pink-100" />
            </div>
          ) : !profile ? (
            <div className="text-center pt-12 text-gray-400 text-sm">Couldn't load this profile.</div>
          ) : (
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="relative">
                {profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={profile.display_name}
                    onClick={() => setShowImageViewer(true)}
                    className="w-28 h-28 rounded-full object-cover border-4 border-white shadow-lg cursor-pointer active:scale-95 transition-transform"
                  />
                ) : (
                  <div className="w-28 h-28 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white font-bold text-4xl uppercase border-4 border-white shadow-lg">
                    {profile.display_name?.[0] || profile.username?.[0] || '?'}
                  </div>
                )}
                {online && (
                  <span className="absolute bottom-1.5 right-1.5 w-5 h-5 bg-green-500 border-[3px] border-white rounded-full" />
                )}
              </div>

              {showImageViewer && profile.avatar_url && (
                <ImageViewerModal
                  src={profile.avatar_url}
                  alt={profile.display_name}
                  onClose={() => setShowImageViewer(false)}
                />
              )}

              <div>
                <h3 className={`text-xl font-bold flex items-center justify-center gap-1.5 ${theme === 'sweet' ? 'text-[#4B004B]' : theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  {profile.display_name}
                  {theme === 'sweet' && <Heart className="w-4 h-4 text-pink-400 fill-pink-400" />}
                </h3>
                <p className="text-sm text-gray-400">@{profile.username}</p>
              </div>

              <p className={`text-xs font-bold uppercase tracking-widest ${online ? 'text-green-500' : 'text-gray-400'}`}>
                {online ? 'Online now' : `Last seen ${formatLastSeen(profile.last_seen)}`}
              </p>

              {profile.bio && (
                <div className={`w-full p-4 rounded-2xl text-sm text-left ${theme === 'sweet' ? 'bg-white/60 text-[#4B004B]' : theme === 'dark' ? 'bg-gray-800 text-gray-200' : 'bg-gray-50 text-gray-700'}`}>
                  {profile.bio}
                </div>
              )}

              {formatJoined(profile.created_at) && (
                <p className="text-[11px] text-gray-400">
                  Joined {formatJoined(profile.created_at)}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}