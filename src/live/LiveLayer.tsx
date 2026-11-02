import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl, { type Map as MapLibreMap, type Marker } from 'maplibre-gl'
import { createClient, type RealtimeChannel, type Session, type SupabaseClient } from '@supabase/supabase-js'

type LiveSession = {
  id: string
  user_id: string
  lat: number
  lng: number
  room_id: string
  started_at: string
}
type SignalMessage = {
  type: 'viewer-join' | 'offer' | 'answer' | 'ice' | 'viewer-left' | 'session-ended'
  from: string
  to?: string
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

const rtcConfig: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

async function sendSignal(channel: RealtimeChannel, payload: SignalMessage) {
  await channel.send({ type: 'broadcast', event: 'signal', payload })
}

export function useBroadcast(
  supabase: SupabaseClient | null,
  roomId: string | null,
  publisherId: string | null,
  stream: MediaStream | null,
) {
  const [status, setStatus] = useState('Yayın bağlantısı bekleniyor')
  useEffect(() => {
    if (!supabase || !roomId || !publisherId || !stream) return
    let disposed = false
    const peers = new Map<string, RTCPeerConnection>()
    const channel = supabase.channel(`room:${roomId}`, {
      config: { private: true, broadcast: { self: false, ack: true } },
    })
    const closePeer = (id: string) => {
      const peer = peers.get(id)
      if (peer) peer.close()
      peers.delete(id)
    }
    const createPeer = async (viewerId: string) => {
      if (disposed || peers.has(viewerId)) return
      const pc = new RTCPeerConnection(rtcConfig)
      peers.set(viewerId, pc)
      stream.getTracks().forEach(track => pc.addTrack(track, stream))
      pc.onicecandidate = event => {
        if (event.candidate) void sendSignal(channel, {
          type: 'ice', from: publisherId, to: viewerId, candidate: event.candidate.toJSON(),
        })
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') setStatus('YAYIN AKTİF · İZLEYİCİ BAĞLANDI')
        if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) closePeer(viewerId)
      }
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await sendSignal(channel, {
        type: 'offer', from: publisherId, to: viewerId, sdp: pc.localDescription ?? offer,
      })
    }

    channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
      const message = payload as SignalMessage
      if (!message || message.from === publisherId || (message.to && message.to !== publisherId)) return
      if (message.type === 'viewer-join') {
        void createPeer(message.from).catch(() => setStatus('İzleyici bağlantısı kurulamadı'))
      } else if (message.type === 'answer') {
        const pc = peers.get(message.from)
        if (pc && message.sdp) void pc.setRemoteDescription(message.sdp).catch(() => closePeer(message.from))
      } else if (message.type === 'ice') {
        const pc = peers.get(message.from)
        if (pc && message.candidate) void pc.addIceCandidate(message.candidate).catch(() => undefined)
      } else if (message.type === 'viewer-left') {
        closePeer(message.from)
      }
    })
    void channel.subscribe(state => {
      if (state === 'SUBSCRIBED') setStatus('CANLI · İZLEYİCİ BEKLENİYOR')
      if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') setStatus('Realtime signaling bağlantı hatası')
    })
    return () => {
      disposed = true
      peers.forEach(peer => peer.close())
      peers.clear()
      void supabase.removeChannel(channel)
    }
  }, [supabase, roomId, publisherId, stream])
  return { status }
}

