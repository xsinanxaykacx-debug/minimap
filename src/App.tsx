import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap, LayerSpecification } from "maplibre-gl";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const INITIAL_CENTER: [number, number] = [28.9769, 41.0086];
const INITIAL_ZOOM = 16.7;

type BuildingLayer = {
  id: string;
  source: string;
  "source-layer": string;
  filter?: unknown;
};

function addNeonRoads(map: MapLibreMap) {
  const styleLayers = map.getStyle().layers ?? [];

  // Liberty'de kara yolu, köprü ve tünel çizgileri aynı vector source-layer'da.
  // Demiryolu, transit ve hatching katmanlarını yol paletine dahil etmiyoruz.
  const roadLayers = styleLayers.filter((layer) => {
    if (
      layer.type !== "line" ||
      !("source" in layer) ||
      !("source-layer" in layer) ||
      layer["source-layer"] !== "transportation"
    ) {
      return false;
    }

    const id = layer.id.toLowerCase();
    return (
      /(road|highway|bridge|tunnel)/.test(id) &&
      !/(rail|transit|hatching)/.test(id)
    );
  });

  if (roadLayers.length === 0) {
    console.warn("Map Lab: Liberty içinde yol çizgi katmanı bulunamadı.");
    return false;
  }

  const casingLayers = roadLayers.filter((layer) =>
    layer.id.toLowerCase().endsWith("_casing")
  );
  const coreLayers = roadLayers.filter(
    (layer) => !layer.id.toLowerCase().endsWith("_casing")
  );

  const coreColor = (id: string): string => {
    const lower = id.toLowerCase();
    const isTunnel = lower.includes("tunnel");

    // Tüneller aynı renk ailesinde, fakat daha koyu ve daha düşük parlaklıkta.
    if (isTunnel) {
      if (/motorway|trunk_primary/.test(lower)) return "#1689a8";
      if (/secondary_tertiary|link/.test(lower)) return "#116f91";
      if (/minor/.test(lower)) return "#0d526f";
      if (/service_track/.test(lower)) return "#0a4059";
      if (/path_pedestrian|pedestrian|street/.test(lower)) return "#17465a";
      return "#116f91";
    }

    // Köprüler normal yollarla aynı paleti kullanır.
    if (/motorway|trunk_primary/.test(lower)) return "#65f4ff";
    if (/secondary_tertiary|link/.test(lower)) return "#25c9e8";
    if (/minor/.test(lower)) return "#168db8";
    if (/service_track/.test(lower)) return "#116b91";
    if (/path_pedestrian|pedestrian|street/.test(lower)) return "#28677d";
    return "#20b8dc";
  };

  // Dış kenarlar: Liberty'nin açık sarı/beyaz casing çizgilerini söndür.
  for (const layer of casingLayers) {
    map.setPaintProperty(layer.id, "line-color", "#061827");
    map.setPaintProperty(layer.id, "line-opacity", 1);
  }

  // Merkez çizgiler: yol sınıfına göre cyan -> koyu mavi paleti.
  for (const layer of coreLayers) {
    map.setPaintProperty(layer.id, "line-color", coreColor(layer.id));
    map.setPaintProperty(layer.id, "line-opacity", 0.98);

    const id = layer.id.toLowerCase();
    if (/path_pedestrian|pedestrian/.test(id)) {
      // Meydan ve yaya yollarının geniş, parlak lekelere dönüşmesini önle.
      map.setPaintProperty(layer.id, "line-width", [
        "interpolate", ["linear"], ["zoom"],
        14, 0.35,
        16, 0.65,
        18, 1.05,
        20, 1.5
      ]);
      map.setPaintProperty(layer.id, "line-opacity", 0.78);
    } else if (/service_track/.test(id)) {
      map.setPaintProperty(layer.id, "line-opacity", 0.86);
    }
  }

  // Önceki deneysel glow katmanı bütün yolları ikinci kez kalın çiziyordu.
  // Eski adı varsa kaldır; yalnızca ana arterlere düşük yoğunluklu glow ekle.
  if (map.getLayer("lab-road-glow")) {
    map.removeLayer("lab-road-glow");
  }

  const firstRoadLayer = roadLayers[0] as LayerSpecification & {
    source: string;
    "source-layer": string;
  };

  if (!map.getLayer("neon-roads-glow")) {
    map.addLayer({
      id: "neon-roads-glow",
      type: "line",
      source: firstRoadLayer.source,
      "source-layer": firstRoadLayer["source-layer"],
      minzoom: 13.5,
      filter: [
        "in",
        ["get", "class"],
        ["literal", ["motorway", "trunk", "primary", "secondary"]]
      ],
      layout: {
        "line-cap": "round",
        "line-join": "round"
      },
      paint: {
        "line-color": "#00cfff",
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          13.5, 2,
          16, 4.5,
          18, 7
        ],
        "line-blur": 2.8,
        "line-opacity": 0.24
      }
    }, firstRoadLayer.id);
  }

  console.info(
    `Map Lab: ${coreLayers.length} yol merkezi, ${casingLayers.length} casing katmanı neon paletine geçirildi.`
  );
  return true;
}

