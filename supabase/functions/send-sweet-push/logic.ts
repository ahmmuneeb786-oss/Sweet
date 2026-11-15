/*
  Pure helpers for send-sweet-push — no network, no Deno APIs, so they can be
  unit-tested with plain Node. Everything that decides WHAT a notification
  says lives here; index.ts decides WHO gets it.
*/

export type Peek = "full" | "sender" | "secret"
export type JarKind = "night" | "work" | "study" | "me" | "custom"

export interface Prefs {
  messages: boolean
  friend_requests: boolean
  theme_changes: boolean
  calls: boolean
  peek: Peek
  timezone: string
  vibration: number[] | null
  vibration_by_sender: Record<string, number[]>
}

export const DEFAULT_PREFS: Prefs = {
  messages: true,
  friend_requests: true,
  theme_changes: true,
  calls: true,
  peek: "full",
  timezone: "UTC",
  vibration: null,
  vibration_by_sender: {},
}

export const DEFAULT_VIBRATION = [100, 50, 100]

export interface PushPayload {
  title: string
  body: string
  tag: string
  url: string
  kind: "message" | "theme" | "friend" | "digest" | "test"
  chatId?: string
  vibrate: number[]
  testId?: string
  sentAt?: number
}

const PREVIEW_BY_TYPE: Record<string, string> = {
  image: "📷 Photo",
  gif: "GIF",
  video: "🎥 Video",
  video_note: "🎥 Video message",
  voice: "🎤 Voice message",
  audio: "🎤 Voice message",
  file: "📄 Document",
  doc: "📄 Document",
  location: "📍 Location",
}

/** Same limits as the database and the service worker. */
export function isValidVibration(v: unknown): v is number[] {
  return Array.isArray(v) && v.length >= 1 && v.length <= 24 &&
    v.every((n) => Number.isInteger(n) && n >= 0 && n <= 1000) &&
    v.reduce((a: number, b: number) => a + b, 0) <= 6000
}

export function vibrationFor(prefs: Prefs, senderId: string | null): number[] {
  const own = senderId ? prefs.vibration_by_sender?.[senderId] : undefined
  if (isValidVibration(own)) return own
  if (isValidVibration(prefs.vibration)) return prefs.vibration
  return DEFAULT_VIBRATION
}

export function messagePreview(type: string | null, content: string | null): string {
  if (type === "theme_change") return `🎨 Changed your chat theme to ${(content || "Default").slice(0, 40)}`
  if (type && type !== "text") return PREVIEW_BY_TYPE[type] ?? "Sent you something 💕"
  return (content || "").slice(0, 200) || "💕"
}

/** Which preference switch a message type belongs to. */
export function categoryFor(type: string | null): "messages" | "theme_changes" {
  return type === "theme_change" ? "theme_changes" : "messages"
}

/**
 * A chat message notification. Locked (vault) chats are always "secret" and
 * carry no chat id, so nothing on the lock screen or in the click target
 * reveals which chat it was.
 */
export function messagePayload(opts: {
  peek: Peek
  locked: boolean
  senderName: string
  chatId: string
  type: string | null
  content: string | null
  vibrate: number[]
}): PushPayload {
  const peek: Peek = opts.locked ? "secret" : opts.peek
  const kind = opts.type === "theme_change" ? "theme" : "message"
  if (peek === "secret") {
    return {
      title: "Sweet 🍬",
      body: "Something sweet arrived 💕",
      // locked chats share one tag so no per-chat trail builds up
      tag: opts.locked ? "sweet-secret" : `chat-${opts.chatId}`,
      url: opts.locked ? "/" : `/?chat=${encodeURIComponent(opts.chatId)}`,
      chatId: opts.locked ? undefined : opts.chatId,
      kind,
      vibrate: opts.vibrate,
    }
  }
  return {
    title: `${opts.senderName} 🍬`,
    body: peek === "full" ? messagePreview(opts.type, opts.content) : (kind === "theme" ? "Changed your chat theme 🎨" : "New message 💕"),
    tag: `chat-${opts.chatId}`,
    url: `/?chat=${encodeURIComponent(opts.chatId)}`,
    chatId: opts.chatId,
    kind,
    vibrate: opts.vibrate,
  }
}

