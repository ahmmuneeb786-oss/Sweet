import { createContext, useContext, useState, useRef, useCallback, useMemo, useEffect, ReactNode } from 'react';
import { usePerformanceMonitor, type DeviceTier, type PerfLevel } from '../hooks/usePerformanceMonitor';
import { useIsMobile } from '../hooks/useIsMobile';
import { readStorage, writeStorage } from '../lib/safeStorage';

// 'force-low' is the 'reduced' level — name kept so saved choices still work.
export type PerfOverride = 'auto' | 'force-high' | 'force-low' | 'force-minimal';
const STORAGE_KEY = 'sweet_perf_override';
const OVERLAY_STORAGE_KEY = 'sweet_perf_overlay';
const OVERLAY_POSITION_KEY = 'sweet_perf_overlay_position';
const PERF_OVERRIDES: readonly PerfOverride[] = ['auto', 'force-high', 'force-low', 'force-minimal'];
const OVERRIDE_LEVEL: Record<Exclude<PerfOverride, 'auto'>, PerfLevel> = {
  'force-high': 'full',
  'force-low': 'reduced',
  'force-minimal': 'minimal',
};

// fps lives in its own context because it changes every second. Keeping it
// out of PerformanceContext means components that only read isLowPerfMode
// (every Message, ChatList, etc.) don't re-render once per second.
interface PerformanceContextType {
  deviceTier: DeviceTier;
  perfLevel: PerfLevel; // the effects level in use right now
  isLowPerfMode: boolean; // perfLevel !== 'full' — what most components check
  override: PerfOverride;
  setOverride: (o: PerfOverride) => void;
  showOverlay: boolean;
  setShowOverlay: (v: boolean) => void;
}

const PerformanceContext = createContext<PerformanceContextType | undefined>(undefined);
const FpsContext = createContext<number | undefined>(undefined);

export function PerformanceProvider({ children }: { children: ReactNode }) {
  const { fps, deviceTier, autoLevel } = usePerformanceMonitor();
  const [override, setOverrideState] = useState<PerfOverride>(() => {
    const saved = readStorage(STORAGE_KEY);
    return PERF_OVERRIDES.includes(saved as PerfOverride) ? (saved as PerfOverride) : 'auto';
  });
  const [showOverlay, setShowOverlayState] = useState<boolean>(() => {
    return readStorage(OVERLAY_STORAGE_KEY) === 'true';
  });

  const setOverride = useCallback((o: PerfOverride) => {
    setOverrideState(o);
    writeStorage(STORAGE_KEY, o);
  }, []);

  const setShowOverlay = useCallback((v: boolean) => {
    setShowOverlayState(v);
    writeStorage(OVERLAY_STORAGE_KEY, String(v));
  }, []);

  const perfLevel = override === 'auto' ? autoLevel : OVERRIDE_LEVEL[override];
  const isLowPerfMode = perfLevel !== 'full';

  // Drives the app-wide CSS in index.css (blur, decorative animations,
  // transitions) — covers every component, not just the ones that read
  // the context themselves.
  useEffect(() => {
    document.documentElement.dataset.perf = perfLevel;
  }, [perfLevel]);

  const value = useMemo<PerformanceContextType>(() => ({
    deviceTier, perfLevel, isLowPerfMode, override, setOverride, showOverlay, setShowOverlay
  }), [deviceTier, perfLevel, isLowPerfMode, override, setOverride, showOverlay, setShowOverlay]);

  return (
    <PerformanceContext.Provider value={value}>
      <FpsContext.Provider value={fps}>
        {children}
        {showOverlay && <PerformanceOverlay fps={fps} deviceTier={deviceTier} perfLevel={perfLevel} />}
      </FpsContext.Provider>
    </PerformanceContext.Provider>
  );
}

