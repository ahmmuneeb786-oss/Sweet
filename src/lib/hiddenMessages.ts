// "Delete for me" — message ids the user hid on THIS device only. The rows
// still exist in Supabase (and for the other person), so we persist the
// hidden ids locally and filter them out wherever messages are read
// (ChatWindow's message list AND the ChatList preview); otherwise a hidden
// message would reappear the moment something re-fetches from the server.

const HIDDEN_MESSAGES_KEY = 'sweet_hidden_messages';

export function loadHiddenMessageIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_MESSAGES_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

export function hideMessageLocally(id: string) {
  const ids = loadHiddenMessageIds();
  ids.add(id);
  localStorage.setItem(HIDDEN_MESSAGES_KEY, JSON.stringify([...ids]));
}
