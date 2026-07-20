// Tiny cross-component signal: lets ChatWindow ask the (separately mounted)
// ChatList to recompute its previews. Used when "delete for me" hides a
// message that happens to be a chat's last one — the list needs to fall back
// to the previous visible message, but it has no other way to know a hide
// happened, since that action never touches the database.

const listeners = new Set<() => void>();

export function requestChatListRefresh() {
  listeners.forEach((cb) => cb());
}

export function onChatListRefresh(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