export function useViewer(
  supabase: SupabaseClient | null,
  roomId: string | null,
  viewerId: string | null,
) {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [status, setStatus] = useState('Yayın bağlantısı bekleniyor')
  useEffect(() => {
    if (!supabase || !roomId || !viewerId) return
    let pc: RTCPeerConnection | null = null
    const channel = supabase.channel(`room:${roomId}`, {
      config: { private: true, broadcast: { self: false, ack: true } },
    })
    const send = (payload: SignalMessage) => sendSignal(channel, payload)
    channel.on('broadcast', { event: 'signal' }, async ({ payload }) => {
      const message = payload as SignalMessage
      if (!message || message.to !== viewerId) return
      if (message.type === 'offer' && message.sdp) {
        if (pc) pc.close()
        pc = new RTCPeerConnection(rtcConfig)
        pc.addTransceiver('video', { direction: 'recvonly' })
        pc.addTransceiver('audio', { direction: 'recvonly' })
        pc.ontrack = event => {
          const stream = event.streams[0] ?? new MediaStream([event.track])
          event.track.onended = () => setStatus('Yayın sona erdi')
          setRemoteStream(stream)
          setStatus('CANLI YAYIN')
        }
        pc.onicecandidate = event => {
          if (event.candidate) void send({
            type: 'ice', from: viewerId, to: message.from, candidate: event.candidate.toJSON(),
          })
        }
        pc.onconnectionstatechange = () => {
          if (pc?.connectionState === 'failed') setStatus('P2P bağlantısı kurulamadı')
        }
        await pc.setRemoteDescription(message.sdp)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await send({ type: 'answer', from: viewerId, to: message.from, sdp: pc.localDescription ?? answer })
      } else if (message.type === 'ice' && message.candidate && pc) {
        await pc.addIceCandidate(message.candidate).catch(() => undefined)
      } else if (message.type === 'session-ended') {
        setStatus('Yayın sona erdi')
        setRemoteStream(null)
        pc?.close()
      }
    })
    void channel.subscribe(async state => {
      if (state === 'SUBSCRIBED') {
        setStatus('Yayıncıya bağlanılıyor')
        await send({ type: 'viewer-join', from: viewerId })
      }
      if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') setStatus('Realtime signaling bağlantı hatası')
    })
    return () => {
      if (pc) pc.close()
      setRemoteStream(null)
      void send({ type: 'viewer-left', from: viewerId }).catch(() => undefined)
      void supabase.removeChannel(channel)
    }
  }, [supabase, roomId, viewerId])
  return { remoteStream, status }
}

