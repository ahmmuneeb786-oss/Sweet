import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Verifies Telegram's initData signature using the bot token.
// This is the actual security check — without it, anyone could fabricate
// a fake initData string claiming to be any Telegram user.
async function verifyTelegramInitData(initData: string, botToken: string): Promise<Record<string, string> | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const encoder = new TextEncoder();
  const secretKey = await crypto.subtle.importKey(
    'raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const secretBytes = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(botToken));

  const signingKey = await crypto.subtle.importKey(
    'raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signatureBytes = await crypto.subtle.sign('HMAC', signingKey, encoder.encode(dataCheckString));
  const computedHash = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, '0')).join('');

  if (computedHash !== hash) return null;

  // Reject stale initData — Telegram issues a fresh one each time the Mini
  // App opens, so anything older than an hour suggests a replayed/leaked value.
  const authDate = parseInt(params.get('auth_date') || '0', 10);
  if (Date.now() / 1000 - authDate > 3600) return null;

  const userJson = params.get('user');
  return userJson ? JSON.parse(userJson) : null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { initData } = await req.json();
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')!;

    const tgUser = await verifyTelegramInitData(initData, botToken);
    if (!tgUser?.id) {
      return new Response(JSON.stringify({ error: 'Invalid Telegram data' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const telegramId = tgUser.id;
    const displayName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
    const syntheticEmail = `tg_${telegramId}@telegram.sweetchat.internal`;

    // Look up an existing account first
    const { data: existingProfile, error: lookupError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('telegram_id', telegramId)
      .maybeSingle();
    if (lookupError) throw lookupError;

    let authUserId: string;

    if (existingProfile) {
      authUserId = existingProfile.id;
    } else {
      // Brand new Telegram user — create the auth account + profile row.
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: syntheticEmail,
        email_confirm: true,
        user_metadata: { telegram_id: telegramId, source: 'telegram' },
      });
      if (createError || !newUser.user) throw createError || new Error('Failed to create user');

      authUserId = newUser.user.id;

      // If Telegram has a username for this person, claim it straight away
      // (lowercased, since our own usernames are case-insensitive) as long as
      // nobody else in Sweet already has it. Otherwise leave it null — the
      // client routes anyone with a null username to a mandatory picker
      // before letting them into the dashboard. Never invent one ourselves.
      let claimedUsername: string | null = null;
      const tgUsername = tgUser.username?.toLowerCase();
      if (tgUsername && /^[a-z0-9_-]+$/.test(tgUsername)) {
        const { data: usernameTaken } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('username', tgUsername)
          .maybeSingle();
        if (!usernameTaken) claimedUsername = tgUsername;
      }

      const { error: profileError } = await supabaseAdmin.from('profiles').insert({
        id: authUserId,
        username: claimedUsername,
        display_name: displayName || 'Sweet User',
        bio: '',
        is_online: true,
        telegram_id: telegramId,
        is_telegram_user: true,
        telegram_username: tgUser.username || null,
      });
      if (profileError) {
        // Roll back the orphaned auth user so a retry doesn't collide with
        // this synthetic email on the next attempt.
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
        throw profileError;
      }

      const { error: privacyError } = await supabaseAdmin
        .from('privacy_settings')
        .insert({ user_id: authUserId });
      if (privacyError) {
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
        throw privacyError;
      }
    }

    // Issue a one-time magic-link token — the client exchanges this for a
    // real session via verifyOtp. Avoids ever handling/exposing passwords.
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: syntheticEmail,
    });
    if (linkError) throw linkError;

    return new Response(
      JSON.stringify({
        email: syntheticEmail,
        token_hash: linkData.properties.hashed_token,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: 'Authentication failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});