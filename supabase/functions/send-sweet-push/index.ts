import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import webpush from "https://esm.sh/web-push@3.6.6"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { record } = await req.json()
    const { sender_id, receiver_id, content } = record

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const [receiverData, senderData] = await Promise.all([
      supabaseAdmin.from('profiles').select('push_subscription').eq('id', receiver_id).single(),
      supabaseAdmin.from('profiles').select('display_name').eq('id', sender_id).single()
    ])

    const subscriptionRaw = receiverData.data?.push_subscription
    const senderName = senderData.data?.display_name || "Someone special"

    if (!subscriptionRaw) {
      return new Response(JSON.stringify({ success: false, message: "No subscription registered." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200
      })
    }

    const subscription = JSON.parse(subscriptionRaw)

    webpush.setVapidDetails(
      'mailto:your-email@example.com',
      Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
      Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
    )

    const pushPayload = JSON.stringify({
      title: `${senderName} 🍬`,
      body: content || "Sent you a sweet media attachment! 💕",
      data: { url: '/dashboard' }
    })

    await webpush.sendNotification(subscription, pushPayload)

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    })
  }
})