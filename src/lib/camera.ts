// Whether this device has any camera at all — a saved face can't unlock
// anything on a PC without one. enumerateDevices() lists video inputs even
// before camera permission is granted (just without labels), so this
// doesn't trigger a permission prompt.
let cached: Promise<boolean> | null = null;

export function hasCamera(): Promise<boolean> {
  if (!cached) {
    cached = (async () => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return false;
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.some((d) => d.kind === 'videoinput');
      } catch {
        // Can't tell — assume there is one rather than hide a working face lock.
        return true;
      }
    })();
  }
  return cached;
}
