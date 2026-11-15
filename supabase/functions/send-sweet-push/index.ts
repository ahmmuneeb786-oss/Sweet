import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import webpush from "https://esm.sh/web-push@3.6.6"
import {
  categoryFor, digestPayload, friendRequestPayload, isValidVibration, mergePrefs, messagePayload,
  testPayload, vibrationFor, type JarItem, type JarKind, type Prefs, type PushPayload,
} from "./logic.ts"

/*
  Sweet's push sender. Four ways in:

    { message_id }                          ← DB trigger notify_push_on_message   (x-push-secret)
    { action: "friend_request", request_id } ← DB trigger notify_push_on_friend_request (x-push-secret)
    { action: "digest" }                    ← pg_cron via trigger_jar_digests()   (x-push-secret)
    { action: "test", testId, endpoint, vibrate? } ← the app's "Send me a test candy"
                                              (signed-in user's JWT; only to their own device)

  Server-to-server calls send ids only; who gets notified and what it says is
  always loaded here from the database, so a caller can't push arbitrary text
  to arbitrary users. What a notification SAYS is decided in logic.ts.

  Deploy with:  npx supabase functions deploy send-sweet-push --no-verify-jwt
  (the shared secret replaces JWT verification for server calls; the test
  action checks the user's JWT itself)
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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } })

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function vapidReady(): boolean {
  const pub = Deno.env.get("VAPID_PUBLIC_KEY") ?? ""
  const priv = Deno.env.get("VAPID_PRIVATE_KEY") ?? ""
  if (!pub || !priv) return false
  webpush.setVapidDetails("mailto:noreply@sweetchat.app", pub, priv)
  return true
}

interface Sub { id: string; user_id: string; subscription: string; fail_count: number }
type SendResult = { ok: true } | { ok: false; status?: number; expired: boolean }

/**
 * Sends to ONE device and keeps the device list healthy: a subscription the
 * browser revoked (404/410) is deleted by its own id — never by user, which
 * used to wipe the user's other, working devices too.
 */
async function sendTo(admin: SupabaseClient, sub: Sub, payload: PushPayload): Promise<SendResult> {
  try {
    await webpush.sendNotification(JSON.parse(sub.subscription), JSON.stringify(payload), {
      TTL: payload.kind === "test" ? 60 : 60 * 60 * 24,
      urgency: payload.kind === "digest" ? "normal" : "high",
    })
    await admin.from("push_subscriptions")
      .update({ last_push_at: new Date().toISOString(), fail_count: 0 })
      .eq("id", sub.id)
    return { ok: true }
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode
    if (status === 404 || status === 410) {
      await admin.from("push_subscriptions").delete().eq("id", sub.id)
      return { ok: false, status, expired: true }
    }
    console.error("push failed", status)
    await admin.from("push_subscriptions").update({ fail_count: (sub.fail_count ?? 0) + 1 }).eq("id", sub.id)
    return { ok: false, status, expired: false }
  }
}

async function loadSubs(admin: SupabaseClient, userIds: string[]): Promise<Map<string, Sub[]>> {
  const byUser = new Map<string, Sub[]>()
  if (userIds.length === 0) return byUser
  const { data } = await admin.from("push_subscriptions")
    .select("id, user_id, subscription, fail_count")
    .in("user_id", userIds)
  for (const s of (data ?? []) as Sub[]) {
    const list = byUser.get(s.user_id) ?? []
    list.push(s)
    byUser.set(s.user_id, list)
  }
  return byUser
}

async function loadPrefs(admin: SupabaseClient, userIds: string[]): Promise<Map<string, Prefs>> {
  const map = new Map<string, Prefs>()
  if (userIds.length === 0) return map
  const { data } = await admin.from("notification_prefs").select("*").in("user_id", userIds)
  for (const row of data ?? []) map.set(row.user_id, mergePrefs(row))
  return map
}

async function loadNames(admin: SupabaseClient, ids: string[]): Promise<Record<string, string>> {
  const names: Record<string, string> = {}
  if (ids.length === 0) return names
  const { data } = await admin.from("profiles").select("id, display_name, username").in("id", ids)
  for (const p of data ?? []) names[p.id] = p.display_name || p.username || "Someone special"
  return names
}

