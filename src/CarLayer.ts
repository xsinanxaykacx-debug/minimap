import * as THREE from "three";
import { MercatorCoordinate } from "maplibre-gl";
import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";

const BLOCK_LENGTH_METERS = 15;
const BLOCK_WIDTH_METERS = 8;
const BLOCK_HEIGHT_METERS = 5;
const BLOCK_CENTER_HEIGHT_METERS = 2.5;
const DEFAULT_BEARING_DEGREES = 90;

export type InteractiveCarLayer = CustomLayerInterface & {
  setPosition: (lngLat: [number, number], bearingDegrees?: number) => void;
};

export function createCarLayer(): InteractiveCarLayer {
  let renderer: THREE.WebGLRenderer | undefined;
  let mapRef: MapLibreMap | undefined;
  let renderLogged = false;
  let currentLngLat: [number, number] = [0, 0];
  let currentBearingDegrees = DEFAULT_BEARING_DEGREES;

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const geometry = new THREE.BoxGeometry(BLOCK_WIDTH_METERS, BLOCK_LENGTH_METERS, BLOCK_HEIGHT_METERS);
  const material = new THREE.MeshBasicMaterial({
    color: 0xb000ff, side: THREE.DoubleSide, depthTest: false, depthWrite: false
  });
  const object = new THREE.Mesh(geometry, material);
  object.frustumCulled = false;
  scene.add(object);

  const updateObjectPosition = (lngLat: [number, number], bearingDegrees = DEFAULT_BEARING_DEGREES) => {
    currentLngLat = [lngLat[0], lngLat[1]];
    currentBearingDegrees = bearingDegrees;
    if (!mapRef) return;

    const ground = MercatorCoordinate.fromLngLat(currentLngLat, 0);
    const meterScale = ground.meterInMercatorCoordinateUnits();
    object.position.set(ground.x, ground.y, ground.z + BLOCK_CENTER_HEIGHT_METERS * meterScale);
    // Bu custom layer'da Z dikey eksendir; 90° yaw, uzun kenarı doğu-batıya çevirir.
    object.rotation.set(0, 0, THREE.MathUtils.degToRad(currentBearingDegrees));
    object.scale.set(meterScale, -meterScale, meterScale);
    object.updateMatrix();
    object.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(object);
    const pixel = mapRef.project(currentLngLat);
    console.info("[THREE PURPLE DEBUG] position updated", {
      lngLat: currentLngLat, pixel: [pixel.x, pixel.y],
      bearingDegrees: currentBearingDegrees,
      dimensionsMeters: { length: BLOCK_LENGTH_METERS, width: BLOCK_WIDTH_METERS, height: BLOCK_HEIGHT_METERS },
      centerHeightMeters: BLOCK_CENTER_HEIGHT_METERS,
      objectPosition: object.position.toArray(), objectRotation: object.rotation.toArray(),
      objectScale: object.scale.toArray(),
      worldBounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }
    });
    mapRef.triggerRepaint();
  };

  const layer: InteractiveCarLayer = {
    id: "3d-car-layer", type: "custom", renderingMode: "3d",
    setPosition(lngLat, bearingDegrees = DEFAULT_BEARING_DEGREES) {
      updateObjectPosition(lngLat, bearingDegrees);
    },
    onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      mapRef = map;
      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true, alpha: true });
      renderer.autoClear = false;
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
      const center = map.getCenter();
      updateObjectPosition([center.lng, center.lat], DEFAULT_BEARING_DEGREES);
      console.info("[THREE PURPLE DEBUG] onAdd", {
        initialLngLat: currentLngLat, initialBearingDegrees: currentBearingDegrees,
        canvas: { width: map.getCanvas().width, height: map.getCanvas().height }
      });
      map.triggerRepaint();
    },
    render(_gl, options) {
      if (!renderer) return;
      camera.projectionMatrix.fromArray(Array.from(options.defaultProjectionData.mainMatrix));
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      camera.matrixWorld.identity();
      camera.matrixWorldInverse.identity();
      camera.matrixAutoUpdate = false;
      renderer.resetState();
      renderer.render(scene, camera);
      if (!renderLogged) {
        const clip = new THREE.Vector4(object.position.x, object.position.y, object.position.z, 1)
          .applyMatrix4(camera.projectionMatrix);
        console.info("[THREE PURPLE DEBUG] first render", {
          clipPosition: clip.toArray(),
          clipInsideView: clip.w > 0 && Math.abs(clip.x) <= clip.w &&
            Math.abs(clip.y) <= clip.w && Math.abs(clip.z) <= clip.w,
          layerPresent: Boolean(mapRef?.getLayer("3d-car-layer")),
          lngLat: currentLngLat, bearingDegrees: currentBearingDegrees
        });
        renderLogged = true;
      }
    },
    onRemove() {
      geometry.dispose(); material.dispose(); renderer?.dispose();
      renderer = undefined; mapRef = undefined;
    }
  };
  return layer;
}
