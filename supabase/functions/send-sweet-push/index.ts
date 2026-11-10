import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import webpush from "https://esm.sh/web-push@3.6.6"

/*
  Sends a web-push notification for a new chat message.

  Called ONLY by the database (trigger `notify_push_on_message`), which sends
  just the new message's id plus a shared secret header. Everything else —
  who sent it, who should be notified, what it says — is loaded here from the
  database, so a caller can't make us push arbitrary text to arbitrary users.

  Deploy with:  npx supabase functions deploy send-sweet-push --no-verify-jwt
  (the shared secret below replaces JWT verification for this server-to-server call)
  Needs secrets: PUSH_WEBHOOK_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
*/

// Prefer the new-style secret key (sb_secret_…) so the legacy JWT keys can be
// disabled. Supabase provides it to functions as SUPABASE_SECRET_KEYS (JSON);
// SWEET_SERVICE_KEY can override it; the legacy key is only a last resort.
function adminKey(): { key: string; kind: "override" | "secret" | "legacy" } {
  const override = Deno.env.get("SWEET_SERVICE_KEY")
  if (override) return { key: override, kind: "override" }
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "")
    const k = keys?.default ?? Object.values(keys ?? {})[0]
    if (typeof k === "string" && k) return { key: k, kind: "secret" }
  } catch {
    // not set / not JSON — fall through
  }
  return { key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", kind: "legacy" }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const PREVIEW_BY_TYPE: Record<string, string> = {
  image: "📷 Photo",
  gif: "GIF",
  video: "🎥 Video",
  video_note: "🎥 Video message",
  voice: "🎤 Voice message",
  file: "📄 Document",
  doc: "📄 Document",
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const expected = Deno.env.get("PUSH_WEBHOOK_SECRET") ?? ""
  const provided = req.headers.get("x-push-secret") ?? ""
  if (!expected || !safeEqual(provided, expected)) return json({ error: "Unauthorized" }, 401)

  try {
    const { message_id } = await req.json()
    if (typeof message_id !== "string" || !message_id) return json({ error: "message_id required" }, 400)

    const { key, kind: keyKind } = adminKey()
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: message, error: loadError } = await admin
      .from("messages")
      .select("id, chat_id, sender_id, type, content, is_deleted")
      .eq("id", message_id)
      .maybeSingle()
    // key_kind is reported (never the key itself) so we can confirm which key is in use.
    if (loadError) return json({ error: "Could not load message", key_kind: keyKind }, 500)
    if (!message || message.is_deleted) return json({ success: true, sent: 0, key_kind: keyKind })

    const now = Date.now()
    const { data: participants } = await admin
      .from("chat_participants")
      .select("user_id, is_locked, is_muted, muted_until")
      .eq("chat_id", message.chat_id)
      .neq("user_id", message.sender_id)
      .is("left_at", null)

    const recipients = (participants ?? []).filter((p) => {
      if (!p.is_muted) return true
      // muted with no end date = muted forever; otherwise muted until then
      return p.muted_until ? new Date(p.muted_until).getTime() <= now : false
    })
    if (recipients.length === 0) return json({ success: true, sent: 0, key_kind: keyKind })

    const [{ data: subs }, { data: sender }] = await Promise.all([
      admin.from("push_subscriptions").select("user_id, subscription").in("user_id", recipients.map((p) => p.user_id)),
      admin.from("profiles").select("display_name").eq("id", message.sender_id).maybeSingle(),
    ])
    if (!subs || subs.length === 0) return json({ success: true, sent: 0, key_kind: keyKind })

    webpush.setVapidDetails(
      "mailto:noreply@sweetchat.app",
      Deno.env.get("VAPID_PUBLIC_KEY") ?? "",
      Deno.env.get("VAPID_PRIVATE_KEY") ?? ""
    )

    const senderName = sender?.display_name || "Someone special"
    const lockedFor = new Set(recipients.filter((p) => p.is_locked).map((p) => p.user_id))
    const preview = message.type && message.type !== "text"
      ? PREVIEW_BY_TYPE[message.type] ?? "Sent you something 💕"
      : (message.content || "").slice(0, 200)

    let sent = 0
    await Promise.all(subs.map(async (s) => {
      // Locked (vault) chats: never put the sender or text on the lock screen.
      const payload = lockedFor.has(s.user_id)
        ? { title: "Sweet 🍬", body: "You have a new message 💕", data: { url: "/dashboard" } }
        : { title: `${senderName} 🍬`, body: preview, data: { url: "/dashboard" } }
      try {
        await webpush.sendNotification(JSON.parse(s.subscription), JSON.stringify(payload))
        sent++
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode
        // The browser revoked this subscription — forget it.
        if (code === 404 || code === 410) {
          await admin.from("push_subscriptions").delete().eq("user_id", s.user_id)
        } else {
          console.error("push failed", code)
        }
      }
    }))

    return json({ success: true, sent, key_kind: keyKind })
  } catch (error) {
    console.error(error)
    return json({ error: "Push failed" }, 500)
  }
})