function LiveLayer({ map }: { map: MapLibreMap | null }) {
  const supabase = useMemo(() => {
    const url = import.meta.env.VITE_SUPABASE_URL_LAB
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY_LAB
    return url && key ? createClient(url, key) : null
  }, [])
  const [authSession, setAuthSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [profileStatus, setProfileStatus] = useState('')
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [publisherSession, setPublisherSession] = useState<{ id: string; room_id: string } | null>(null)
  const [publisherStream, setPublisherStream] = useState<MediaStream | null>(null)
  const [viewerSession, setViewerSession] = useState<LiveSession | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const markersRef = useRef<Marker[]>([])
  const videoRef = useRef<HTMLVideoElement>(null)
  const publisher = useBroadcast(supabase, publisherSession?.room_id ?? null, authSession?.user.id ?? null, publisherStream)
  const viewer = useViewer(supabase, viewerSession?.room_id ?? null, authSession?.user.id ?? null)

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setAuthSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setAuthSession(session))
    return () => data.subscription.unsubscribe()
  }, [supabase])

  useEffect(() => {
    if (!supabase || !authSession) { setProfileStatus(''); return }
    let cancelled = false
    void supabase.from('profiles').select('status').eq('id', authSession.user.id).maybeSingle()
      .then(({ data, error }) => {
        if (!cancelled) setProfileStatus(error ? 'Üyelik durumu okunamadı' : data?.status ?? 'pending')
      })
    return () => { cancelled = true }
  }, [supabase, authSession])

  const refreshSessions = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase.from('live_sessions_public')
      .select('id,user_id,lat,lng,room_id,started_at')
    if (!error) setSessions((data ?? []) as LiveSession[])
  }, [supabase])

  useEffect(() => {
    if (!supabase || !authSession || profileStatus !== 'active') { setSessions([]); return }
    void refreshSessions()
    const channel = supabase.channel('live-session-map')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_sessions' }, () => void refreshSessions())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [supabase, authSession, profileStatus, refreshSessions])

  useEffect(() => {
    if (!map || !authSession || profileStatus !== 'active') {
      markersRef.current.forEach(marker => marker.remove())
      markersRef.current = []
      return
    }
    markersRef.current.forEach(marker => marker.remove())
    markersRef.current = sessions.filter(row => row.user_id !== authSession.user.id).map(row => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'live-session-marker'
      button.title = 'Canlı yayını izle'
      button.textContent = 'CANLI'
      button.addEventListener('click', () => {
        setBusy(true)
        void supabase?.functions.invoke('live-session', { body: { action: 'join', session_id: row.id } })
          .then(({ data, error }) => {
            if (error || !data?.session?.room_id) throw error ?? new Error('Yayın odası bulunamadı')
            setViewerSession({ ...row, room_id: data.session.room_id })
            setNotice('Yayın bağlantısı kuruluyor')
          })
          .catch(error => setNotice(error instanceof Error ? error.message : 'Yayına katılınamadı'))
          .finally(() => setBusy(false))
      })
      return new maplibregl.Marker({ element: button, anchor: 'center' })
        .setLngLat([row.lng, row.lat]).addTo(map)
    })
    return () => {
      markersRef.current.forEach(marker => marker.remove())
      markersRef.current = []
    }
  }, [map, sessions, authSession, profileStatus, supabase])

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = viewer.remoteStream
  }, [viewer.remoteStream])

  useEffect(() => {
    if (!publisherSession || !supabase) return
    const timer = window.setInterval(() => {
      void supabase.functions.invoke('live-session', {
        body: { action: 'heartbeat', session_id: publisherSession.id },
      }).then(({ error }) => {
        if (error) setNotice('Heartbeat gönderilemedi; yayın düşebilir')
      })
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [publisherSession, supabase])

  useEffect(() => () => publisherStream?.getTracks().forEach(track => track.stop()), [publisherStream])

  const authenticate = async (mode: 'signin' | 'signup') => {
    if (!supabase || !email.trim() || !password) return
    setBusy(true)
    const result = mode === 'signin'
      ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
      : await supabase.auth.signUp({ email: email.trim(), password })
    setBusy(false)
    setNotice(result.error?.message ?? (mode === 'signup' ? 'Kayıt alındı. E-posta onayı gerekiyorsa gelen kutunu kontrol et.' : 'Giriş yapıldı'))
  }

  const startBroadcast = async () => {
    if (!supabase || !authSession || profileStatus !== 'active') return
    setBusy(true)
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000 }),
      )
      const { data, error } = await supabase.functions.invoke('live-session', {
        body: {
          action: 'start',
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          pin_id: crypto.randomUUID(),
        },
      })
      if (error || !data?.session?.id || !data?.session?.room_id) throw error ?? new Error('Yayın oturumu oluşturulamadı')
      setPublisherStream(stream)
      setPublisherSession({ id: data.session.id, room_id: data.session.room_id })
      setNotice('Canlı yayın başlatıldı')
      await refreshSessions()
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop())
      setNotice(error instanceof Error ? error.message : 'Kamera veya konum izni alınamadı')
    } finally {
      setBusy(false)
    }
  }

  const endBroadcast = async () => {
    if (!supabase || !publisherSession) return
    setBusy(true)
    await supabase.functions.invoke('live-session', {
      body: { action: 'end', session_id: publisherSession.id },
    })
    publisherStream?.getTracks().forEach(track => track.stop())
    setPublisherStream(null)
    setPublisherSession(null)
    await refreshSessions()
    setNotice('Yayın bitirildi')
    setBusy(false)
  }

  const closeViewer = () => {
    setViewerSession(null)
    setNotice('İzleyici bağlantısı kapatıldı')
  }

  if (!supabase) return <div className="live-layer-card live-layer-warning">LAB Supabase Preview anahtarları tanımlı değil.</div>

  return (
    <div className="live-layer-ui">
      {!authSession ? (
        <div className="live-layer-card">
          <strong>Canlı yayın</strong>
          <input value={email} onChange={event => setEmail(event.target.value)} placeholder="E-posta" type="email" />
          <input value={password} onChange={event => setPassword(event.target.value)} placeholder="Şifre" type="password" />
          <div className="live-layer-actions">
            <button disabled={busy} onClick={() => { void authenticate('signin') }}>Giriş yap</button>
            <button className="secondary" disabled={busy} onClick={() => { void authenticate('signup') }}>Kayıt ol</button>
          </div>
          {notice && <small>{notice}</small>}
        </div>
      ) : (
        <div className="live-layer-card">
          <div className="live-layer-heading"><strong>AYTAR CANLI</strong><span>{profileStatus || 'Kontrol ediliyor'}</span></div>
          {profileStatus !== 'active' ? (
            <small>Hesap durumu: {profileStatus || 'yükleniyor'}. Yayın ve izleme için aktif üyelik gerekir.</small>
          ) : (
            <>
              {!publisherSession ? (
                <button disabled={busy || !!viewerSession} onClick={() => void startBroadcast()}>
                  {busy ? 'Hazırlanıyor…' : 'Canlı Yayın Başlat'}
                </button>
              ) : (
                <>
                  <small>{publisher.status}</small>
                  <button className="danger" disabled={busy} onClick={() => void endBroadcast()}>Yayını Bitir</button>
                </>
              )}
              {viewerSession && (
                <div className="live-viewer-panel">
                  <div className="live-layer-heading"><strong>CANLI YAYIN</strong><button className="secondary" onClick={closeViewer}>Kapat</button></div>
                  <video ref={videoRef} autoPlay playsInline controls />
                  <small>{viewer.status}</small>
                </div>
              )}
            </>
          )}
          <button className="secondary" onClick={() => void supabase.auth.signOut()}>Oturumu kapat</button>
          {notice && <small>{notice}</small>}
        </div>
      )}
    </div>
  )
}

export default LiveLayer
