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

      // Via a function: visitors can create their own visit but never read
      // or change anyone else's (the visits table itself isn't readable).
      const { data, error } = await supabase.rpc('start_visit', {
        p_visitor_id: visitorId,
        p_has_logged_in_before: hasLoggedInBefore,
        p_entry_path: window.location.pathname,
        p_referrer: document.referrer || null,
        p_user_agent: navigator.userAgent,
      });

      if (error || !data) {
        console.error('Failed to start visit:', error?.message);
        return;
      }
      visitIdRef.current = data as string;
      setReady(true);
    }
    startVisit();
  }, []);

  // Heartbeat — keeps last_seen_at fresh so you can tell active vs abandoned
  useEffect(() => {
    if (!ready) return;
    const interval = setInterval(() => {
      if (!visitIdRef.current) return;
      supabase.rpc('touch_visit', { p_visit_id: visitIdRef.current }).then(() => {});
    }, HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [ready]);

  // When auth state resolves/changes, tag the visit + update the permanent flag
  useEffect(() => {
    if (!ready || !visitIdRef.current) return;
    if (user) {
      localStorage.setItem('app_has_logged_in_before', 'true');
      supabase.rpc('link_visit_to_user', { p_visit_id: visitIdRef.current }).then(() => {});
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