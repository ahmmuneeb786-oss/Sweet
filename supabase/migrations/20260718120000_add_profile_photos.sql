/*
  # Add profile_photos table — multiple profile pictures per user

  ## Overview
  Adds Telegram-style support for multiple profile photos. `profiles.avatar_url`
  keeps holding the current/most-recent photo (updated on every upload, same as
  before), so every existing read site (chat headers, friend lists, message
  avatars, etc.) keeps working completely unchanged. `profile_photos` holds the
  full browsable gallery for the new multi-photo viewer.

  ## Security
  - RLS enabled: any authenticated user can view any user's photos, matching
    how profiles.avatar_url is already publicly viewable today.
  - Only the owning user can insert/delete their own photos.
*/

CREATE TABLE IF NOT EXISTS profile_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  url text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_photos_user ON profile_photos(user_id, created_at DESC);

ALTER TABLE profile_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view profile photos"
  ON profile_photos FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert own profile photos"
  ON profile_photos FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own profile photos"
  ON profile_photos FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
