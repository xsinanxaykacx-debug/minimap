import * as THREE from "three";
import { MercatorCoordinate } from "maplibre-gl";
import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";

const TEST_ORIGIN: [number, number] = [28.9745, 41.0035];
const TEST_LENGTH_METERS = 40;
const TEST_WIDTH_METERS = 20;
const TEST_HEIGHT_METERS = 10;
const TEST_CENTER_HEIGHT_METERS = TEST_HEIGHT_METERS / 2;

export function createCarLayer(): CustomLayerInterface {
  let renderer: THREE.WebGLRenderer | undefined;
  let mapRef: MapLibreMap | undefined;
  let renderLogged = false;

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();

  // Aşama teşhisi: gerçek araç yerine 10 kat büyütülmüş, ışığa ihtiyaç
  // duymayan mor blok. Böylece malzeme/ışık kaynaklı görünmezlik elenir.
  const geometry = new THREE.BoxGeometry(
    TEST_WIDTH_METERS,
    TEST_LENGTH_METERS,
    TEST_HEIGHT_METERS
  );
  const material = new THREE.MeshBasicMaterial({
    color: 0xb000ff,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false
  });
  const object = new THREE.Mesh(geometry, material);
  object.frustumCulled = false;
  scene.add(object);

  const layer: CustomLayerInterface = {
    id: "3d-car-layer",
    type: "custom",
    renderingMode: "3d",

    onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      mapRef = map;
      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
        alpha: true
      });
      renderer.autoClear = false;
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;

      const ground = MercatorCoordinate.fromLngLat(TEST_ORIGIN, 0);
      const meterScale = ground.meterInMercatorCoordinateUnits();

      // Blok tabanı yol kotunda: merkez yüksekliği, bloğun yarı yüksekliği.
      object.position.set(
        ground.x,
        ground.y,
        ground.z + TEST_CENTER_HEIGHT_METERS * meterScale
      );
      object.scale.set(meterScale, -meterScale, meterScale);
      object.updateMatrix();
      object.updateMatrixWorld(true);

      const bounds = new THREE.Box3().setFromObject(object);
      const mapCenter = map.getCenter();
      console.info("[THREE PURPLE DEBUG] onAdd", {
        mapCenter: [mapCenter.lng, mapCenter.lat],
        targetLngLat: TEST_ORIGIN,
        targetPixel: (() => { const p = map.project(TEST_ORIGIN); return [p.x, p.y]; })(),
        mercatorGround: [ground.x, ground.y, ground.z],
        meterScale,
        objectPosition: object.position.toArray(),
        objectScale: object.scale.toArray(),
        dimensionsMeters: {
          length: TEST_LENGTH_METERS,
          width: TEST_WIDTH_METERS,
          height: TEST_HEIGHT_METERS
        },
        centerHeightMeters: TEST_CENTER_HEIGHT_METERS,
        worldBounds: {
          min: bounds.min.toArray(),
          max: bounds.max.toArray()
        },
        canvas: {
          width: map.getCanvas().width,
          height: map.getCanvas().height
        }
      });

      map.triggerRepaint();
    },

    render(_gl, options) {
      if (!renderer) return;

      camera.projectionMatrix.fromArray(
        Array.from(options.defaultProjectionData.mainMatrix)
      );
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      camera.matrixWorld.identity();
      camera.matrixWorldInverse.identity();
      camera.matrixAutoUpdate = false;

      renderer.resetState();
      renderer.render(scene, camera);

      if (!renderLogged) {
        const clip = new THREE.Vector4(
          object.position.x,
          object.position.y,
          object.position.z,
          1
        ).applyMatrix4(camera.projectionMatrix);
        console.info("[THREE PURPLE DEBUG] render", {
          clipPosition: clip.toArray(),
          clipInsideView:
            clip.w > 0 &&
            Math.abs(clip.x) <= clip.w &&
            Math.abs(clip.y) <= clip.w &&
            Math.abs(clip.z) <= clip.w,
          layerPresent: Boolean(mapRef?.getLayer("3d-car-layer")),
          mapCenter: mapRef?.getCenter().toArray()
        });
        renderLogged = true;
      }
    },

    onRemove() {
      geometry.dispose();
      material.dispose();
      renderer?.dispose();
      renderer = undefined;
      mapRef = undefined;
    }
  };

  return layer;
}
