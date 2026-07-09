import { useEffect, useState } from 'react';

/**
 * Lets ChatList tell the app-level splash screen "I've actually rendered
 * something now" — whether that came from cache or a fresh network fetch.
 * This is what lets the splash bridge into real content being visible,
 * instead of disappearing the instant auth resolves (which is all it
 * checked before).
 */

let ready = false;
const listeners = new Set<() => void>();

export function markChatsReady() {
  if (ready) return;
  ready = true;
  listeners.forEach((cb) => cb());
}

// Call on logout so the next login properly waits again instead of the
// splash skipping straight through on a stale "ready" flag.
export function resetChatsReady() {
  ready = false;
}

export function useChatsReady() {
  const [isReady, setIsReady] = useState(ready);

  useEffect(() => {
    if (ready) {
      setIsReady(true);
      return;
    }
    const listener = () => setIsReady(true);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return isReady;
}