// localStorage can throw (private browsing, blocked site data). Use these for
// settings that are only conveniences, so failures fall back to defaults
// instead of crashing the app.
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore — the setting just won't persist
  }
}
