// Detects Electron — kept here for completeness even though nothing uses it
// yet.
export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!(window as any).electron;
}
