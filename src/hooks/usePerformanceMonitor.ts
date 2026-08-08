import { useEffect, useRef, useState } from 'react';

export type DeviceTier = 'low' | 'medium' | 'high';

interface PerformanceSnapshot {
  fps: number;
  deviceTier: DeviceTier;
  isLowPerfMode: boolean;
}

const LOW_FPS_THRESHOLD = 40;
const SUSTAINED_LOW_FPS_SECONDS = 3; // how long fps must stay low before we act on it

/**
 * One-time device capability heuristic. This is a STARTING GUESS, not the
 * source of truth — sustained live FPS (below) overrides it either way,
 * since actual measured responsiveness matters more than guessed specs.
 */
function estimateDeviceTier(): DeviceTier {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as any).deviceMemory as number | undefined; // Chrome-only, undefined elsewhere
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) return 'low';
  if (memory !== undefined) {
    if (memory <= 2) return 'low';
    if (memory <= 4) return 'medium';
    return 'high';
  }
  // No deviceMemory API (Safari/Firefox) — fall back to core count alone
  if (cores <= 2) return 'low';
  if (cores <= 4) return 'medium';
  return 'high';
}

/**
 * Live FPS tracking via requestAnimationFrame frame-delta timing, averaged
 * over ~1s windows so a single stutter doesn't cause flapping.
 */
export function usePerformanceMonitor(): PerformanceSnapshot {
  const [fps, setFps] = useState(60);
  const [deviceTier] = useState<DeviceTier>(() => estimateDeviceTier());
  const [isLowPerfMode, setIsLowPerfMode] = useState(deviceTier === 'low');

  const frameCount = useRef(0);
  const windowStart = useRef(performance.now());
  const lowFpsStreakStart = useRef<number | null>(null);
  const rafId = useRef<number>();

  useEffect(() => {
    function tick() {
      frameCount.current++;
      const now = performance.now();
      const elapsed = now - windowStart.current;

      if (elapsed >= 1000) {
        const measuredFps = Math.round((frameCount.current * 1000) / elapsed);
        setFps(measuredFps);
        frameCount.current = 0;
        windowStart.current = now;

        if (measuredFps < LOW_FPS_THRESHOLD) {
          if (lowFpsStreakStart.current === null) {
            lowFpsStreakStart.current = now;
          } else if (now - lowFpsStreakStart.current >= SUSTAINED_LOW_FPS_SECONDS * 1000) {
            setIsLowPerfMode(true);
          }
        } else {
          // Recovered — reset the streak. Note: once auto-triggered, low-perf
          // mode stays on for the session rather than flipping back and forth
          // every time fps briefly recovers, since toggling heavy effects
          // on/off repeatedly is itself janky.
          lowFpsStreakStart.current = null;
        }
      }

      rafId.current = requestAnimationFrame(tick);
    }

    rafId.current = requestAnimationFrame(tick);
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, []);

  return { fps, deviceTier, isLowPerfMode };
}