import { useEffect, useRef, useState } from 'react';
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
import { ICE_CONFIGURATION, TURN_CONFIGURED, FORCE_TURN_RELAY } from './lib/liveClient';

type Role = 'caller' | 'receiver';
type Signal = { from: Role; type: 'offer' | 'answer' | 'ice'; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL_LAB as string | undefined)?.trim() || '';
const supabaseKey = (import.meta.env.VITE_SUPABASE_ANON_KEY_LAB as string | undefined)?.trim() || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 20 } },
}) : null;

export default function WebRtcLabTest({ onClose }: { onClose: () => void }) {
  const [room, setRoom] = useState('aytar-turn-test');
  const [role, setRole] = useState<Role>('caller');
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState('Hazır');
  const [connection, setConnection] = useState('Bağlantı kurulmadı');
  const [candidateInfo, setCandidateInfo] = useState('ICE adayları bekleniyor');
  const [selectedPair, setSelectedPair] = useState('Henüz seçilmiş aday çifti yok');
  const [error, setError] = useState('');
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const roleRef = useRef<Role>(role);
  roleRef.current = role;

  const sendSignal = async (signal: Omit<Signal, 'from'>) => {
    const channel = channelRef.current;
    if (!channel) return;
    await channel.send({ type: 'broadcast', event: 'signal', payload: { ...signal, from: roleRef.current } });
  };

  const flushIce = async (pc: RTCPeerConnection) => {
    const queued = [...pendingIceRef.current];
    pendingIceRef.current = [];
    for (const candidate of queued) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); }
      catch (e) { console.warn('[TURN LAB] ICE kuyruğu:', e); }
    }
  };

  const ensurePeer = async () => {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection(ICE_CONFIGURATION);
    pcRef.current = pc;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: videoEnabled });
    localStreamRef.current = stream;
    if (localVideo.current) localVideo.current.srcObject = stream;
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    pc.onicecandidate = event => {
      if (event.candidate) {
        const candidate = event.candidate.toJSON();
        const line = candidate.candidate || '';
        if (line.includes(' typ relay')) setCandidateInfo('TURN relay adayı toplandı');
        else if (line.includes(' typ srflx')) setCandidateInfo('STUN srflx adayı toplandı');
        void sendSignal({ type: 'ice', candidate });
      }
    };
    pc.ontrack = event => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      remoteStreamRef.current = stream;
      if (remoteVideo.current) remoteVideo.current.srcObject = stream;
    };
    pc.onconnectionstatechange = () => {
      setConnection(pc.connectionState);
      if (pc.connectionState === 'connected') setStatus('Eşler arası bağlantı kuruldu');
      if (pc.connectionState === 'failed') setError('Bağlantı başarısız. TURN ayarlarını ve kota durumunu kontrol et.');
    };
    return pc;
  };

  const handleSignal = async (signal: Signal) => {
    if (signal.from === roleRef.current) return;
    try {
      if (signal.type === 'offer' && roleRef.current === 'receiver' && signal.description) {
        const pc = await ensurePeer();
        await pc.setRemoteDescription(new RTCSessionDescription(signal.description));
        await flushIce(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal({ type: 'answer', description: pc.localDescription?.toJSON() });
        setStatus('Teklif alındı; yanıt gönderildi');
      } else if (signal.type === 'answer' && roleRef.current === 'caller' && signal.description) {
        const pc = pcRef.current;
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(signal.description));
        await flushIce(pc);
        setStatus('Yanıt alındı; ICE bağlantısı kuruluyor');
      } else if (signal.type === 'ice' && signal.candidate) {
        const pc = pcRef.current;
        if (!pc || !pc.remoteDescription) pendingIceRef.current.push(signal.candidate);
        else await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const joinRoom = async () => {
    if (!supabase) {
      setError('LAB Supabase değişkenleri eksik: VITE_SUPABASE_URL_LAB ve VITE_SUPABASE_ANON_KEY_LAB');
      return;
    }
    if (!room.trim()) { setError('Oda kodu gir.'); return; }
    setError('');
    setStatus('Odaya bağlanılıyor…');
    const channel = supabase.channel('aytar-turn-' + room.trim(), { config: { broadcast: { self: false } } });
    channel.on('broadcast', { event: 'signal' }, ({ payload }) => { void handleSignal(payload as Signal); });
    channelRef.current = channel;
    channel.subscribe(state => {
      if (state === 'SUBSCRIBED') {
        setJoined(true);
        setStatus('Odaya katıldın. Diğer telefonu bekliyor.');
      } else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT') {
        setError('Supabase Realtime bağlantısı kurulamadı: ' + state);
      }
    });
  };

  const startCall = async () => {
    try {
      setError('');
      if (!joined || role !== 'caller') return;
      const pc = await ensurePeer();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sendSignal({ type: 'offer', description: pc.localDescription?.toJSON() });
      setStatus('Teklif gönderildi; diğer telefonun yanıtı bekleniyor.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const leave = async () => {
    channelRef.current?.unsubscribe();
    channelRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current?.getTracks().forEach(track => track.stop());
    remoteStreamRef.current = null;
    pendingIceRef.current = [];
    if (localVideo.current) localVideo.current.srcObject = null;
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    setJoined(false);
    setConnection('Bağlantı kurulmadı');
    setCandidateInfo('ICE adayları bekleniyor');
    setSelectedPair('Henüz seçilmiş aday çifti yok');
    setStatus('Oturum kapatıldı');
  };

  useEffect(() => () => {
    channelRef.current?.unsubscribe();
    pcRef.current?.close();
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    remoteStreamRef.current?.getTracks().forEach(track => track.stop());
  }, []);

  useEffect(() => {
    if (!joined || !pcRef.current) return;
    const timer = window.setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      const stats = await pc.getStats();
      let pair: RTCIceCandidatePairStats | undefined;
      stats.forEach(report => {
        const candidatePair = report as RTCStats & { state?: string; nominated?: boolean; selected?: boolean; localCandidateId?: string; remoteCandidateId?: string };
        if (report.type === 'candidate-pair' && candidatePair.state === 'succeeded' && (candidatePair.nominated || candidatePair.selected)) {
          pair = candidatePair as RTCIceCandidatePairStats;
        }
      });
      if (!pair) return;
      const local = stats.get(pair.localCandidateId) as (RTCStats & { candidateType?: string }) | undefined;
      const remote = stats.get(pair.remoteCandidateId) as (RTCStats & { candidateType?: string }) | undefined;
      if (local) setSelectedPair('Seçilen yerel aday: ' + local.candidateType + ' / uzak aday: ' + (remote?.candidateType || 'bilinmiyor'));
      if (local?.candidateType === 'relay') setCandidateInfo('TURN RELAY AKTİF — trafik Metered üzerinden geçiyor');
    }, 2000);
    return () => window.clearInterval(timer);
  }, [joined, connection]);

  return <section className="turn-test-panel">
    <div className="turn-test-header"><div><span className="eyebrow">AYTAR LAB / WEBRTC</span><h2>TURN bağlantı testi</h2></div><button className="icon-button" onClick={() => { void leave(); onClose(); }}>Kapat</button></div>
    <p className="turn-test-note">İki telefonda aynı oda kodunu kullan. Birini Arayan, diğerini Alıcı seç. Bu test yalnızca LAB Supabase Realtime kanalını kullanır.</p>
    <div className="turn-test-config">
      <span className={TURN_CONFIGURED ? 'turn-ok' : 'turn-warn'}>{TURN_CONFIGURED ? 'Metered TURN yapılandırıldı' : 'Metered TURN bilgileri eksik'}</span>
      <span>{FORCE_TURN_RELAY ? 'Zorunlu relay modu' : 'STUN + TURN otomatik seçim'}</span>
    </div>
    <div className="turn-test-fields">
      <label>Oda kodu<input value={room} onChange={e => setRoom(e.target.value)} disabled={joined} /></label>
      <label>Rol<select value={role} onChange={e => setRole(e.target.value as Role)} disabled={joined}><option value="caller">Arayan / Yayıncı</option><option value="receiver">Alıcı / İzleyici</option></select></label>
      <label>Medya<select value={videoEnabled ? 'video' : 'audio'} onChange={e => setVideoEnabled(e.target.value === 'video')} disabled={joined}><option value="video">Ses + video</option><option value="audio">Yalnızca ses</option></select></label>
    </div>
    <div className="turn-test-actions">
      {!joined ? <button onClick={() => void joinRoom()}>Odaya katıl</button> : <button onClick={() => void leave()}>Bağlantıyı kes</button>}
      {joined && role === 'caller' && <button onClick={() => void startCall()}>Aramayı başlat</button>}
    </div>
    <div className="turn-test-status"><strong>{status}</strong><span>ICE: {connection}</span><span>{candidateInfo}</span><span>{selectedPair}</span></div>
    {error && <p className="turn-test-error">{error}</p>}
    <div className="turn-test-videos"><div><small>BENİM KAMERAM</small><video ref={localVideo} autoPlay muted playsInline /></div><div><small>KARŞI TELEFON</small><video ref={remoteVideo} autoPlay playsInline /></div></div>
    <p className="turn-test-foot">TURN zorlamalı test için URL sonuna <code>?turnTest=1</code> ekle. Bu modda bağlantı yalnızca relay adayıyla kurulur.</p>
  </section>;
}
