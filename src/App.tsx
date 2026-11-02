import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl, { type Map as MapLibreMap, type Marker } from 'maplibre-gl'
import Hls from 'hls.js'
import LiveLayer from './live/LiveLayer'
import {
  Activity, Crosshair, Minus, Plus, Search, Settings2, UserRound,
} from 'lucide-react'

type CameraRecord = { id: string; name: string; lat: number; lng: number; videoUrl: string }
const mapStyle = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
const cameraEndpoint = import.meta.env.VITE_IBB_CAMERA_PROXY_URL || 'https://aytar-ibb-cameras.xsinanxaykacx.workers.dev/'

function pick(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return undefined
}
function normalizeCameras(payload: unknown): CameraRecord[] {
  const candidates: unknown[] = []
  const visit = (value: unknown, depth = 0) => {
    if (depth > 4 || value == null) return
    if (Array.isArray(value)) { candidates.push(...value); return }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>
      for (const key of ['data', 'Data', 'cameras', 'Cameras', 'cameraList', 'CameraList', 'result', 'Result']) {
        if (obj[key] && obj[key] !== value) visit(obj[key], depth + 1)
      }
    }
  }
  visit(payload)
  const source = candidates.length ? candidates : (Array.isArray(payload) ? payload : [])
  const result: CameraRecord[] = []
  for (const item of source) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const lat = Number(pick(row, ['lat', 'Lat', 'LAT', 'latitude', 'Latitude', 'Y']))
    const lng = Number(pick(row, ['lng', 'Lng', 'LNG', 'lon', 'Lon', 'longitude', 'Longitude', 'X']))
    const videoUrl = String(pick(row, ['VideoURL_SSL', 'videoUrl', 'VideoUrl', 'videoURL', 'url']) || '')
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !videoUrl.startsWith('http')) continue
    result.push({
      id: String(pick(row, ['id', 'Id', 'ID', 'CameraID', 'CameraId']) || `${lat},${lng}`),
      name: String(pick(row, ['name', 'Name', 'CameraName', 'cameraName', 'Description']) || 'İBB Trafik Kamerası'),
      lat, lng, videoUrl,
    })
  }
  return result
}

function MapCanvas({ onReady }: { onReady: (map: MapLibreMap) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  useEffect(() => {
    if (!host.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: host.current, style: mapStyle, center: [28.9784, 41.0082],
      zoom: 11.3, pitch: 48, bearing: -12, maxPitch: 75, attributionControl: false,
    })
    mapRef.current = map
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    map.on('load', () => onReady(map))
    return () => { map.remove(); mapRef.current = null }
  }, [onReady])
  return <div className="map-canvas" ref={host} />
}

