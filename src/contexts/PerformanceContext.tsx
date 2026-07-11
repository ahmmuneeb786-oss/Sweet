import { createContext, useContext, useState, useRef, ReactNode } from 'react';
import { usePerformanceMonitor, type DeviceTier } from '../hooks/usePerformanceMonitor';
import { useIsMobile } from '../hooks/useIsMobile';

type PerfOverride = 'auto' | 'force-low' | 'force-high';
const STORAGE_KEY = 'sweet_perf_override';
const OVERLAY_STORAGE_KEY = 'sweet_perf_overlay';
const OVERLAY_POSITION_KEY = 'sweet_perf_overlay_position';

interface PerformanceContextType {
  fps: number;
  deviceTier: DeviceTier;
  isLowPerfMode: boolean; // what components should actually read to decide behavior
  override: PerfOverride;
  setOverride: (o: PerfOverride) => void;
  showOverlay: boolean;
  setShowOverlay: (v: boolean) => void;
}

const PerformanceContext = createContext<PerformanceContextType | undefined>(undefined);

export function PerformanceProvider({ children }: { children: ReactNode }) {
  const { fps, deviceTier, isLowPerfMode: autoLowPerf } = usePerformanceMonitor();
  const [override, setOverrideState] = useState<PerfOverride>(() => {
    return (localStorage.getItem(STORAGE_KEY) as PerfOverride) || 'auto';
  });
  const [showOverlay, setShowOverlayState] = useState<boolean>(() => {
    return localStorage.getItem(OVERLAY_STORAGE_KEY) === 'true';
  });

  function setOverride(o: PerfOverride) {
    setOverrideState(o);
    localStorage.setItem(STORAGE_KEY, o);
  }

  function setShowOverlay(v: boolean) {
    setShowOverlayState(v);
    localStorage.setItem(OVERLAY_STORAGE_KEY, String(v));
  }

  const isLowPerfMode =
    override === 'force-low' ? true :
    override === 'force-high' ? false :
    autoLowPerf;

  const value: PerformanceContextType = {
    fps, deviceTier, isLowPerfMode, override, setOverride, showOverlay, setShowOverlay
  };

  return (
    <PerformanceContext.Provider value={value}>
      {children}
      {showOverlay && <PerformanceOverlay fps={fps} deviceTier={deviceTier} isLowPerfMode={isLowPerfMode} />}
    </PerformanceContext.Provider>
  );
}

function PerformanceOverlay({ fps, deviceTier, isLowPerfMode }: { fps: number; deviceTier: DeviceTier; isLowPerfMode: boolean }) {
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
      const saved = localStorage.getItem(OVERLAY_POSITION_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const rect = badgeRef.current?.getBoundingClientRect();
    if (!rect) return;
    draggingRef.current = true;
    movedRef.current = false;
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
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
        if (prev) localStorage.setItem(OVERLAY_POSITION_KEY, JSON.stringify(prev));
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
      {isLowPerfMode && (
        <>
          <span className="opacity-50">•</span>
          <span className="text-amber-200">Reduced</span>
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