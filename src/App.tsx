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
  // Önceki denemelerden kalmış bütün yol neon/glow katmanlarını kaldır.
  for (const id of ["neon-roads-core", "neon-roads-glow", "lab-road-glow"]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }

  // Katman listesini kaldırma işleminden SONRA al; silinen glow referansı kalmasın.
  const styleLayers = map.getStyle().layers ?? [];

  // Liberty'deki Sultanahmet taramalarının asıl kaynağı road_area_pattern:
  // fill-pattern = pedestrian_polygon. Beyaz kesikli yaya çizgileri de gizlenir.
  let scanlineLayersHidden = 0;
  for (const layer of styleLayers) {
    const id = layer.id.toLowerCase();
    const fillPattern = layer.type === "fill"
      ? map.getPaintProperty(layer.id, "fill-pattern")
      : undefined;
    const patternText = typeof fillPattern === "string"
      ? fillPattern.toLowerCase()
      : JSON.stringify(fillPattern ?? "").toLowerCase();

    const isPedestrianPattern =
      layer.type === "fill" &&
      (/(pedestrian|footway|plaza|paving|square)/.test(id) ||
        patternText.includes("pedestrian_polygon"));

    const isPedestrianScanline =
      layer.type === "line" &&
      /(pedestrian|footway|plaza|paving)/.test(id);

    if (isPedestrianPattern || isPedestrianScanline) {
      map.setLayoutProperty(layer.id, "visibility", "none");
      scanlineLayersHidden++;
    }
  }

  const roadLayers = styleLayers.filter((layer) => {
    if (
      layer.type !== "line" ||
      !("source" in layer) ||
      !("source-layer" in layer) ||
      layer["source-layer"] !== "transportation"
    ) return false;

    const id = layer.id.toLowerCase();
    return /(road|highway|bridge|tunnel)/.test(id) &&
      !/(rail|transit|hatching|neon-roads|lab-road)/.test(id);
  });

  if (roadLayers.length === 0) {
    console.warn("Map Lab: Liberty içinde araç yolu katmanı bulunamadı.");
    return false;
  }

  const isCasing = (id: string) => /_casing$/.test(id.toLowerCase());
  const isPedestrian = (id: string) =>
    /(pedestrian|footway|path|steps)/.test(id.toLowerCase());

  const asphaltColor = (id: string): string => {
    const lower = id.toLowerCase();
    const tunnel = lower.includes("tunnel");
    if (isPedestrian(lower)) return "#171f29";
    if (/motorway|trunk_primary/.test(lower)) return tunnel ? "#27313b" : "#3a4652";
    if (/secondary_tertiary|link/.test(lower)) return tunnel ? "#222c36" : "#303b47";
    if (/minor/.test(lower)) return tunnel ? "#1d2731" : "#29343f";
    if (/service_track/.test(lower)) return "#202a34";
    if (/street/.test(lower)) return "#252f3a";
    return "#2c3540";
  };

  let neonCasingCount = 0;
  let asphaltCount = 0;

  for (const layer of roadLayers) {
    const pedestrian = isPedestrian(layer.id);

    if (isCasing(layer.id)) {
      // Araç yollarında dış kenar cyan; yaya casing'i asfalt tonunda kalır.
      map.setPaintProperty(layer.id, "line-color", pedestrian ? "#171f29" : "#00eaff");
      map.setPaintProperty(layer.id, "line-opacity", pedestrian ? 0.98 : 0.96);
      if (!pedestrian) {
        neonCasingCount++;
      } else {
        map.setPaintProperty(layer.id, "line-width", [
          "interpolate", ["linear"], ["zoom"],
          14, 0.45, 16, 0.75, 18, 1.1, 20, 1.5
        ]);
      }
      continue;
    }

    map.setPaintProperty(layer.id, "line-color", asphaltColor(layer.id));
    map.setPaintProperty(layer.id, "line-opacity", 1);
    asphaltCount++;

    if (pedestrian) {
      map.setPaintProperty(layer.id, "line-width", [
        "interpolate", ["linear"], ["zoom"],
        13, 0.25, 15, 0.4, 17, 0.7, 20, 1.1
      ]);
    }
  }

  // Ayrı fill poligonları olarak tanımlanan meydan/yaya alanlarını koyulaştır.
  let pedestrianFillCount = 0;
  for (const layer of styleLayers) {
    const id = layer.id.toLowerCase();
    if (layer.type === "fill" && /(pedestrian|footway|plaza|square|pedestrian_area)/.test(id)) {
      map.setPaintProperty(layer.id, "fill-color", "#202a34");
      map.setPaintProperty(layer.id, "fill-opacity", 0.98);
      pedestrianFillCount++;
    }
  }

  console.info(
    `Map Lab: ${asphaltCount} asfalt yol merkezi, ${neonCasingCount} cyan yol kenarı, ${pedestrianFillCount} koyu yaya alanı, ${scanlineLayersHidden} beyaz tarama katmanı gizlendi.`
  );
  return true;
}