/** The Bedtime Jar this message should wait in, or null to push now. */
async function quietJar(admin: SupabaseClient, userId: string, senderId: string): Promise<string | null> {
  const { data, error } = await admin.rpc("active_quiet_jar", { p_user: userId, p_sender: senderId })
  if (error) {
    console.error("jar check failed", error.message)
    return null // never lose a notification because the jar check broke
  }
  return (data as string | null) ?? null
}

async function sendToUsers(admin: SupabaseClient, jobs: { userId: string; payload: PushPayload }[]) {
  const subs = await loadSubs(admin, [...new Set(jobs.map((j) => j.userId))])
  let sent = 0
  await Promise.all(jobs.flatMap((job) =>
    (subs.get(job.userId) ?? []).map(async (s) => {
      if ((await sendTo(admin, s, job.payload)).ok) sent++
    })
  ))
  return sent
}

// ---- { message_id } ---------------------------------------------------------
async function handleMessage(admin: SupabaseClient, messageId: string) {
  const { data: message, error } = await admin
    .from("messages")
    .select("id, chat_id, sender_id, type, content, is_deleted")
    .eq("id", messageId)
    .maybeSingle()
  if (error) return json({ error: "Could not load message" }, 500)
  if (!message || message.is_deleted) return json({ success: true, sent: 0 })

  const now = Date.now()
  const { data: participants } = await admin
    .from("chat_participants")
    .select("user_id, is_locked, is_muted, muted_until")
    .eq("chat_id", message.chat_id)
    .neq("user_id", message.sender_id)
    .is("left_at", null)

  // muted with no end date = muted forever; otherwise muted until then
  const unmuted = (participants ?? []).filter((p) =>
    !p.is_muted || (p.muted_until ? new Date(p.muted_until).getTime() <= now : false)
  )
  if (unmuted.length === 0) return json({ success: true, sent: 0 })

  const prefs = await loadPrefs(admin, unmuted.map((p) => p.user_id))
  const category = categoryFor(message.type)
  const wanted = unmuted.filter((p) => (prefs.get(p.user_id) ?? mergePrefs(null))[category])

  // Bedtime Jars: hold (and count) instead of pushing.
  let jarred = 0
  const live: typeof wanted = []
  await Promise.all(wanted.map(async (p) => {
    const jar = await quietJar(admin, p.user_id, message.sender_id)
    if (!jar) return void live.push(p)
    const { error: addError } = await admin.rpc("jar_add_item", {
      p_jar: jar, p_sender: message.sender_id, p_locked: !!p.is_locked,
    })
    if (addError) {
      console.error("jar add failed", addError.message)
      live.push(p) // couldn't hold it — better to notify than to lose it
    } else {
      jarred++
    }
  }))
  if (live.length === 0) return json({ success: true, sent: 0, jarred })

  const names = await loadNames(admin, [message.sender_id])
  const senderName = names[message.sender_id] || "Someone special"
  const sent = await sendToUsers(admin, live.map((p) => {
    const pr = prefs.get(p.user_id) ?? mergePrefs(null)
    return {
      userId: p.user_id,
      payload: messagePayload({
        peek: pr.peek,
        locked: !!p.is_locked,
        senderName,
        chatId: message.chat_id,
        type: message.type,
        content: message.content,
        // A personal Heartbeat would give away who wrote from a locked chat.
        vibrate: vibrationFor(pr, p.is_locked ? null : message.sender_id),
      }),
    }
  }))
  return json({ success: true, sent, jarred })
}

// ---- { action: "friend_request" } ---------------------------------------------
async function handleFriendRequest(admin: SupabaseClient, requestId: string) {
  const { data: req } = await admin
    .from("friend_requests")
    .select("id, sender_id, receiver_id, status")
    .eq("id", requestId)
    .maybeSingle()
  if (!req || req.status !== "pending") return json({ success: true, sent: 0 })

  const pr = (await loadPrefs(admin, [req.receiver_id])).get(req.receiver_id) ?? mergePrefs(null)
  if (!pr.friend_requests) return json({ success: true, sent: 0 })
  // Quiet hours: friend requests just wait in the app (not counted in the jar).
  if (await quietJar(admin, req.receiver_id, req.sender_id)) return json({ success: true, sent: 0, quiet: true })

  const names = await loadNames(admin, [req.sender_id])
  const sent = await sendToUsers(admin, [{
    userId: req.receiver_id,
    payload: friendRequestPayload(pr.peek, names[req.sender_id] || "Someone special", vibrationFor(pr, req.sender_id)),
  }])
  return json({ success: true, sent })
}