function PerformanceOverlay({ fps, deviceTier, perfLevel }: { fps: number; deviceTier: DeviceTier; perfLevel: PerfLevel }) {
  const isMobile = useIsMobile();
  const badgeRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const movedRef = useRef(false); // distinguishes a drag from a plain tap
  const dragOffset = useRef({ x: 0, y: 0 });

  // Default corner (used until the user drags it somewhere else, or after):
  // Desktop bottom-left / mobile top-left are this app's least-used corners
  // — see full reasoning below. Once dragged, the exact position persists.
  const [position, setPosition] = useState<{ x: number; y: number } | null>(() => {
    try {
      const saved = readStorage(OVERLAY_POSITION_KEY);
      const parsed = saved ? JSON.parse(saved) : null;
      return parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number' ? parsed : null;
    } catch {
      return null;
    }
  });

  // A saved position can end up off-screen after a rotation or window
  // resize, so pull it back inside the viewport on mount and on resize.
  useEffect(() => {
    function clampToViewport() {
      const badge = badgeRef.current;
      if (!badge) return;
      setPosition((prev) => {
        if (!prev) return prev;
        const x = Math.min(Math.max(0, prev.x), Math.max(0, window.innerWidth - badge.offsetWidth));
        const y = Math.min(Math.max(0, prev.y), Math.max(0, window.innerHeight - badge.offsetHeight));
        return x === prev.x && y === prev.y ? prev : { x, y };
      });
    }
    clampToViewport();
    window.addEventListener('resize', clampToViewport);
    return () => window.removeEventListener('resize', clampToViewport);
  }, []);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const rect = badgeRef.current?.getBoundingClientRect();
    if (!rect) return;
    draggingRef.current = true;
    movedRef.current = false;
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current || !badgeRef.current) return;
    movedRef.current = true;
    const width = badgeRef.current.offsetWidth;
    const height = badgeRef.current.offsetHeight;
    const x = Math.min(Math.max(0, e.clientX - dragOffset.current.x), window.innerWidth - width);
    const y = Math.min(Math.max(0, e.clientY - dragOffset.current.y), window.innerHeight - height);
    setPosition({ x, y });
  }

  function handlePointerUp() {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (movedRef.current) {
      setPosition((prev) => {
        if (prev) writeStorage(OVERLAY_POSITION_KEY, JSON.stringify(prev));
        return prev;
      });
    }
  }

  // Desktop: bottom-left is the one corner this app's layout never uses —
  // ChatList's header sits top, the compose bar spans bottom-center/full
  // width, and ChatWindow's header controls live top-right.
  // Mobile: top-left, just past the header's back-arrow icon — headers here
  // put controls at the edges, not tucked into the very corner, and bottom
  // is where the compose bar and on-screen keyboard live.
  const defaultPositionClass = isMobile ? 'top-3 left-3' : 'bottom-3 left-3';
  const style = position ? { top: position.y, left: position.x, right: 'auto', bottom: 'auto' } : undefined;

  return (
    <div
      ref={badgeRef}
      style={style}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`fixed ${position ? '' : defaultPositionClass} z-[9000] select-none touch-none cursor-move flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] font-bold shadow-[0_4px_15px_rgba(255,20,147,0.35)] bg-[#FF1493]/95 text-white border border-white/30`}
    >
      <span className={fps < 40 ? 'text-red-200' : fps < 55 ? 'text-amber-200' : 'text-white'}>
        {fps} FPS
      </span>
      <span className="opacity-50">•</span>
      <span className="capitalize opacity-90">{deviceTier}</span>
      {perfLevel !== 'full' && (
        <>
          <span className="opacity-50">•</span>
          <span className="capitalize text-amber-200">{perfLevel}</span>
        </>
      )}
    </div>
  );
}

export function usePerformance() {
  const ctx = useContext(PerformanceContext);
  if (!ctx) {
    throw new Error('usePerformance must be used within a PerformanceProvider');
  }
  return ctx;
}

// Re-renders the caller every second — use it only in small leaf components.
export function useFps() {
  const fps = useContext(FpsContext);
  if (fps === undefined) {
    throw new Error('useFps must be used within a PerformanceProvider');
  }
  return fps;
}