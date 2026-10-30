import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap, type LayerSpecification } from "maplibre-gl";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const INITIAL_CENTER: [number, number] = [28.9784, 41.0084];

type BuildingLayer = {
  id: string;
  source: string;
  "source-layer": string;
  filter?: unknown;
};

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
      zoom: 15,
      pitch: 60,
      bearing: -20,
      maxPitch: 75,
      antialias: true,
      attributionControl: true
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");

    const onLoad = () => {
      const added = addNeonBuildings(map);
      setStatus(added ? "3D NEON AKTİF" : "HARİTA AÇIK · BİNA KATMANI BULUNAMADI");
    };

    const onError = (event: { error?: Error }) => {
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
      zoom: 15,
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