import { createContext, useContext, useState, useCallback, ReactNode, type CSSProperties } from 'react';
import { AlertTriangle } from 'lucide-react';
import { usePanelThemeStyle } from '../theme/panelTheme';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Theme colours for the dialog (set by useConfirm when asked from inside a chat). */
  themeStyle?: CSSProperties;
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

/**
 * Replaces window.confirm() — same "localhost says..." browser-chrome
 * problem as alert(), just for yes/no questions instead of one-off
 * announcements. Usage: const ok = await confirm("Clear all messages?");
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ options: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);

  const confirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    const normalized = typeof options === 'string' ? { message: options } : options;
    return new Promise((resolve) => {
      setState({ options: normalized, resolve });
    });
  }, []);

  function handleClose(result: boolean) {
    state?.resolve(result);
    setState(null);
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          style={state.options.themeStyle}
          onClick={() => handleClose(false)}
        >
          <div
            className="max-w-sm w-full rounded-2xl p-6 space-y-4 bg-th-card text-th-ink shadow-2xl border border-th-border animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className={`w-6 h-6 shrink-0 ${state.options.danger ? 'text-th-danger' : 'text-th-primary'}`} />
              <div>
                {state.options.title && (
                  <h3 className="font-bold text-th-ink mb-1">{state.options.title}</h3>
                )}
                <p className="text-sm text-th-ink-soft">{state.options.message}</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => handleClose(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-th-on-secondary bg-th-secondary hover:bg-th-card-hover transition-colors"
              >
                {state.options.cancelLabel || 'Cancel'}
              </button>
              <button
                onClick={() => handleClose(true)}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
                  state.options.danger ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-th-primary text-th-on-primary hover:opacity-90'
                }`}
              >
                {state.options.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be used within a ConfirmProvider');
  }
  // Asked from inside a chat: use the colours that chat gives its panels
  // (the chat's theme on a phone, see theme/panelTheme.tsx).
  const themeStyle = usePanelThemeStyle();
  const { confirm } = ctx;
  return useCallback(
    (options: ConfirmOptions | string) =>
      confirm({ ...(typeof options === 'string' ? { message: options } : options), themeStyle }),
    [confirm, themeStyle],
  );
}