function App() {
  const mapRef = useRef<MapLibreMap | null>(null)
  const markersRef = useRef<Marker[]>([])
  const [search, setSearch] = useState('')
  const [mapReady, setMapReady] = useState(false)
  const [cameraCount, setCameraCount] = useState(0)
  const [cameraLoading, setCameraLoading] = useState(false)
  const [cameraError, setCameraError] = useState('')

  const handleMapReady = useCallback((map: MapLibreMap) => {
    mapRef.current = map
    setMapReady(true)
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) {
      markersRef.current.forEach(marker => marker.remove())
      markersRef.current = []
      return
    }
    let cancelled = false
    let loadedCameras: CameraRecord[] = []
    const renderVisibleMarkers = () => {
      const bounds = map.getBounds()
      const visible = loadedCameras.filter(camera => bounds.contains([camera.lng, camera.lat]))
      markersRef.current.forEach(marker => marker.remove())
      markersRef.current = visible.map(camera => {
        const element = document.createElement('button')
        element.type = 'button'
        element.className = 'camera-marker'
        element.title = camera.name
        const dot = document.createElement('span')
        dot.className = 'camera-marker-dot'
        const label = document.createElement('span')
        label.className = 'camera-marker-label'
        label.textContent = camera.name
        element.append(dot, label)
        element.addEventListener('click', () => {
          const wrapper = document.createElement('div')
          wrapper.className = 'camera-popup'
          const heading = document.createElement('div')
          heading.className = 'camera-popup-title'
          heading.textContent = `Kamera: ${camera.name}`
          const status = document.createElement('div')
          status.className = 'camera-popup-status'
          status.textContent = 'Canlı yayın bağlantısı hazırlanıyor…'
          const video = document.createElement('video')
          video.className = 'camera-video'
          video.controls = true
          video.autoplay = true
          video.muted = true
          video.playsInline = true
          wrapper.append(heading, status, video)
          const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '360px', offset: 18 })
            .setLngLat([camera.lng, camera.lat]).setDOMContent(wrapper).addTo(map)
          let hls: Hls | null = null
          const cleanup = () => {
            if (hls) { hls.destroy(); hls = null }
            video.pause()
            video.removeAttribute('src')
            video.load()
          }
          popup.on('close', cleanup)
          if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = camera.videoUrl
            video.addEventListener('loadedmetadata', () => { status.textContent = 'CANLI YAYIN' }, { once: true })
            video.addEventListener('error', () => { status.textContent = 'Yayın açılamadı · HLS/CORS kontrol edilmeli' }, { once: true })
          } else if (Hls.isSupported()) {
            hls = new Hls({ enableWorker: true, lowLatencyMode: true })
            hls.loadSource(camera.videoUrl)
            hls.attachMedia(video)
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              status.textContent = 'CANLI YAYIN'
              void video.play().catch(() => { status.textContent = 'Oynatmak için video üzerindeki oynat düğmesine bas' })
            })
            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (data.fatal) status.textContent = 'Yayın alınamadı · İBB HLS CORS/proxy ayarı gerekiyor'
            })
          } else status.textContent = 'Bu tarayıcı HLS oynatmayı desteklemiyor'
        })
        return new maplibregl.Marker({ element, anchor: 'bottom' }).setLngLat([camera.lng, camera.lat]).addTo(map)
      })
    }
    const onMoveEnd = () => renderVisibleMarkers()
    map.on('moveend', onMoveEnd)
    setCameraLoading(true)
    setCameraError('')
    fetch(cameraEndpoint, { headers: { Accept: 'application/json' } })
      .then(response => {
        if (!response.ok) throw new Error(`Kamera servisi HTTP ${response.status}`)
        return response.json()
      })
      .then(payload => {
        if (cancelled) return
        loadedCameras = normalizeCameras(payload)
        if (!loadedCameras.length) throw new Error('Servis yanıtında koordinat ve yayın adresi bulunan kamera kaydı bulunamadı.')
        setCameraCount(loadedCameras.length)
        renderVisibleMarkers()
        
        setCameraError('')
        setCameraLoading(false)
      })
      .catch(error => {
        if (cancelled) return
        setCameraError(error instanceof Error ? error.message : 'Kamera verisi alınamadı')
        
        setCameraLoading(false)
      })
    return () => {
      cancelled = true
      map.off('moveend', onMoveEnd)
      markersRef.current.forEach(marker => marker.remove())
      markersRef.current = []
    }
  }, [mapReady])

  const zoom = (delta: number) => mapRef.current?.zoomTo((mapRef.current.getZoom() || 11) + delta, { duration: 350 })
  const locate = () => {
    if (!navigator.geolocation) {  return }
    
    navigator.geolocation.getCurrentPosition(
      position => { mapRef.current?.flyTo({ center: [position.coords.longitude, position.coords.latitude], zoom: 15, pitch: 50, duration: 1200 });  },
      () => {},
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }
  const resetView = () => mapRef.current?.flyTo({ center: [28.9784, 41.0082], zoom: 11.3, pitch: 48, bearing: -12, duration: 900 })

  return (
    <main className="app-shell">
      <MapCanvas onReady={handleMapReady} />
      <div className="map-vignette" />
      <LiveLayer map={mapReady ? mapRef.current : null} />
      <div className="map-search">
        <Search size={17} />
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Konum veya adres ara…" />
      </div>
      <div className="map-zoom">
        <button className="map-control" onClick={() => zoom(1)} aria-label="Yakınlaştır"><Plus size={19} /></button>
        <button className="map-control" onClick={() => zoom(-1)} aria-label="Uzaklaştır"><Minus size={19} /></button>
        <button className="map-control" onClick={locate} aria-label="Konumuma git"><Crosshair size={18} /></button>
      </div>
      <div className="map-top-right">
        <button className="map-control round-control" title="Ayarlar" aria-label="Ayarlar"><Settings2 size={17} /></button>
        <button className="map-control round-control profile-control" title="Profil" aria-label="Profil"><UserRound size={17} /></button>
      </div>
    </main>
  )
}
export default App
