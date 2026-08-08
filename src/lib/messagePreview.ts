// Turns the last message of a chat into the short preview line shown under
// the name in the chat list. Kept in one place so the chat list, the cache,
// and the realtime handlers all label messages identically.

export interface PreviewMessage {
  content?: string | null;
  type?: string | null;
  is_deleted?: boolean | null;
  created_at?: string | null;
}

const EMPTY = 'No messages yet... 👋';

export function formatMessagePreview(msg: PreviewMessage | null | undefined): string {
  // Nothing has ever been sent in this chat.
  if (!msg || (!msg.content && !msg.type && !msg.created_at)) return EMPTY;

  // A deleted message wins over whatever its old content was.
  if (msg.is_deleted) return '🚫 Deleted message';

  const content = (msg.content ?? '').trim();

  switch (msg.type) {
    case 'gif':
      return '🎞️ GIF';
    case 'image':
      return content ? `📷 ${content}` : '📷 Photo';
    case 'video':
    case 'video_note':
      return content ? `🎥 ${content}` : '🎥 Video';
    case 'voice':
      return '🎤 Voice message';
    case 'file':
    case 'doc':
      return content ? `📎 ${content}` : '📎 File';
    default:
      // 'text' (and anything unknown). Location is stored as a text message
      // whose content is a maps URL, so detect and label it rather than
      // dumping the raw link.
      if (content.includes('maps')) return '📍 Location';
      return content || EMPTY;
  }
}
