/// <reference lib="webworker" />
/*
  Sweet's service worker. Built by vite-plugin-pwa (strategies: injectManifest),
  so the offline cache AND the push handlers ship in the same file.

  Why this file exists: with the old `generateSW` setup the plugin wrote its
  own dist/sw.js over public/sw.js, so the deployed worker had no `push`
  handler and background notifications were silently dropped.

  Push payload (sent by supabase/functions/send-sweet-push). Every field is
  optional so an older server payload still shows something sensible:
    { title, body, tag, url, chatId, kind, vibrate: number[], testId, sentAt }
*/
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';
import type { PrecacheEntry } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<PrecacheEntry | string> };

// ---- Offline app shell (same behaviour the old generateSW config had) ----
self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
// The manifest reference must stay in the source (the build injects the file
// list there). In dev the list is near-empty and Vite serves fresh files, so
// the offline shell is production-only; push works in both.
const precacheList = self.__WB_MANIFEST;
if (import.meta.env.PROD) {
  precacheAndRoute(precacheList);
  registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));
}

// face-api is only needed by face-lock users: cached on first use instead of
// precached. Hashed filename, so a cached copy never goes stale.
registerRoute(
  ({ url }) => /\/assets\/face-api-[^/]+\.js$/.test(url.pathname),
  new CacheFirst({ cacheName: 'face-api-lib', plugins: [new ExpirationPlugin({ maxEntries: 2 })] })
);
registerRoute(
  ({ url }) => url.pathname.startsWith('/models/'),
  new CacheFirst({
    cacheName: 'face-models',
    plugins: [new ExpirationPlugin({ maxEntries: 20 }), new CacheableResponsePlugin({ statuses: [200] })],
  })
);

// ---- Push ----------------------------------------------------------------
interface SweetPush {
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
  chatId?: string;
  kind?: 'message' | 'friend' | 'digest' | 'theme' | 'test';
  vibrate?: number[];
  testId?: string;
  sentAt?: number;
  data?: { url?: string }; // legacy shape
}

function readPayload(event: PushEvent): SweetPush {
  if (!event.data) return {};
  try {
    return event.data.json() as SweetPush;
  } catch {
    return { body: event.data.text() };
  }
}

// Vibration patterns come from the user's own Heartbeat Tap. Keep them sane
// (numbers only, short) so a bad value can't buzz a phone for a minute.
function safeVibrate(v: unknown): number[] {
  if (!Array.isArray(v)) return [100, 50, 100];
  const out = v.filter((n): n is number => typeof n === 'number' && n >= 0).map((n) => Math.min(n, 1000)).slice(0, 24);
  const total = out.reduce((a, b) => a + b, 0);
  return out.length && total <= 6000 ? out : [100, 50, 100];
}

async function tellClients(message: unknown) {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  list.forEach((c) => c.postMessage(message));
}

self.addEventListener('push', (event) => {
  const p = readPayload(event);
  const url = p.url || p.data?.url || '/';
  const title = p.title || 'Sweet 🍬';
  const options: NotificationOptions & { vibrate?: number[]; renotify?: boolean } = {
    body: p.body || 'Something sweet arrived',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: safeVibrate(p.vibrate),
    // One notification per chat (or per kind), so a message from one person
    // no longer replaces another person's notification.
    tag: p.tag || (p.chatId ? `chat-${p.chatId}` : `sweet-${p.kind || 'msg'}`),
    renotify: true,
    data: { url, chatId: p.chatId ?? null, kind: p.kind ?? 'message' },
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      // Sweet Pulse: tell an open Settings tab that the test candy landed.
      if (p.kind === 'test' && p.testId) {
        await tellClients({ type: 'sweet:test-landed', testId: p.testId, sentAt: p.sentAt ?? null });
      }
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = (event.notification.data || {}) as { url?: string; chatId?: string | null; kind?: string };
  const target = new URL(data.url || '/', self.location.origin).href;

  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Any open Sweet window will do — focus it and let the app open the
      // chat itself (comparing exact URLs never matched before).
      const existing = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        if (data.chatId) existing.postMessage({ type: 'sweet:open-chat', chatId: data.chatId });
        else if (data.kind === 'friend') existing.postMessage({ type: 'sweet:open-friends' });
        return;
      }
      await self.clients.openWindow(target);
    })()
  );
});

// The browser rotated or dropped the push subscription (e.g. after clearing
// site data). Ask an open app to re-register it; Sweet Pulse also repairs
// this the next time the app starts.
self.addEventListener('pushsubscriptionchange', (event) => {
  (event as ExtendableEvent).waitUntil(tellClients({ type: 'sweet:resubscribe' }));
});
