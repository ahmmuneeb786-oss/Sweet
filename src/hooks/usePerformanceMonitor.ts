import { useEffect, useRef, useState } from 'react';
import { readStorage, writeStorage } from '../lib/safeStorage';

export type DeviceTier = 'low' | 'medium' | 'high';

// Lightest last. 'reduced' = no blur, decorative animations frozen.
// 'minimal' = that, plus no transitions and no floating hearts at all.
export type PerfLevel = 'full' | 'reduced' | 'minimal';
export const PERF_LEVELS: readonly PerfLevel[] = ['full', 'reduced', 'minimal'];

interface PerformanceSnapshot {
  fps: number;
  deviceTier: DeviceTier;
  autoLevel: PerfLevel;
}

const LOW_FPS_THRESHOLD = 40;
// Main thread blocked for this long (beyond 50ms per task) within one 1s
// window = the app was visibly frozen for a quarter of that second.
const BLOCKING_MS_THRESHOLD = 250;
// A tap or key press that took this long to show its result on screen.
const SLOW_INPUT_MS = 200;
const BAD_WINDOWS_TO_STEP_DOWN = 3; // ~3s of consistently bad windows
const GOOD_SECONDS_TO_STEP_UP = 30;
// Startup, coming back from the background and our own level switch always
// stutter for a moment — never judge the device on those.
const WARMUP_MS = 3000;
const AUTO_LEVEL_KEY = 'sweet_perf_auto_level';

/**
 * One-time device capability heuristic. This is a STARTING GUESS, not the
 * source of truth — what's measured live (below) overrides it either way.
 */
function estimateDeviceTier(): DeviceTier {
  const nav = navigator as any;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = nav.deviceMemory as number | undefined; // Chrome-only, undefined elsewhere
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // The user asked their OS/browser for less motion or less data — honour it.
  if (prefersReducedMotion || nav.connection?.saveData) return 'low';
  if (memory !== undefined) {
    if (memory <= 2) return 'low';
    // 4GB Android phones are mostly budget devices; 4GB laptops cope fine.
    if (memory <= 4) return /Android/i.test(navigator.userAgent) ? 'low' : 'medium';
    return 'high';
  }
  // No deviceMemory API (Safari/Firefox) — fall back to core count alone
  if (cores <= 2) return 'low';
  if (cores <= 4) return 'medium';
  return 'high';
}

function isPerfLevel(v: string | null): v is PerfLevel {
  return PERF_LEVELS.includes(v as PerfLevel);
}

/**
 * Watches how the app actually behaves on this device and picks an effects
 * level, judged on ~1s windows. A window is "bad" if any of these happened:
 *  - fewer than 40 frames drawn (animations/scrolling stutter)
 *  - the main thread was blocked 250ms+ (long tasks — Chromium only)
 *  - a tap/key took 200ms+ to show its result (event timing — Chromium only)
 * FPS alone misses lag on a still screen, which is why the other two exist.
 *
 * 3 bad windows in a row → one level lighter. 30s of good windows → one
 * level richer, but only once per session so it can't flip back and forth.
 * The level is remembered, so the next launch starts where this one ended
 * instead of lagging for a few seconds before stepping down again.
 */
export function usePerformanceMonitor(): PerformanceSnapshot {
  const [fps, setFps] = useState(60);
  const [deviceTier] = useState<DeviceTier>(() => estimateDeviceTier());
  const [autoLevel, setAutoLevel] = useState<PerfLevel>(() => {
    const guess: PerfLevel = deviceTier === 'low' ? 'reduced' : 'full';
    const saved = readStorage(AUTO_LEVEL_KEY);
    if (!isPerfLevel(saved)) return guess;
    // Start from whichever is lighter: what last session settled on, or the guess.
    return PERF_LEVELS.indexOf(saved) > PERF_LEVELS.indexOf(guess) ? saved : guess;
  });
  const levelRef = useRef(autoLevel);

  useEffect(() => {
    let frames = 0;
    let windowStart = performance.now();
    let ignoreUntil = windowStart + WARMUP_MS;
    let blockingMs = 0;
    let slowInputs = 0;
    let badStreak = 0;
    let goodSince: number | null = null;
    let steppedUp = false;
    let rafId = 0;

    const observers: PerformanceObserver[] = [];
    function observe(type: string, onEntry: (e: PerformanceEntry) => void, extra: object = {}) {
      if (typeof PerformanceObserver === 'undefined') return;
      if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return; // Safari/Firefox: FPS alone still works
      try {
        const po = new PerformanceObserver((list) => list.getEntries().forEach(onEntry));
        po.observe({ type, ...extra } as PerformanceObserverInit);
        observers.push(po);
      } catch {
        // ignore — this signal just isn't available here
      }
    }
    // Only the part of each long task past 50ms counts (like Total Blocking Time).
    observe('longtask', (e) => { blockingMs += Math.max(0, e.duration - 50); });
    observe('event', (e) => { if (e.duration >= SLOW_INPUT_MS) slowInputs++; }, { durationThreshold: SLOW_INPUT_MS });

    function resetWindow(now: number) {
      frames = 0;
      windowStart = now;
      blockingMs = 0;
      slowInputs = 0;
    }

    function step(direction: 1 | -1, now: number) {
      const next = PERF_LEVELS[PERF_LEVELS.indexOf(levelRef.current) + direction];
      if (!next) return;
      levelRef.current = next;
      setAutoLevel(next);
      writeStorage(AUTO_LEVEL_KEY, next);
      // Switching level re-renders a lot — don't count that against the new level.
      ignoreUntil = now + WARMUP_MS;
      badStreak = 0;
      goodSince = null;
    }

    function tick() {
      frames++;
      const now = performance.now();
      const elapsed = now - windowStart;

      if (elapsed >= 1000) {
        const measuredFps = Math.round((frames * 1000) / elapsed);
        setFps(measuredFps);

        if (now >= ignoreUntil) {
          const bad = measuredFps < LOW_FPS_THRESHOLD || blockingMs >= BLOCKING_MS_THRESHOLD || slowInputs > 0;
          if (bad) {
            goodSince = null;
            if (++badStreak >= BAD_WINDOWS_TO_STEP_DOWN) step(1, now);
          } else {
            badStreak = 0;
            goodSince ??= now;
            if (!steppedUp && levelRef.current !== 'full' && now - goodSince >= GOOD_SECONDS_TO_STEP_UP * 1000) {
              steppedUp = true;
              step(-1, now);
            }
          }
        }
        resetWindow(now);
      }

      rafId = requestAnimationFrame(tick);
    }

    // Measuring a hidden app is meaningless (browsers pause drawing) and
    // wastes battery, so stop entirely and start fresh when it's back.
    function onVisibilityChange() {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      } else if (!rafId) {
        const now = performance.now();
        resetWindow(now);
        ignoreUntil = now + WARMUP_MS;
        badStreak = 0;
        goodSince = null;
        rafId = requestAnimationFrame(tick);
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    if (!document.hidden) rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      observers.forEach((po) => po.disconnect());
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return { fps, deviceTier, autoLevel };
}
