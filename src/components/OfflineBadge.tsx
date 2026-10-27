import { useState, useEffect, useRef } from 'react';
import { CloudOff } from 'lucide-react';
import { useIsMobile } from '../hooks/useIsMobile';

interface OfflineBadgeProps {
  theme: 'light' | 'dark' | 'sweet';
  /** Only render on the mobile layout (desktop keeps a single badge, in ChatList). */
  mobileOnly?: boolean;
  /**
   * Sweet theme only: the pink of the header the badge sits on. Same rule as
   * Settings — a light-pink surface gets a dark-pink pill and vice versa, so
   * the pill always stands out from what's behind it.
   */
  surface?: 'light' | 'dark';
}

const PANEL_WIDTH = 256;
const SCREEN_MARGIN = 16;

/**
 * The "Offline Mode" pill shown next to a header while the device is offline.
 * Renders nothing while online, so callers can drop it in unconditionally.
 * Hovering it (mouse) or tapping it (touch) opens a small panel explaining
 * what offline mode means. The panel text mirrors what useOfflineSync really
 * does: queued messages and profile edits are flushed when the connection returns.
 */
export function OfflineBadge({ theme, mobileOnly = false, surface = 'light' }: OfflineBadgeProps) {
  const isMobile = useIsMobile();
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [open, setOpen] = useState(false);
  // Horizontal shift (px) that keeps the panel inside the screen — badges
  // sit at different spots in different headers, so a fixed `left: 0`
  // would run off the right edge on narrow phones.
  const [panelOffset, setPanelOffset] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const goOnline = () => {
      setIsOffline(false);
      setOpen(false);
    };
    const goOffline = () => setIsOffline(true);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Close when tapping/clicking anywhere outside, or pressing Escape.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function openPanel() {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(PANEL_WIDTH, window.innerWidth - SCREEN_MARGIN * 2);
      const overflowRight = rect.left + width - (window.innerWidth - SCREEN_MARGIN);
      let offset = overflowRight > 0 ? -overflowRight : 0;
      if (rect.left + offset < SCREEN_MARGIN) offset = SCREEN_MARGIN - rect.left;
      setPanelOffset(offset);
    }
    setOpen(true);
  }

  if (!isOffline || (mobileOnly && !isMobile)) return null;

  return (
    <div
      ref={wrapperRef}
      className="relative shrink-0"
      // Hover only for real mice — on touch, pointerenter fires right before
      // the click and would make the tap immediately close the panel again.
      onPointerEnter={(e) => e.pointerType === 'mouse' && openPanel()}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}
    >
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        aria-expanded={open}
        aria-label="Offline mode, show details"
        className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap cursor-help transition-colors ${
          theme !== 'sweet'
            ? 'bg-pink-100 text-pink-700'
            : open
            ? 'border border-[#FF1493] bg-white text-[#FF1493]' // selected, like the active Theme option
            : surface === 'light'
            ? 'border border-[#FFB6C1] bg-[#FFE4E1] text-pink-700 hover:bg-white'
            : 'border border-[#FFB6C1] bg-[#FFF0F5] text-pink-700 hover:bg-white'
        }`}
      >
        <CloudOff className="w-3 h-3" />
        <span>Offline Mode</span>
      </button>

      {open && (
        <div
          role="tooltip"
          style={{ left: panelOffset, width: `min(${PANEL_WIDTH}px, calc(100vw - ${SCREEN_MARGIN * 2}px))` }}
          className={`absolute top-full mt-2 p-3 rounded-xl shadow-xl z-50 text-xs font-normal normal-case tracking-normal text-left ${
            theme === 'dark'
              ? 'border bg-gray-800 border-gray-700 text-gray-200'
              : theme === 'sweet'
              ? 'border-2 border-[#FFD1DC] bg-[#FFF0F5] text-[#4B004B]'
              : 'border bg-white border-gray-200 text-gray-700'
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1.5 font-bold text-pink-600">
            {/* Sweet: the icon sits inside the light-pink card, so it gets a
                dark-pink box — same nesting rule as Settings. */}
            <span className={theme === 'sweet' ? 'p-1 rounded-lg border border-[#FFB6C1] bg-[#FFE4E1]' : ''}>
              <CloudOff className="w-4 h-4" />
            </span>
            You're offline
          </div>
          <p className="mb-1.5">
            Don't worry, you can keep using Sweet. Messages you send and changes you make to your profile are saved on this device for now.
          </p>
          <p>
            As soon as you're back online, they'll be uploaded automatically. You don't need to do anything.
          </p>
        </div>
      )}
    </div>
  );
}
