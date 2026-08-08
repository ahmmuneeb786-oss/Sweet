import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

type VisitContextType = {
  logEvent: (eventType: string, data?: Record<string, any>) => void;
};

const VisitContext = createContext<VisitContextType>({ logEvent: () => {} });
export const useVisitTracking = () => useContext(VisitContext);

const HEARTBEAT_MS = 30000; // update last_seen_at every 30s

export function VisitTrackingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const visitIdRef = useRef<string | null>(null);
  const [ready, setReady] = useState(false);

  const logEvent = (eventType: string, data?: Record<string, any>) => {
    if (!visitIdRef.current) return;
    supabase.from('visit_events').insert([{
      visit_id: visitIdRef.current,
      event_type: eventType,
      event_data: data ?? null,
    }]).then(({ error }) => {
      if (error) console.error('logEvent failed:', error.message);
    });
  };

  // Create the visit row once, on mount
  useEffect(() => {
    async function startVisit() {
      let visitorId = localStorage.getItem('app_visitor_id');
      if (!visitorId) {
        visitorId = 'anon_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('app_visitor_id', visitorId);
      }
      const hasLoggedInBefore = localStorage.getItem('app_has_logged_in_before') === 'true';

      const { data, error } = await supabase.from('visits').insert([{
        session_id: visitorId,
        visitor_id: visitorId,
        has_logged_in_before: hasLoggedInBefore,
        was_authenticated: false, // updated below if user is already logged in
        entry_path: window.location.pathname,
        referrer: document.referrer || null,
        user_agent: navigator.userAgent,
      }]).select('id').single();

      if (error) {
        console.error('Failed to start visit:', error.message);
        return;
      }
      visitIdRef.current = data.id;
      setReady(true);
    }
    startVisit();

    // mark visit ended on tab close
    const handleUnload = () => {
      if (!visitIdRef.current) return;
      navigator.sendBeacon?.(
        `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/visits?id=eq.${visitIdRef.current}`,
      );
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);

  // Heartbeat — keeps last_seen_at fresh so you can tell active vs abandoned
  useEffect(() => {
    if (!ready) return;
    const interval = setInterval(() => {
      if (!visitIdRef.current) return;
      supabase.from('visits')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', visitIdRef.current)
        .then(() => {});
    }, HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [ready]);

  // When auth state resolves/changes, tag the visit + update the permanent flag
  useEffect(() => {
    if (!ready || !visitIdRef.current) return;
    if (user) {
      localStorage.setItem('app_has_logged_in_before', 'true');
      supabase.from('visits').update({
        user_id: user.id,
        was_authenticated: true,
      }).eq('id', visitIdRef.current).then(() => {});
      logEvent('auth_change', { status: 'logged_in' });
    }
  }, [ready, user]);

  // Global error capture
  useEffect(() => {
    if (!ready) return;
    const onError = (e: ErrorEvent) => {
      logEvent('error', { message: e.message, filename: e.filename, lineno: e.lineno });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      logEvent('error', { message: String(e.reason), type: 'unhandled_rejection' });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [ready]);

  return <VisitContext.Provider value={{ logEvent }}>{children}</VisitContext.Provider>;
}