function styleAllBuildingLayers(map: MapLibreMap) {
  const buildingLayers = (map.getStyle().layers ?? []).filter((layer) =>
    /building/i.test(layer.id)
  );

  let darkFillCount = 0;
  let darkExtrusionCount = 0;
  let cyanOutlineCount = 0;

  for (const layer of buildingLayers) {
    if (layer.type === "fill") {
      // Liberty'nin standart, anıtsal ve kamusal bina poligonlarının tamamı.
      map.setPaintProperty(layer.id, "fill-color", "#102238");
      map.setPaintProperty(layer.id, "fill-opacity", 1);
      if (map.getPaintProperty(layer.id, "fill-outline-color") !== undefined) {
        map.setPaintProperty(layer.id, "fill-outline-color", "#00eaff");
      }
      darkFillCount++;
    } else if (layer.type === "fill-extrusion") {
      // Mevcut 3D hacmi koru; sadece gövde rengini tek lacivert palete sabitle.
      map.setPaintProperty(layer.id, "fill-extrusion-color", "#102238");
      darkExtrusionCount++;
    } else if (layer.type === "line") {
      // Stil tarafından ayrıca çizilen bina konturları da neon cyan olsun.
      map.setPaintProperty(layer.id, "line-color", "#00eaff");
      map.setPaintProperty(layer.id, "line-opacity", 0.9);
      cyanOutlineCount++;
    }
  }

  console.info(
    `Map Lab: ${darkFillCount} bina fill, ${darkExtrusionCount} 3D extrusion, ${cyanOutlineCount} cyan bina outline katmanı işlendi.`
  );
  return buildingLayers.length > 0;
}

function addNeonEnvironment(map: MapLibreMap) {
  const layers = map.getStyle().layers ?? [];
  let groundCount = 0;
  let greenCount = 0;
  let waterCount = 0;

  for (const layer of layers) {
    const id = layer.id.toLowerCase();

    // Su katmanları önce ele alınır; kıyı/nehir çizgileri de koyulaştırılır.
    if (/(^|[_-])(water|ocean|sea|river|lake|waterway)([_-]|$)/.test(id)) {
      if (layer.type === "fill") {
        map.setPaintProperty(layer.id, "fill-color", "#081b2e");
        map.setPaintProperty(layer.id, "fill-opacity", 0.98);
        waterCount++;
      } else if (layer.type === "line") {
        map.setPaintProperty(layer.id, "line-color", "#0b2940");
        map.setPaintProperty(layer.id, "line-opacity", 0.9);
        waterCount++;
      }
      continue;
    }

    // Park, çimen, orman, bahçe ve benzeri yeşil alanlar.
    // Landuse içindeki park/grass alanları da bu gruba girer.
    const isGreen =
      /(park|grass|wood|forest|garden|courtyard|meadow|recreation_ground|vegetation|scrub|orchard|village_green)/.test(id);

    if (isGreen && layer.type === "fill") {
      map.setPaintProperty(layer.id, "fill-color", "#2c8a4b");
      map.setPaintProperty(layer.id, "fill-opacity", 0.94);
      if (map.getPaintProperty(layer.id, "fill-outline-color") !== undefined) {
        map.setPaintProperty(layer.id, "fill-outline-color", "#3eb86e");
      }
      greenCount++;
      continue;
    }

    // Ana zemin ve yapılaşmış alan poligonları.
    // Yeşil ve su katmanları yukarıda ayrıldığı için bunların rengini ezmez.
    const isGround =
      id === "background" ||
      id === "land" ||
      /^(landcover|landuse|land-)/.test(id) ||
      /(residential|commercial|industrial|construction|urban|sand|rock|bare_rock)/.test(id);

    if (isGround && layer.type === "background") {
      map.setPaintProperty(layer.id, "background-color", "#050b16");
      groundCount++;
    } else if (isGround && layer.type === "fill") {
      map.setPaintProperty(layer.id, "fill-color", "#0a1220");
      map.setPaintProperty(layer.id, "fill-opacity", 0.96);
      groundCount++;
    }
  }

  console.info(
    `Map Lab: zemin ${groundCount}, yeşil alan ${greenCount}, su ${waterCount} katmanı gece paletine geçirildi.`
  );

  return { groundCount, greenCount, waterCount };
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
      const allBuildingLayersStyled = styleAllBuildingLayers(map);
      const roadsAdded = addNeonRoads(map);
      const environment = addNeonEnvironment(map);
      const environmentAdded = environment.groundCount + environment.greenCount + environment.waterCount > 0;
      setStatus(buildingsAdded && allBuildingLayersStyled && roadsAdded && environmentAdded ? "3D NEON · YOL · ZEMİN AKTİF" : "HARİTA AÇIK · KATMAN KONTROLÜ GEREKLİ");
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