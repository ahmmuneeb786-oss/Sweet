// In-memory bridge from the app-wide message sync to whichever ChatWindow is
// currently open. When useMessageSync writes an incoming/changed message into
// localDB, it emits it here; the open ChatWindow for that chat merges it into
// its view. This closes the race where a message that arrived just before the
// chat was opened wouldn't appear until reload — without any network refetch.

type MessageStoredCb = (message: any) => void;

const listeners = new Map<string, Set<MessageStoredCb>>();

export function emitMessageStored(chatId: string, message: any) {
  if (!chatId) return;
  listeners.get(chatId)?.forEach((cb) => {
    try {
      cb(message);
    } catch {
      /* a bad listener must not break the sync loop */
    }
  });
}

export function onMessageStored(chatId: string, cb: MessageStoredCb) {
  if (!listeners.has(chatId)) listeners.set(chatId, new Set());
  listeners.get(chatId)!.add(cb);
  return () => {
    const set = listeners.get(chatId);
    if (set) {
      set.delete(cb);
      if (set.size === 0) listeners.delete(chatId);
    }
  };
}
