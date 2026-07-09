import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
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
          onClick={() => handleClose(false)}
        >
          <div
            className="max-w-sm w-full rounded-2xl p-6 space-y-4 bg-white dark:bg-gray-900 shadow-2xl border border-pink-100 dark:border-gray-700 animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className={`w-6 h-6 shrink-0 ${state.options.danger ? 'text-red-500' : 'text-pink-500'}`} />
              <div>
                {state.options.title && (
                  <h3 className="font-bold text-gray-900 dark:text-white mb-1">{state.options.title}</h3>
                )}
                <p className="text-sm text-gray-600 dark:text-gray-300">{state.options.message}</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => handleClose(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                {state.options.cancelLabel || 'Cancel'}
              </button>
              <button
                onClick={() => handleClose(true)}
                className={`px-4 py-2 rounded-xl text-sm font-bold text-white transition-colors ${
                  state.options.danger ? 'bg-red-500 hover:bg-red-600' : 'bg-pink-500 hover:bg-pink-600'
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
  return ctx.confirm;
}