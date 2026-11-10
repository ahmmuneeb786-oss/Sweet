/*
  Merge split "Saved Messages" chats into the single canonical `self-<uid>` chat.

  Live data (checked 2026-11-10) had:
    - stray `<uid>` chats named 'Saved Messages' with no participants, created
      by an old ChatWindow branch (one of them holds 1 message);
    - 7 profiles with no `self-<uid>` chat at all;
    - leftovers for a deleted account (eafe3a4a…) that's no longer in auth.users.
*/

BEGIN;

-- 1. Canonical self chat + participant row for every profile.
INSERT INTO chats (id, type, name, created_by)
SELECT 'self-' || p.id, 'direct', 'Saved Messages', p.id
FROM profiles p
ON CONFLICT (id) DO NOTHING;

INSERT INTO chat_participants (chat_id, user_id, role)
SELECT 'self-' || p.id, p.id, 'admin'
FROM profiles p
ON CONFLICT (chat_id, user_id) DO NOTHING;

-- 2. Move messages out of stray self chats (`<uid>` / `<uid>_self-<uid>`).
UPDATE messages m
SET chat_id = 'self-' || p.id
FROM profiles p
WHERE m.chat_id IN (p.id::text, p.id::text || '_self-' || p.id::text);

-- 3. Delete the stray self chats (now empty).
DELETE FROM chats c
USING profiles p
WHERE c.id IN (p.id::text, p.id::text || '_self-' || p.id::text);

-- 4. Delete self chats / stray chats left behind by accounts that no longer exist.
DELETE FROM chats c
WHERE c.name = 'Saved Messages'
  AND NOT EXISTS (
    SELECT 1 FROM profiles p
    WHERE c.id IN ('self-' || p.id, p.id::text, p.id::text || '_self-' || p.id::text)
  );

COMMIT;
