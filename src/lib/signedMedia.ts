import { supabase, supabaseUrl } from './supabase';

/**
 * Chat media (photos, videos, voice notes, documents) lives in PRIVATE
 * storage buckets: only members of the chat a file was sent in can read it.
 *
 * Messages still store the file's plain storage URL
 * (`<project>/storage/v1/object/public/<bucket>/<path>`) — it's a stable id
 * that's also used as the key for the on-device media cache. Before a file is
 * actually downloaded, that URL is swapped for a short-lived signed URL here.
 *
 * Anything else (GIFs from Giphy, avatars, data:/blob: previews) is returned
 * unchanged.
 */

const PRIVATE_BUCKETS = new Set(['chat-media', 'chat-docs', 'voice-notes']);
const PUBLIC_PREFIX = `${supabaseUrl}/storage/v1/object/public/`;
const SIGNED_TTL_SECONDS = 60 * 60; // 1 hour
const REUSE_FOR_MS = 50 * 60 * 1000; // re-sign 10 min before expiry

const signed = new Map<string, { url: string; at: number }>();
const inflight = new Map<string, Promise<string>>();

function parsePrivateStorageUrl(url: string): { bucket: string; path: string } | null {
  if (!url || !url.startsWith(PUBLIC_PREFIX)) return null;
  const rest = url.slice(PUBLIC_PREFIX.length).split('?')[0];
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const bucket = rest.slice(0, slash);
  if (!PRIVATE_BUCKETS.has(bucket)) return null;
  let path = rest.slice(slash + 1);
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep as-is
  }
  return { bucket, path };
}

/** True for URLs that need signing before they can be downloaded. */
export function isPrivateMediaUrl(url: string | null | undefined): boolean {
  return !!url && parsePrivateStorageUrl(url) !== null;
}

/**
 * A URL the browser can download right now. For private chat media that's a
 * fresh signed URL (cached ~50 min); everything else comes back unchanged.
 * Falls back to the original URL if signing fails (e.g. offline).
 */
export function resolveMediaUrl(url: string): Promise<string> {
  const parsed = parsePrivateStorageUrl(url);
  if (!parsed) return Promise.resolve(url);

  const hit = signed.get(url);
  if (hit && Date.now() - hit.at < REUSE_FOR_MS) return Promise.resolve(hit.url);

  let pending = inflight.get(url);
  if (!pending) {
    pending = supabase.storage
      .from(parsed.bucket)
      .createSignedUrl(parsed.path, SIGNED_TTL_SECONDS)
      .then(({ data, error }) => {
        if (error || !data?.signedUrl) return url;
        signed.set(url, { url: data.signedUrl, at: Date.now() });
        return data.signedUrl;
      })
      .catch(() => url)
      .finally(() => inflight.delete(url));
    inflight.set(url, pending);
  }
  return pending;
}

/**
 * Open a (possibly private) media URL in a new tab. The tab is opened
 * synchronously inside the click so popup blockers allow it, then pointed at
 * the signed URL once it's ready.
 */
export function openMediaInNewTab(url: string) {
  if (!isPrivateMediaUrl(url)) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  const tab = window.open('', '_blank');
  resolveMediaUrl(url).then((resolved) => {
    if (tab) tab.location.href = resolved;
    else window.open(resolved, '_blank', 'noopener');
  });
}
