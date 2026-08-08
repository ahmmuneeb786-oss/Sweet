// Detects whether the app is currently running inside Telegram's Mini App
// WebView. Telegram injects `window.Telegram.WebApp` into the page — this
// object simply doesn't exist in a normal browser tab or in Electron, so
// checking for it is a safe, synchronous way to branch behavior.
export function isTelegramMiniApp(): boolean {
  return typeof window !== 'undefined' && !!(window as any).Telegram?.WebApp;
}

// Detects Electron — useful for the same reason, kept here for completeness
// even though we're not using it in this pass.
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electron;
}