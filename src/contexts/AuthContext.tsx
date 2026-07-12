import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { resetChatsReady } from '../hooks/useChatsReady';

interface Profile {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  last_seen: string;
  is_online: boolean;
  created_at: string;
  chat_biometric_type?: 'fingerprint' | 'face';
  
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{
    data: any;
    error: Error | null 
}>;
  verifySignupOtp: (email: string, token: string) => Promise<{ data: any; error: Error | null }>;
  resendSignupOtp: (email: string) => Promise<{ error: Error | null }>;
  completeProfileSetup: (username: string, displayName: string) => Promise<{ error: Error | null }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);

      // TOKEN_REFRESHED fires constantly — notably on every tab refocus,
      // since Supabase silently re-validates the session then. It hands us
      // a brand-new `user` object for the SAME account every time. Keeping
      // the same reference when the id hasn't changed stops that churn
      // from cascading into every effect elsewhere that depends on `user`
      // (this is what was re-triggering the loading screen on tab switch).
      setUser(prevUser => (prevUser?.id === session?.user?.id ? prevUser : session?.user ?? null));

      if (!session?.user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      // Only these events represent an actual identity/profile change worth
      // a re-fetch. Re-loading the whole profile on every token refresh was
      // wasted network calls AND handed out a new `profile` object each
      // time, which had its own knock-on re-render effects.
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') {
        loadProfile(session.user.id);
        updateOnlineStatus(true);
      } else {
        // A no-op event (e.g. TOKEN_REFRESHED) for an already-known session —
        // nothing changed, so make sure we're not left stuck on `loading`.
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(userId: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;
      setProfile(data);
    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      setLoading(false);
    }
  }

  async function updateOnlineStatus(isOnline: boolean) {
    if (!user) return;

    try {
      // We still update the DB so we know the LAST time they were seen
      // but we don't rely on this for the "Green Dot" anymore
      await supabase
        .from('profiles')
        .update({
          is_online: isOnline,
          last_seen: new Date().toISOString()
        })
        .eq('id', user.id);
    } catch (error) {
      console.error('Error updating online status:', error);
    }
  }

  // Phase 1: create the auth account only. With email confirmation enabled,
  // this does NOT return a session — no writes to `profiles`/etc. can happen
  // yet, since there's no authenticated JWT for RLS to check against.
  async function signUp(email: string, password: string) {
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('Failed to create user');

      return { data: authData, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  // Phase 2: verify the 6-digit code the user received by email. On
  // success this establishes a real session — onAuthStateChange picks it
  // up automatically (fires SIGNED_IN), no manual state wiring needed here.
  async function verifySignupOtp(email: string, token: string) {
    try {
      const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'signup' });
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }

  async function resendSignupOtp(email: string) {
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email });
      if (error) throw error;
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }

  // Phase 3: only runs once verifySignupOtp succeeded, so a real session
  // exists and these inserts are properly authenticated for RLS.
  async function completeProfileSetup(username: string, displayName: string) {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error('No authenticated session found. Please try signing in.');

      const lowerUsername = username.toLowerCase().trim();

      if (!/^[A-Za-z0-9_-]+$/.test(lowerUsername)) {
        throw new Error('Username can only contain A-Z, a-z, 0-9, - and _');
      }

      // Re-check availability here too — the live check in the signup form
      // only guards against collisions at the moment of typing; this closes
      // the (rare) gap where someone else grabs the same name in the few
      // minutes it takes to receive and enter the OTP code.
      const { data: existingUser } = await supabase
        .from('profiles')
        .select('username')
        .eq('username', lowerUsername)
        .maybeSingle();

      if (existingUser) {
        throw new Error('That username was just taken — please choose another and try again.');
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .insert({
          id: authUser.id,
          username: lowerUsername,
          display_name: displayName.trim(),
          bio: '',
          is_online: true,
          theme: 'sweet',
          face_lock_enabled: false,
        });

      if (profileError) throw profileError;

      const { error: privacyError } = await supabase
        .from('privacy_settings')
        .insert({
          user_id: authUser.id
        });

      if (privacyError) throw privacyError;

      const { error: selfChatError } = await supabase
        .from('chats')
        .insert({
          id: `self-${authUser.id}`,
          type: 'direct',
          name: 'Saved Messages',
          created_by: authUser.id
        });

      if (!selfChatError) {
        await supabase
          .from('chat_participants')
          .insert({
            chat_id: `self-${authUser.id}`,
            user_id: authUser.id,
            role: 'admin'
          });
      }

      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }

  async function signIn(email: string, password: string) {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }

  async function signOut() {
    if (user) {
      await updateOnlineStatus(false);
    }
    resetChatsReady();
    await supabase.auth.signOut();
  }

  async function updateProfile(updates: Partial<Profile>) {
    if (!user) return { error: new Error('No user logged in') };

    try {
      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id);

      if (error) throw error;

      setProfile(prev => prev ? { ...prev, ...updates } : null);
      return { error: null };
    } catch (error) {
      return { error: error as Error };
    }
  }

  // 1. GLOBAL PRESENCE TRACKER
  useEffect(() => {
    if (!user) return;

    // Connect to a global "heartbeat" channel
    const channel = supabase.channel('global-presence', {
      config: { presence: { key: user.id } },
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // This is the magic part: it broadcasts your status
        await channel.track({
          user_id: user.id,
          online_at: new Date().toISOString(),
        });
        
        // Update the database once just for the "Last Seen" time
        updateOnlineStatus(true);
      }
    });

    return () => {
      // When you close the tab, this stops, and you appear offline instantly
      supabase.removeChannel(channel);
    };
  }, [user]);

  useEffect(() => {
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      // When user comes back to the tab, we re-sync presence
      // This forces the "Last seen" to update immediately
      supabase.getChannels().forEach(ch => ch.track({ updated_at: Date.now() }));
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
}, []);

  const value = {
    user,
    profile,
    session,
    loading,
    signUp,
    verifySignupOtp,
    resendSignupOtp,
    completeProfileSetup,
    signIn,
    signOut,
    updateProfile
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}