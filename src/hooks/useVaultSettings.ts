import { useEffect, useState } from 'react';
import { localDB } from '../db';
import { hasCamera } from '../lib/camera';
import { fetchVault, getCachedVault, onVaultChange, peekVault, type VaultSettings } from '../lib/vault';

// The signed-in user's vault_settings row (lock settings for both the
// Locked Chats vault and the App Lock), as every lock screen and settings
// tab needs it: memory copy on the first render (no loading flash), then
// the device copy (works offline), then fresh from the server — and kept
// current by every later save via onVaultChange.
export function useVaultSettings(userId: string) {
  const [vault, setVault] = useState<VaultSettings | null>(() => peekVault(userId));
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCachedVault(userId).then((cached) => {
      if (cached && !cancelled) setVault((current) => current ?? cached);
    });
    fetchVault(userId)
      .then((fresh) => { if (!cancelled) setVault(fresh); })
      .catch((err) => {
        console.error('Failed to load vault settings:', err);
        if (!cancelled) setLoadFailed(true);
      });
    const unsubscribe = onVaultChange((uid, changed) => {
      if (uid === userId) setVault(changed);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId]);

  return { vault, loadFailed };
}

// The registered face as this device last cached it — fallback while the
// vault row (which holds the real one) is still loading.
export function useCachedFace(userId: string) {
  const [face, setFace] = useState<number[] | null>(null);
  useEffect(() => {
    localDB.getFaceLockDataLocally(userId).then((cached) => {
      if (cached?.descriptor) setFace(cached.descriptor);
    });
  }, [userId]);
  return [face, setFace] as const;
}

// null until known. A saved face can't unlock anything without a camera.
export function useCameraAvailable() {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    hasCamera().then(setAvailable);
  }, []);
  return available;
}
