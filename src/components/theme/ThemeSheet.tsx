import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePanelThemeStyle } from '../../theme/panelTheme';

/**
 * Bottom sheet (centred dialog on wide screens) in the app theme's colours.
 * Portalled to <body>: the tabs fade in with a transform, and a transformed
 * ancestor would trap a `fixed` sheet inside the tab instead of the screen.
 */
export function ThemeSheet({ title, subtitle, onClose, children }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Opened from a chat: that chat's colours on a phone (see panelTheme.tsx).
  const panelStyle = usePanelThemeStyle();

  return createPortal(
    <div className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" style={panelStyle} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sheet-up w-full max-w-sm rounded-3xl p-5 space-y-4 shadow-2xl max-h-[88vh] overflow-y-auto bg-th-card border border-th-border text-th-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-lg font-black leading-tight">{title}</h3>
          {subtitle && <p className="text-xs mt-0.5 text-th-ink-soft">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** A full-width row button for sheets. */
export function SheetAction({ icon, label, hint, onClick, danger, primary }: {
  icon?: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
  primary?: boolean;
}) {
  const tone = primary
    ? 'bg-th-primary text-th-on-primary hover:opacity-90'
    : danger
      ? 'text-th-danger hover:bg-th-danger/10'
      : 'bg-th-secondary text-th-on-secondary hover:bg-th-card-hover';
  return (
    <button type="button" onClick={onClick} className={`w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors ${tone}`}>
      {icon && <span className="shrink-0" aria-hidden="true">{icon}</span>}
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-bold">{label}</span>
        {hint && <span className="block text-[11px] opacity-75">{hint}</span>}
      </span>
    </button>
  );
}
