import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Heart } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePresence } from '../hooks/usePresence';
import { ImageViewerModal } from './ImageViewerModal';
import { usePerformance } from '../contexts/PerformanceContext';
import { useBackableState } from '../hooks/useBackableState';

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

// One labeled box per piece of info — same treatment the bio box already
// had, just generalized with a heading so every field reads consistently.
function InfoCard({ label, theme, children }: { label: string; theme: 'light' | 'dark' | 'sweet'; children: React.ReactNode }) {
  return (
    <div className={`w-full p-4 rounded-2xl text-left ${theme === 'sweet' ? 'bg-white/60' : theme === 'dark' ? 'bg-gray-800' : 'bg-gray-50'}`}>
      <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 ${theme === 'sweet' ? 'text-[#FF1493]/70' : theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
        {label}
      </p>
      <div className={`text-sm font-medium ${theme === 'sweet' ? 'text-[#4B004B]' : theme === 'dark' ? 'text-gray-200' : 'text-gray-700'}`}>
        {children}
      </div>
    </div>
  );
}

export function UserProfileView({ userId, theme, onClose }: UserProfileViewProps) {
  const [profile, setProfile] = useState<ViewedProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [photos, setPhotos] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  useBackableState(viewerIndex !== null, () => setViewerIndex(null));
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

      const { data: photoRows, error: photoError } = await supabase
        .from('profile_photos')
        .select('url')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (!cancelled && !photoError && photoRows) setPhotos(photoRows.map((row) => row.url));
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const online = isOnline(userId);
  // Legacy accounts with no profile_photos rows yet still get a 1-photo gallery.
  const galleryPhotos = photos.length > 0 ? photos : (profile?.avatar_url ? [profile.avatar_url] : []);

  // Portaled straight to <body> — ChatWindow is nested inside
  // MobileDashboard's `animate-in slide-in-from-right` wrapper on mobile,
  // and any ancestor with a CSS transform (even the identity transform an
  // "enter" animation leaves behind once it settles) becomes the containing
  // block for every `position: fixed` descendant underneath it. That's why
  // this panel's fixed backdrop/panel were being sized and positioned
  // relative to that wrapper instead of the real screen, instead of
  // covering the full viewport and sliding in from the true right edge.
  return createPortal(
    <>
      <div className={`fixed inset-0 z-40 bg-black/20 ${isLowPerfMode ? '' : 'backdrop-blur-[1px]'}`} onClick={onClose} />

      <div className={`fixed top-0 right-0 bottom-0 z-50 w-full md:max-w-sm h-full flex flex-col shadow-2xl border-l animate-in slide-in-from-right duration-300 ${
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
                    onClick={() => setViewerIndex(0)}
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


              {viewerIndex !== null && galleryPhotos.length > 0 && (
                <ImageViewerModal
                  images={galleryPhotos}
                  initialIndex={viewerIndex}
                  alt={profile.display_name}
                  onClose={() => setViewerIndex(null)}
                />
              )}

              <div className="w-full space-y-3">
                <InfoCard label="Display Name" theme={theme}>
                  <span className="flex items-center gap-1.5 text-base font-bold">
                    {profile.display_name}
                    {theme === 'sweet' && <Heart className="w-3.5 h-3.5 text-pink-400 fill-pink-400" />}
                  </span>
                </InfoCard>

                <InfoCard label="Username" theme={theme}>
                  @{profile.username}
                </InfoCard>

                <InfoCard label="Status" theme={theme}>
                  <span className={`font-bold uppercase tracking-widest text-xs ${online ? 'text-green-500' : 'text-gray-400'}`}>
                    {online ? 'Online now' : `Last seen ${formatLastSeen(profile.last_seen)}`}
                  </span>
                </InfoCard>

                {profile.bio && (
                  <InfoCard label="Bio" theme={theme}>
                    {profile.bio}
                  </InfoCard>
                )}

                {formatJoined(profile.created_at) && (
                  <InfoCard label="Member Since" theme={theme}>
                    {formatJoined(profile.created_at)}
                  </InfoCard>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}