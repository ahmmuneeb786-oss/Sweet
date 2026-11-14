import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Heart } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { usePresence } from '../hooks/usePresence';
import { ImageViewerModal } from './ImageViewerModal';
import { OfflineBadge } from './OfflineBadge';
import { usePerformance } from '../contexts/PerformanceContext';
import { useBackableState } from '../hooks/useBackableState';
import { usePanelThemeStyle } from '../theme/panelTheme';

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
// `theme` is still passed by callers; colours come from the th-* theme variables.
function InfoCard({ label, children }: { label: string; theme?: 'light' | 'dark' | 'sweet'; children: React.ReactNode }) {
  return (
    <div className="w-full p-4 rounded-2xl text-left bg-th-card border border-th-border">
      <p className={`text-[10px] font-bold uppercase tracking-widest mb-1 text-th-ink-soft`}>
        {label}
      </p>
      <div className={`text-sm font-medium text-th-ink`}>
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
  const { user } = useAuth();
  // usePresence takes OUR id (it's the key we announce ourselves under);
  // the viewed user's id is only what we look up in the shared online set.
  const { isOnline } = usePresence(user?.id);
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

  // Keep last_seen live while the profile is open — otherwise someone who
  // goes offline mid-view shows whatever last_seen was at the moment we opened it.
  useEffect(() => {
    const channel = supabase
      .channel(`profile-view-${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        (payload) => {
          setProfile((prev) => (prev ? { ...prev, last_seen: payload.new.last_seen } : prev));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const online = isOnline(userId);
  const panelStyle = usePanelThemeStyle();
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
    // `contents` box only carries the colours: the chat's theme when opened
    // from a chat on a phone (see theme/panelTheme.tsx).
    <div className="contents" style={panelStyle}>
      <div className={`fixed inset-0 z-40 bg-black/20 ${isLowPerfMode ? '' : 'backdrop-blur-[1px]'}`} onClick={onClose} />

      <div className={`fixed top-0 right-0 bottom-0 z-50 w-full md:max-w-sm h-full flex flex-col shadow-2xl border-l animate-in slide-in-from-right duration-300 ${
        'bg-th-panel text-th-ink border-th-border'
      }`}>
        {/* Header */}
        <div className={`p-4 border-b flex items-center gap-3 border-th-border`}>
          <button onClick={onClose} aria-label="Back" className="p-1 rounded-full hover:bg-th-card-hover transition-colors">
            <ArrowLeft className="w-5 h-5 text-th-ink-soft" />
          </button>
          <h2 className="font-bold text-lg text-th-ink">
            Profile
          </h2>
          <OfflineBadge theme={theme} mobileOnly />
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex flex-col items-center gap-4 pt-8 animate-pulse">
              <div className="w-28 h-28 rounded-full bg-th-secondary" />
              <div className="h-5 w-32 rounded-full bg-th-secondary" />
              <div className="h-3 w-24 rounded-full bg-th-secondary" />
            </div>
          ) : !profile ? (
            <div className="text-center pt-12 text-sm text-th-ink-soft">Couldn't load this profile.</div>
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
                  <div className={`w-28 h-28 rounded-full bg-gradient-to-br flex items-center justify-center font-bold text-4xl uppercase border-4 border-th-card shadow-lg from-th-bubble-mine to-th-bubble-mine-to text-th-on-bubble-mine`}>
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
                    {theme === 'sweet' && <Heart className="w-3.5 h-3.5 text-th-primary fill-th-primary" />}
                  </span>
                </InfoCard>

                <InfoCard label="Username" theme={theme}>
                  @{profile.username}
                </InfoCard>

                <InfoCard label="Status" theme={theme}>
                  <span className={`font-bold uppercase tracking-widest text-xs ${online ? 'text-th-online' : 'text-th-ink-soft'}`}>
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
    </div>,
    document.body
  );
}