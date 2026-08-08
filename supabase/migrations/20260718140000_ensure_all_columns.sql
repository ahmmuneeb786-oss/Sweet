/*
  # Ensure all expected columns exist (idempotent column reconciliation)

  ## Why
  The live database has drifted from the tracked schema over time — some
  columns the app writes to (e.g. messages.is_edited) don't exist yet, which
  makes those writes fail at runtime. This migration reconciles every table
  to the columns the app actually uses.

  ## How it's safe to run anytime
  Every statement is `ADD COLUMN IF NOT EXISTS` — Postgres adds the column
  only when it's missing and does nothing when it already exists. So running
  this against a database that already has some/all columns is a harmless
  no-op for those, and it never drops, renames, or retypes anything.

  Run the whole file in the Supabase SQL editor.
*/

-- ─── profiles ────────────────────────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio text DEFAULT '';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen timestamptz DEFAULT now();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_online boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
-- Drift: face lock, push, and per-chat vault security (used across App.tsx,
-- Settings.tsx, LockedChatsPanel.tsx, PermissionManager.ts).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS face_descriptor jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS face_lock_enabled boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_subscription text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS chat_security_type text DEFAULT 'none';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS chat_biometric_type text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS chat_pin text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS chat_password text;

-- ─── privacy_settings ────────────────────────────────────────────────────────
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS last_seen_visibility text DEFAULT 'everyone';
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS profile_photo_visibility text DEFAULT 'everyone';
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS who_can_add text DEFAULT 'everyone';
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE privacy_settings ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- ─── friend_requests ─────────────────────────────────────────────────────────
ALTER TABLE friend_requests ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';
ALTER TABLE friend_requests ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE friend_requests ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- ─── friends ─────────────────────────────────────────────────────────────────
ALTER TABLE friends ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- ─── blocked_users ───────────────────────────────────────────────────────────
ALTER TABLE blocked_users ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- ─── chats ───────────────────────────────────────────────────────────────────
ALTER TABLE chats ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS theme text DEFAULT 'default';
ALTER TABLE chats ADD COLUMN IF NOT EXISTS wallpaper text;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE chats ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- ─── chat_participants ───────────────────────────────────────────────────────
ALTER TABLE chat_participants ADD COLUMN IF NOT EXISTS role text DEFAULT 'member';
ALTER TABLE chat_participants ADD COLUMN IF NOT EXISTS is_muted boolean DEFAULT false;
ALTER TABLE chat_participants ADD COLUMN IF NOT EXISTS muted_until timestamptz;
ALTER TABLE chat_participants ADD COLUMN IF NOT EXISTS joined_at timestamptz DEFAULT now();
ALTER TABLE chat_participants ADD COLUMN IF NOT EXISTS left_at timestamptz;
-- Drift: which chats a user has moved into their locked vault (ChatList /
-- LockedChatsPanel filter on this).
ALTER TABLE chat_participants ADD COLUMN IF NOT EXISTS is_locked boolean DEFAULT false;

-- ─── messages (the one that was missing is_edited) ───────────────────────────
ALTER TABLE messages ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS type text DEFAULT 'text';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_url text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_thumbnail text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_size bigint;
-- Plain text (not uuid) + no FK: this DB's messages.id is text, and the app
-- resolves the parent message client-side, so no DB-level foreign key is needed.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_edited boolean DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_deleted boolean DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_for_everyone boolean DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_starred boolean DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_pinned boolean DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS disappear_at timestamptz;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_status text DEFAULT 'sent';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- ─── message_reactions ───────────────────────────────────────────────────────
ALTER TABLE message_reactions ADD COLUMN IF NOT EXISTS reaction text;
ALTER TABLE message_reactions ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- ─── locked_chats ────────────────────────────────────────────────────────────
ALTER TABLE locked_chats ADD COLUMN IF NOT EXISTS lock_type text;
ALTER TABLE locked_chats ADD COLUMN IF NOT EXISTS lock_value text;
ALTER TABLE locked_chats ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- ─── typing_indicators ───────────────────────────────────────────────────────
ALTER TABLE typing_indicators ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
