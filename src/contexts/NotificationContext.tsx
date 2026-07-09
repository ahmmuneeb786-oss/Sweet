import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';

type ToastType = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface NotificationContextType {
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  showInfo: (message: string) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

let idCounter = 0;

/**
 * App-wide in-app notifications — replaces browser alert() popups (the ugly
 * "localhost says..." dialogs) with a toast styled like the banners
 * ProfileSidebar already used, available from any component.
 *
 * NOT meant for: message send status (ChatWindow already has its own
 * sending/pending/failed indicators inline on the bubble), or inline field
 * errors like an incorrect PIN (VaultVerify shows that right where it's
 * relevant). Those already have the right contextual UI — this is
 * specifically for the "your action succeeded/failed" one-off announcements
 * that used to be alert().
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const isMobile = useIsMobile();

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((type: ToastType, message: string) => {
    const id = ++idCounter;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => dismiss(id), 3500);
  }, [dismiss]);

  const value: NotificationContextType = {
    showSuccess: (message) => push('success', message),
    showError: (message) => push('error', message),
    showInfo: (message) => push('info', message),
  };

  // Mobile: top, below the notch/status bar, stacking downward — bottom is
  // where the compose bar and on-screen keyboard live in this app, so a
  // toast there would either get covered or push content around.
  // Desktop: bottom-right, stacking upward — the conventional desktop toast
  // corner, and it stays clear of the chat header up top.
  const containerClass = isMobile
    ? 'fixed top-4 inset-x-0 z-[10000] flex flex-col gap-2 items-center px-4 pointer-events-none'
    : 'fixed bottom-4 right-4 z-[10000] flex flex-col-reverse gap-2 items-end pointer-events-none';

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className={containerClass}>
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-sm w-full sm:w-80 flex items-start gap-2 px-4 py-3 rounded-xl text-sm font-semibold shadow-lg border animate-in duration-300 ${
              isMobile ? 'slide-in-from-top-2 fade-in' : 'slide-in-from-bottom-2 fade-in'
            } ${
              t.type === 'success'
                ? 'bg-green-50 border-green-200 text-green-700'
                : t.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-blue-50 border-blue-200 text-blue-700'
            }`}
          >
            {t.type === 'success' && <CheckCircle2 className="w-5 h-5 shrink-0" />}
            {t.type === 'error' && <XCircle className="w-5 h-5 shrink-0" />}
            {t.type === 'info' && <Info className="w-5 h-5 shrink-0" />}
            <span className="flex-1">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotify() {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotify must be used within a NotificationProvider');
  }
  return ctx;
}