function addNeonBuildings(map: MapLibreMap) {
  const styleLayers = map.getStyle().layers ?? [];
  const existing = styleLayers.find((layer) =>
    layer.type === "fill" &&
    /building/i.test(layer.id) &&
    "source" in layer &&
    "source-layer" in layer
  ) as (LayerSpecification & BuildingLayer) | undefined;

  if (!existing || !existing.source || !existing["source-layer"]) {
    console.warn("Map Lab: Stil içinde bina vektör katmanı bulunamadı.");
    return false;
  }

  const source = existing.source;
  const sourceLayer = existing["source-layer"];
  const beforeId = styleLayers.find((layer) => layer.type === "symbol")?.id;

  if (!map.getLayer("lab-buildings-extrusion")) {
    map.addLayer({
      id: "lab-buildings-extrusion",
      type: "fill-extrusion",
      source,
      "source-layer": sourceLayer,
      ...(existing.filter ? { filter: existing.filter as never } : {}),
      minzoom: 14,
      paint: {
        "fill-extrusion-color": "#10243a",
        "fill-extrusion-height": [
          "interpolate", ["linear"], ["zoom"],
          14, ["max", 5, ["to-number", ["get", "render_height"], ["to-number", ["get", "height"], 8]]],
          16, ["max", 8, ["to-number", ["get", "render_height"], ["to-number", ["get", "height"], 12]]]
        ],
        "fill-extrusion-base": [
          "max", 0,
          ["to-number", ["get", "render_min_height"], ["to-number", ["get", "min_height"], 0]]
        ],
        "fill-extrusion-opacity": 0.92,
        "fill-extrusion-vertical-gradient": true
      }
    }, beforeId);
  }

  if (!map.getLayer("lab-building-glow")) {
    map.addLayer({
      id: "lab-building-glow",
      type: "line",
      source,
      "source-layer": sourceLayer,
      ...(existing.filter ? { filter: existing.filter as never } : {}),
      minzoom: 14,
      paint: {
        "line-color": "#00d9ff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 14, 1.2, 17, 2.8],
        "line-blur": 3,
        "line-opacity": 0.45
      }
    }, beforeId);
  }

  if (!map.getLayer("lab-building-outline")) {
    map.addLayer({
      id: "lab-building-outline",
      type: "line",
      source,
      "source-layer": sourceLayer,
      ...(existing.filter ? { filter: existing.filter as never } : {}),
      minzoom: 14,
      paint: {
        "line-color": "#8af4ff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 14, 0.45, 17, 1.1],
        "line-opacity": 0.8
      }
    }, beforeId);
  }

  return true;
}

export default function App() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [mode, setMode] = useState<"3d" | "2d">("3d");
  const [status, setStatus] = useState("HARİTA YÜKLENİYOR");

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: STYLE_URL,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      pitch: 60,
      bearing: -20,
      maxPitch: 75,
      canvasContextAttributes: { antialias: true },
      attributionControl: { compact: true }
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

    const onLoad = () => {
      const buildingsAdded = addNeonBuildings(map);
      const roadsAdded = addNeonRoads(map);
      setStatus(buildingsAdded && roadsAdded ? "3D NEON + YOL AKTİF" : "HARİTA AÇIK · KATMAN KONTROLÜ GEREKLİ");
    };

    const onError = (event: any) => {
      console.error("MapLibre:", event.error);
      setStatus("HARİTA HATASI");
    };

    map.on("load", onLoad);
    map.on("error", onError);

    return () => {
      map.off("load", onLoad);
      map.off("error", onError);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  function changeMode(nextMode: "2d" | "3d") {
    setMode(nextMode);
    mapRef.current?.easeTo({
      pitch: nextMode === "3d" ? 60 : 0,
      bearing: nextMode === "3d" ? -20 : 0,
      duration: 900
    });
  }

  function resetView() {
    mapRef.current?.flyTo({
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      pitch: mode === "3d" ? 60 : 0,
      bearing: mode === "3d" ? -20 : 0,
      duration: 1100
    });
  }

  return (
    <main className="app-shell">
      <div className="map-frame" ref={mapContainer} />
      <div className="vignette" aria-hidden="true" />
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <div>
            <div className="brand-title">AYTAR <span>MAP LAB</span></div>
            <div className="brand-subtitle">INDEPENDENT MAP EXPERIMENT</div>
          </div>
        </div>
        <div className="status"><i />{status}</div>
      </header>
      <section className="map-controls" aria-label="Harita kontrolleri">
        <div className="mode-switch">
          <button className={mode === "2d" ? "active" : ""} onClick={() => changeMode("2d")}>2D</button>
          <button className={mode === "3d" ? "active" : ""} onClick={() => changeMode("3d")}>3D</button>
        </div>
        <button className="reset-button" onClick={resetView}>MERKEZE DÖN</button>
      </section>
      <footer className="footer-note">MAPLIBRE GL · OPENFREEMAP LIBERTY · İSTANBUL</footer>
    </main>
  );
}