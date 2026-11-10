/*
  Part 2: make chat media private.

  ⚠ Deploy the app version that uses signed media URLs (src/lib/signedMedia.ts)
    BEFORE applying this — older app versions load media from public URLs,
    which stop working once these buckets are private.

  After this, a photo / video / voice note / document can only be downloaded
  by its uploader or by a current member of a chat that has a (not deleted)
  message pointing at it — via a short-lived signed URL. Plain URLs no longer
  work for anyone. Avatars stay public (profile pictures, random file names).
*/

BEGIN;

-- Fast lookup from a storage file to the message(s) that reference it.
CREATE INDEX IF NOT EXISTS messages_media_url_idx ON public.messages (media_url) WHERE media_url IS NOT NULL;

CREATE OR REPLACE FUNCTION public.can_read_chat_file(p_bucket text, p_name text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM messages m
    JOIN chat_participants p ON p.chat_id = m.chat_id
    WHERE m.media_url = 'https://ptezdlwwnjrsqomsspgi.supabase.co/storage/v1/object/public/' || p_bucket || '/' || p_name
      AND m.is_deleted IS NOT TRUE
      AND p.user_id = auth.uid()
      AND p.left_at IS NULL
  );
$$;
REVOKE EXECUTE ON FUNCTION public.can_read_chat_file(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_read_chat_file(text, text) TO authenticated;

CREATE POLICY "sweet: chat members read chat files" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id IN ('chat-media', 'chat-docs', 'voice-notes')
    AND public.can_read_chat_file(bucket_id, name)
  );

UPDATE storage.buckets SET public = false
WHERE id IN ('chat-media', 'chat-docs', 'voice-notes', 'message-media');

COMMIT;