// ---- { action: "digest" } -------------------------------------------------------
interface DueJar { jar_id: string; user_id: string; name: string; kind: JarKind; end_time: string; timezone: string; items: JarItem[] }

async function handleDigest(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("claim_due_jar_digests")
  if (error) return json({ error: "Could not claim digests" }, 500)
  const due = (data ?? []) as DueJar[]
  if (due.length === 0) return json({ success: true, sent: 0 })

  const [prefs, names] = await Promise.all([
    loadPrefs(admin, [...new Set(due.map((d) => d.user_id))]),
    loadNames(admin, [...new Set(due.flatMap((d) => d.items.filter((i) => !i.locked).map((i) => i.sender_id)))]),
  ])

  const jobs = due.flatMap((d) => {
    const pr = prefs.get(d.user_id) ?? mergePrefs(null)
    const payload = digestPayload({
      jarName: d.name, kind: d.kind, endTime: d.end_time, items: d.items, names,
      peek: pr.peek, vibrate: vibrationFor(pr, null),
    })
    return payload ? [{ userId: d.user_id, payload }] : []
  })
  const sent = await sendToUsers(admin, jobs)
  return json({ success: true, sent, jars: due.length })
}

// ---- { action: "test" } — Sweet Pulse -----------------------------------------------
// Always answers 200 with { ok, step, reason } so the app can show which
// step of the pipeline failed instead of a generic error.
async function handleTest(admin: SupabaseClient, req: Request, body: Record<string, unknown>) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
  const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } }
  const user = auth?.user
  if (!user) return json({ ok: false, step: "account", reason: "signed_out" }, 401)

  const testId = typeof body.testId === "string" ? body.testId.slice(0, 64) : ""
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : ""
  if (!testId || !endpoint) return json({ ok: false, step: "device", reason: "bad_request" }, 400)

  const { data: sub } = await admin.from("push_subscriptions")
    .select("id, user_id, subscription, fail_count")
    .eq("endpoint", endpoint)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!sub) return json({ ok: false, step: "device", reason: "not_registered" })

  if (!vapidReady()) return json({ ok: false, step: "server", reason: "not_configured" })

  const pr = (await loadPrefs(admin, [user.id])).get(user.id) ?? mergePrefs(null)
  // Heartbeat Tap can send a pattern to "feel it on your lock screen".
  const vibrate = isValidVibration(body.vibrate) ? body.vibrate : vibrationFor(pr, null)
  const result = await sendTo(admin, sub as Sub, testPayload(testId, vibrate))
  if (result.ok) return json({ ok: true, step: "sent" })
  return json({ ok: false, step: "push", reason: result.expired ? "expired" : "rejected", status: result.status ?? null })
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: "Invalid JSON" }, 400)
  }

  const { key } = adminKey()
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    if (body.action === "test") return await handleTest(admin, req, body)

    // Everything else comes from the database and must carry the shared secret.
    const expected = Deno.env.get("PUSH_WEBHOOK_SECRET") ?? ""
    const provided = req.headers.get("x-push-secret") ?? ""
    if (!expected || !safeEqual(provided, expected)) return json({ error: "Unauthorized" }, 401)
    if (!vapidReady()) return json({ error: "VAPID keys missing" }, 500)

    if (body.action === "digest") return await handleDigest(admin)
    if (body.action === "friend_request") {
      if (typeof body.request_id !== "string" || !body.request_id) return json({ error: "request_id required" }, 400)
      return await handleFriendRequest(admin, body.request_id)
    }
    if (typeof body.message_id !== "string" || !body.message_id) return json({ error: "message_id required" }, 400)
    return await handleMessage(admin, body.message_id)
  } catch (error) {
    console.error(error)
    return json({ error: "Push failed" }, 500)
  }
})