export function friendRequestPayload(peek: Peek, senderName: string, vibrate: number[]): PushPayload {
  return {
    title: peek === "secret" ? "Sweet 🍬" : "New friend request 💌",
    body: peek === "secret" ? "Someone sent you something sweet 💕" : `${senderName} wants to be friends`,
    tag: "friend-requests",
    url: "/?friends=1",
    kind: "friend",
    vibrate,
  }
}

// ---- Bedtime Jar wake-up digest -------------------------------------------

/** "07:30:00" → 7 */
function hourOf(time: string): number {
  const h = parseInt(time.slice(0, 2), 10)
  return Number.isFinite(h) ? h : 12
}

/** Greeting chosen by the time of day the jar ends at (in the user's timezone). */
export function timeOfDayGreeting(endTime: string): string {
  const h = hourOf(endTime)
  if (h >= 4 && h < 12) return "☀️ Good morning!"
  if (h >= 12 && h < 17) return "🌤️ Good afternoon!"
  if (h >= 17 && h < 22) return "🌆 Good evening!"
  return "🌙 Welcome back!"
}

/**
 * The jar's type sets the mood; the end time keeps it honest. A night jar
 * that ends at 14:00 (night shift) gets "Good afternoon", never "Good morning".
 */
export function jarGreeting(kind: JarKind, endTime: string): string {
  const h = hourOf(endTime)
  switch (kind) {
    case "night":
      return h >= 4 && h < 12 ? "☀️ Good morning!" : timeOfDayGreeting(endTime)
    case "work":
      return "🍬 Work's done, time to relax!"
    case "study":
      return "📚 Books closed!"
    case "me":
      return "🌸 Welcome back!"
    default:
      return timeOfDayGreeting(endTime)
  }
}

/** ["Ayesha"] → "Ayesha"; 2 → "A & B"; 3+ → "A, B & 2 others" */
export function joinNames(names: string[]): string {
  if (names.length === 0) return ""
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  const rest = names.length - 2
  return `${names[0]}, ${names[1]} & ${rest} ${rest === 1 ? "other" : "others"}`
}

export interface JarItem { sender_id: string; count: number; locked: boolean }

export function digestPayload(opts: {
  jarName: string
  kind: JarKind
  endTime: string
  items: JarItem[]
  names: Record<string, string>
  peek: Peek
  vibrate: number[]
}): PushPayload | null {
  const total = opts.items.reduce((a, i) => a + (i.count > 0 ? i.count : 0), 0)
  if (total <= 0) return null

  const noun = total === 1 ? "sweet message" : "sweet messages"
  // "Sleepy" → "Sleepy jar"; "Work jar" stays as it is
  const name = opts.jarName.trim()
  const jar = !name ? "jar" : /\bjar\b/i.test(name) ? name : `${name} jar`
  // Names only from unlocked chats, and never when the user chose "secret".
  const named = opts.peek === "secret" ? [] : [...new Set(
    opts.items.filter((i) => !i.locked).map((i) => opts.names[i.sender_id]).filter(Boolean),
  )]
  const who = named.length ? ` from ${joinNames(named)}` : ""
  return {
    title: jarGreeting(opts.kind, opts.endTime),
    body: `${total} ${noun}${who} waited in your ${jar} 🍬`,
    tag: "sweet-digest",
    url: "/",
    kind: "digest",
    vibrate: opts.vibrate,
  }
}

export function testPayload(testId: string, vibrate: number[]): PushPayload {
  return {
    title: "🍬 Test candy",
    body: "If you can read this, Sweet can reach you!",
    tag: "sweet-test",
    url: "/",
    kind: "test",
    vibrate,
    testId,
    sentAt: Date.now(),
  }
}

export function mergePrefs(row: Partial<Prefs> | null | undefined): Prefs {
  return { ...DEFAULT_PREFS, ...(row ?? {}) } as Prefs
}
