import * as THREE from "three";
import { MercatorCoordinate } from "maplibre-gl";
import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";

const CUBE_ORIGIN: [number, number] = [28.9768, 41.0054];
const CUBE_SIZE_METERS = 50;
const CUBE_LIFT_METERS = 35;

export function createCarLayer(): CustomLayerInterface {
  let renderer: THREE.WebGLRenderer | undefined;

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();

  const geometry = new THREE.BoxGeometry(CUBE_SIZE_METERS, CUBE_SIZE_METERS, CUBE_SIZE_METERS);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    side: THREE.DoubleSide
  });
  const cube = new THREE.Mesh(geometry, material);
  cube.frustumCulled = false;
  scene.add(cube);

  const layer: CustomLayerInterface = {
    id: "3d-car-layer",
    type: "custom",
    renderingMode: "3d",

    onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
        alpha: true
      });
      renderer.autoClear = false;
      renderer.setPixelRatio(1);

      // İstenen koordinat önce sıfır irtifada Mercator'a çevrilir.
      const origin = MercatorCoordinate.fromLngLat(CUBE_ORIGIN, 0);
      const meterScale = origin.meterInMercatorCoordinateUnits();

      // 50 m küpün merkezi yerden 35 m yukarıda: yaklaşık 10–60 m irtifa.
      cube.position.set(
        origin.x,
        origin.y,
        origin.z + CUBE_LIFT_METERS * meterScale
      );
      cube.scale.setScalar(meterScale);
      cube.updateMatrix();
      cube.updateMatrixWorld(true);

      console.info("[THREE CUBE] Eklendi", {
        lngLat: CUBE_ORIGIN,
        mercatorOrigin: { x: origin.x, y: origin.y, z: origin.z },
        cubeSizeMeters: CUBE_SIZE_METERS,
        liftMeters: CUBE_LIFT_METERS,
        meterScale,
        cubePosition: cube.position.toArray(),
        cubeScale: cube.scale.toArray()
      });

      map.triggerRepaint();
    },

    render(_gl, options) {
      if (!renderer) return;

      // MapLibre 6'nın kamera/projeksiyon matrisi; model matrisi Three.js
      // tarafından küpün Mercator konumu ve ölçeğiyle ayrıca uygulanır.
      camera.projectionMatrix.fromArray(
        Array.from(options.defaultProjectionData.mainMatrix)
      );
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      camera.matrixWorld.identity();
      camera.matrixWorldInverse.identity();
      camera.matrixAutoUpdate = false;

      renderer.resetState();
      renderer.render(scene, camera);
    },

    onRemove() {
      geometry.dispose();
      material.dispose();
      renderer?.dispose();
      renderer = undefined;
    }
  };

  return layer;
}
