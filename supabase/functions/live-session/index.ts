import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toUnit(bytes: Uint8Array, offset: number): number {
  const n = ((bytes[offset] << 24) >>> 0) +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3];
  return n / 0x1_0000_0000;
}

async function jitterPoint(lat: number, lng: number, stableKey: string, secret: string) {
  if (secret.length < 32) throw new Error("JITTER_HMAC_SECRET must be at least 32 characters");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(stableKey),
  ));

  const u1 = toUnit(digest, 0);
  const u2 = toUnit(digest, 4);
  const bearing = 2 * Math.PI * u1;
  const distanceMeters = 500 * Math.sqrt(u2); // uniform over disk; never > 500 m

  const earthRadius = 6371008.8;
  const angularDistance = distanceMeters / earthRadius;
  const lat1 = lat * Math.PI / 180;
  const lon1 = lng * Math.PI / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );

  return {
    lat: lat2 * 180 / Math.PI,
    lng: ((lon2 * 180 / Math.PI + 540) % 360) - 180,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ error: "Bearer token required" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const jitterSecret = Deno.env.get("JITTER_HMAC_SECRET");
    if (!supabaseUrl || !anonKey || !serviceKey || !jitterSecret) {
      return json({ error: "Server configuration is incomplete" }, 500);
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);
    const user = authData.user;

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const body = await req.json();
    const action = body?.action;

    if (action === "start") {
      const { lat, lng, pin_id, room_id = null } = body;
      if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
          typeof lng !== "number" || !Number.isFinite(lng) || lng < -180 || lng > 180 ||
          !isUuid(pin_id) || (room_id !== null && !isUuid(room_id))) {
        return json({ error: "Valid lat, lng, pin_id and optional room_id are required" }, 400);
      }

      const sessionId = crypto.randomUUID();
      const stableKey = user.id + ":" + pin_id;
      const publicPoint = await jitterPoint(lat, lng, stableKey, jitterSecret);

      const { error: rawError } = await admin
        .from("live_session_locations_private")
        .insert({
          session_id: sessionId,
          user_id: user.id,
          pin_id,
          lat,
          lng,
        });
      if (rawError) return json({ error: "Could not store private coordinates" }, 500);

      const { data: session, error: sessionError } = await admin
        .from("live_sessions")
        .insert({
          id: sessionId,
          user_id: user.id,
          pin_id,
          room_id,
          lat: publicPoint.lat,
          lng: publicPoint.lng,
        })
        .select("id, slot_no, started_at")
        .single();

      if (sessionError) {
        await admin.from("live_session_locations_private").delete().eq("session_id", sessionId);
        const status = sessionError.code === "P0001" ? 409 : 500;
        return json({ error: sessionError.message }, status);
      }
      return json({ session });
    }

    if (action === "heartbeat" || action === "end") {
      if (!isUuid(body?.session_id)) return json({ error: "Valid session_id required" }, 400);
      const update = action === "end"
        ? { ended_at: new Date().toISOString() }
        : { last_seen_at: new Date().toISOString() };

      const { data, error } = await admin
        .from("live_sessions")
        .update(update)
        .eq("id", body.session_id)
        .eq("user_id", user.id)
        .is("ended_at", null)
        .select("id, slot_no, last_seen_at, ended_at")
        .maybeSingle();

      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "Active session not found" }, 404);
      return json({ session: data });
    }

    if (action === "my_raw_location") {
      if (!isUuid(body?.session_id)) return json({ error: "Valid session_id required" }, 400);
      const { data, error } = await admin
        .from("live_session_locations_private")
        .select("session_id, lat, lng, created_at")
        .eq("session_id", body.session_id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "Private location not found" }, 404);
      return json({ location: data });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
