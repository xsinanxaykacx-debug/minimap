import { createClient } from '@supabase/supabase-js';

const LIVE_URL = (import.meta.env.VITE_SUPABASE_URL_LAB as string | undefined)?.trim();
const LIVE_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY_LAB as string | undefined)?.trim();

export const isLiveConfigured = Boolean(
  LIVE_URL && LIVE_KEY &&
  !LIVE_URL.includes('YOUR-PROJECT') &&
  !LIVE_KEY.includes('YOUR_')
);

const noCacheFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: 'no-store' });

export const liveSupabase = isLiveConfigured
  ? createClient(LIVE_URL!, LIVE_KEY!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 10 } },
      global: { fetch: noCacheFetch },
    })
  : null;

const turnUrls = (import.meta.env.VITE_TURN_URLS as string | undefined)
  ?.split(',')
  .map((url) => url.trim())
  .filter(Boolean) ?? [];
const turnUsername = (import.meta.env.VITE_TURN_USERNAME as string | undefined)?.trim();
const turnCredential = (import.meta.env.VITE_TURN_CREDENTIAL as string | undefined)?.trim();

export const TURN_CONFIGURED = Boolean(turnUrls.length && turnUsername && turnCredential);
export const FORCE_TURN_RELAY =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('turnTest') === '1';

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  ...(TURN_CONFIGURED
    ? [{ urls: turnUrls, username: turnUsername!, credential: turnCredential! } as RTCIceServer]
    : []),
];

export const ICE_TRANSPORT_POLICY: RTCIceTransportPolicy =
  FORCE_TURN_RELAY ? 'relay' : 'all';

export const ICE_CONFIGURATION: RTCConfiguration = {
  iceServers: ICE_SERVERS,
  iceCandidatePoolSize: 4,
  iceTransportPolicy: ICE_TRANSPORT_POLICY,
};
