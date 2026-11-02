import { useCallback, useEffect, useRef, useState } from 'react'
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl'
import {
  Activity, AlertTriangle, Camera, ChevronDown, Crosshair, Layers3,
  Map as MapIcon, MapPinned, Menu, Minus, Plus, Radio, Search,
  Settings2, ShieldCheck, Signal, SlidersHorizontal, X,
} from 'lucide-react'

type LayerKey = 'reports' | 'earthquakes' | 'cameras'

const initialLayers: Record<LayerKey, boolean> = {
  reports: true,
  earthquakes: false,
  cameras: false,
}

const mapStyle = import.meta.env.VITE_MAP_STYLE_URL || 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

function MapCanvas({ onReady }: { onReady: (map: MapLibreMap) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)

  useEffect(() => {
    if (!host.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: host.current,
      style: mapStyle,
      center: [28.9784, 41.0082],
      zoom: 11.3,
      pitch: 48,
      bearing: -12,
      maxPitch: 75,
      attributionControl: false,
    })
    mapRef.current = map
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    map.on('load', () => onReady(map))
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [onReady])

  return <div className="map-canvas" ref={host} />
}

function App() {
  const mapRef = useRef<MapLibreMap | null>(null)
  const [layers, setLayers] = useState(initialLayers)
  const [menuOpen, setMenuOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [mapReady, setMapReady] = useState(false)
  const [activeTool, setActiveTool] = useState('layers')
  const [notice, setNotice] = useState('Laboratuvar haritası hazır')

  const handleMapReady = useCallback((map: MapLibreMap) => {
    mapRef.current = map
    setMapReady(true)
  }, [])

  const toggleLayer = (key: LayerKey) => {
    setLayers(current => ({ ...current, [key]: !current[key] }))
    const labels: Record<LayerKey, string> = { reports: 'Bildirimler', earthquakes: 'Deprem katmanı', cameras: 'Trafik kameraları' }
    setNotice(`${labels[key]} katmanı ${layers[key] ? 'kapatıldı' : 'açıldı'}`)
  }

  const zoom = (delta: number) => mapRef.current?.zoomTo((mapRef.current.getZoom() || 11) + delta, { duration: 350 })
  const locate = () => {
    if (!navigator.geolocation) {
      setNotice('Bu tarayıcı konum özelliğini desteklemiyor')
      return
    }
    setNotice('Konum bekleniyor…')
    navigator.geolocation.getCurrentPosition(
      position => {
        mapRef.current?.flyTo({ center: [position.coords.longitude, position.coords.latitude], zoom: 15, pitch: 50, duration: 1200 })
        setNotice('Konumun haritada gösterildi')
      },
      () => setNotice('Konum alınamadı. Tarayıcı iznini kontrol et.'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const resetView = () => mapRef.current?.flyTo({ center: [28.9784, 41.0082], zoom: 11.3, pitch: 48, bearing: -12, duration: 900 })

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Activity size={21} strokeWidth={2.4} /></div>
          <div><div className="brand-name">AYTAR <span>LAB</span></div><div className="brand-subtitle">DAİMA İLERİ</div></div>
        </div>
        <div className="topbar-center"><span className="environment-dot" /> GELİŞTİRME ORTAMI <span className="topbar-divider">/</span> İSTANBUL</div>
        <div className="topbar-actions">
          <div className="connection"><span className="pulse-dot" /> <span>{mapReady ? 'HARİTA AKTİF' : 'BAĞLANIYOR'}</span></div>
          <button className="icon-button mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menüyü aç"><Menu size={19} /></button>
          <button className="profile-button" title="Laboratuvar profili">SA</button>
        </div>
      </header>

      <section className="workspace">
        <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
          <div className="sidebar-heading"><span>ÇALIŞMA ALANI</span><button className="icon-button close-menu" onClick={() => setMenuOpen(false)} aria-label="Menüyü kapat"><X size={17} /></button></div>
          <button className={`nav-item ${activeTool === 'map' ? 'selected' : ''}`} onClick={() => setActiveTool('map')}><MapIcon size={17} /><span>Harita görünümü</span><span className="nav-indicator" /></button>
          <button className={`nav-item ${activeTool === 'layers' ? 'selected' : ''}`} onClick={() => setActiveTool('layers')}><Layers3 size={17} /><span>Harita katmanları</span></button>
          <button className={`nav-item ${activeTool === 'settings' ? 'selected' : ''}`} onClick={() => setActiveTool('settings')}><Settings2 size={17} /><span>Laboratuvar ayarları</span></button>
          <div className="sidebar-separator" />
          <div className="sidebar-section-title">VERİ KATMANLARI <SlidersHorizontal size={13} /></div>
          <div className="layer-list">
            <button className="layer-row" onClick={() => toggleLayer('reports')}><span className="layer-symbol report-symbol"><MapPinned size={15} /></span><span className="layer-copy"><strong>Bildirimler</strong><small>Harita pinleri</small></span><span className={`switch ${layers.reports ? 'on' : ''}`} /></button>
            <button className="layer-row" onClick={() => toggleLayer('earthquakes')}><span className="layer-symbol quake-symbol"><Activity size={15} /></span><span className="layer-copy"><strong>Depremler</strong><small>AFAD veri katmanı</small></span><span className={`switch ${layers.earthquakes ? 'on' : ''}`} /></button>
            <button className="layer-row" onClick={() => toggleLayer('cameras')}><span className="layer-symbol camera-symbol"><Camera size={15} /></span><span className="layer-copy"><strong>Trafik kameraları</strong><small>İBB canlı yayınları</small></span><span className={`switch ${layers.cameras ? 'on' : ''}`} /></button>
          </div>
          <div className="sidebar-note"><div className="note-icon"><ShieldCheck size={16} /></div><div><strong>Güvenli geliştirme</strong><p>Bu alan üretim AYTAR sisteminden bağımsızdır.</p></div></div>
          <div className="sidebar-footer"><span className="footer-led" /> LAB ORTAMI <span className="version">v0.1.0</span></div>
        </aside>

        <section className="map-stage">
          <MapCanvas onReady={handleMapReady} />
          <div className="map-vignette" />
          <div className="map-toolbar">
            <div className="search-box"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && search.trim()) setNotice(`Arama altyapısı sırada: ${search.trim()}`) }} placeholder="Konum veya adres ara…" /><kbd>ENTER</kbd></div>
            <button className="toolbar-button" onClick={resetView}><MapPinned size={16} /><span>İstanbul</span><ChevronDown size={14} /></button>
          </div>
          <div className="map-tools-right">
            <button className="map-control" onClick={() => zoom(1)} aria-label="Yakınlaştır"><Plus size={18} /></button>
            <button className="map-control" onClick={() => zoom(-1)} aria-label="Uzaklaştır"><Minus size={18} /></button>
            <div className="control-divider" />
            <button className="map-control locate-control" onClick={locate} aria-label="Konumuma git"><Crosshair size={18} /></button>
          </div>
          <div className="map-bottom-left"><span className="map-live-dot" /> HARİTA VERİSİ <span className="bottom-divider">•</span> CARTO</div>
          <div className="map-status"><Signal size={13} /><span>{mapReady ? 'Harita servisi çalışıyor' : 'Harita servisine bağlanılıyor'}</span></div>
          <div className="map-crosshair"><span /><i /></div>
        </section>

        <aside className="inspector">
          <div className="inspector-header"><div><span className="eyebrow">SİSTEM ÖZETİ</span><h2>Kontrol paneli</h2></div><button className="icon-button" aria-label="Panel ayarları"><Settings2 size={17} /></button></div>
          <div className="system-card"><div className="system-card-top"><span>LABORATUVAR DURUMU</span><span className="status-pill"><i /> AKTİF</span></div><div className="system-title">Harita altyapısı</div><div className="system-desc">Temel harita motoru başlatıldı. Veri servisleri sonraki geliştirme aşamalarında bağlanacak.</div><div className="system-progress"><span /></div><div className="progress-caption"><span>Başlangıç kurulumu</span><strong>%25</strong></div></div>
          <div className="inspector-section"><div className="section-heading"><span>AKTİF KATMANLAR</span><span className="count-badge">{Object.values(layers).filter(Boolean).length}</span></div>
            <div className="metric-row"><span className="metric-icon blue"><MapPinned size={16} /></span><span className="metric-label">Bildirimler</span><strong>{layers.reports ? 'Açık' : 'Kapalı'}</strong></div>
            <div className="metric-row"><span className="metric-icon amber"><AlertTriangle size={16} /></span><span className="metric-label">Deprem verisi</span><strong>{layers.earthquakes ? 'Açık' : 'Kapalı'}</strong></div>
            <div className="metric-row"><span className="metric-icon cyan"><Radio size={16} /></span><span className="metric-label">Canlı kameralar</span><strong>{layers.cameras ? 'Açık' : 'Kapalı'}</strong></div>
          </div>
          <div className="inspector-section next-steps"><div className="section-heading"><span>GELİŞTİRME SIRASI</span><span className="muted-label">PLAN</span></div><div className="step-item current"><span className="step-number">01</span><div><strong>Harita altyapısı</strong><small>Temel arayüz ve motor</small></div><span className="step-check">✓</span></div><div className="step-item"><span className="step-number">02</span><div><strong>Pin ve bildirim sistemi</strong><small>Konum tabanlı kayıtlar</small></div></div><div className="step-item"><span className="step-number">03</span><div><strong>AFAD deprem katmanı</strong><small>Canlı olay verileri</small></div></div><div className="step-item"><span className="step-number">04</span><div><strong>İBB canlı kameralar</strong><small>HLS yayın entegrasyonu</small></div></div></div>
          <div className="inspector-footer"><span>AYTAR LAB</span><span>İZOLE ORTAM · ÜRETİMDEN BAĞIMSIZ</span></div>
        </aside>
      </section>
      <footer className="statusbar"><div><span className="statusbar-dot" /> {notice}</div><div className="statusbar-right"><span>TR</span><span>41.0082° N, 28.9784° E</span><span>MAPLIBRE GL</span></div></footer>
    </main>
  )
}

export default App
