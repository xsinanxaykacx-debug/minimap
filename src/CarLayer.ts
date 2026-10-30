import * as THREE from "three";
import { MercatorCoordinate } from "maplibre-gl";
import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";

const CAR_ORIGIN: [number, number] = [28.9768, 41.0054];
const CAR_LENGTH_METERS = 4;
const CAR_WIDTH_METERS = 2;

export function createCarLayer(): CustomLayerInterface {
  let renderer: THREE.WebGLRenderer | undefined;

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const car = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const makeMaterial = (color: number, metalness = 0, roughness = 0.45) => {
    const material = new THREE.MeshStandardMaterial({
      color,
      metalness,
      roughness,
      side: THREE.DoubleSide
    });
    materials.push(material);
    return material;
  };

  const addBox = (
    width: number,
    length: number,
    height: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number
  ) => {
    const geometry = new THREE.BoxGeometry(width, length, height);
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.frustumCulled = false;
    car.add(mesh);
    return mesh;
  };

  const addWheel = (x: number, y: number) => {
    // Cylinder'ın eksenini X'e çevirerek tekerleği aracın yanına yerleştir.
    const geometry = new THREE.CylinderGeometry(0.32, 0.32, 0.2, 10);
    geometries.push(geometry);
    const wheel = new THREE.Mesh(geometry, makeMaterial(0x090d16, 0.05, 0.85));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, y, 0.32);
    wheel.frustumCulled = false;
    car.add(wheel);

    const hubGeometry = new THREE.CylinderGeometry(0.13, 0.13, 0.205, 8);
    geometries.push(hubGeometry);
    const hub = new THREE.Mesh(hubGeometry, makeMaterial(0x00eaff, 0.65, 0.25));
    hub.rotation.z = Math.PI / 2;
    hub.position.set(x, y, 0.32);
    hub.frustumCulled = false;
    car.add(hub);
  };

  const bodyMaterial = makeMaterial(0x9b35ff, 0.55, 0.24);
  const glassMaterial = makeMaterial(0x101d35, 0.35, 0.18);
  const trimMaterial = makeMaterial(0x00eaff, 0.45, 0.22);
  const headlightMaterial = makeMaterial(0xc8ffff, 0.2, 0.12);
  const rearLightMaterial = makeMaterial(0xff2b9d, 0.2, 0.16);

  // Aracın burnu -Y yönünde (Mercator'da kuzey). Modelin toplamı 4 x 2 metre.
  addBox(1.72, 3.65, 0.48, bodyMaterial, 0, 0, 0.66);
  addBox(1.48, 1.85, 0.66, glassMaterial, 0, 0.05, 1.18);
  addBox(1.55, 0.12, 0.045, trimMaterial, 0, -1.82, 0.66);
  addBox(1.55, 0.10, 0.045, trimMaterial, 0, 1.82, 0.66);

  // Ön farlar ve arka stoplar.
  addBox(0.34, 0.10, 0.12, headlightMaterial, -0.58, -1.84, 0.68);
  addBox(0.34, 0.10, 0.12, headlightMaterial, 0.58, -1.84, 0.68);
  addBox(0.32, 0.10, 0.12, rearLightMaterial, -0.58, 1.84, 0.68);
  addBox(0.32, 0.10, 0.12, rearLightMaterial, 0.58, 1.84, 0.68);

  // Dört tekerleğin tabanı z=0 düzlemine oturur.
  addWheel(-0.92, -1.22);
  addWheel(0.92, -1.22);
  addWheel(-0.92, 1.22);
  addWheel(0.92, 1.22);

  scene.add(car);

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
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;

      const origin = MercatorCoordinate.fromLngLat(CAR_ORIGIN, 0);
      const meterScale = origin.meterInMercatorCoordinateUnits();

      // Group origin is ground level. Wheel centers are 0.32 m high,
      // exactly matching the 0.32 m wheel radius.
      car.position.set(origin.x, origin.y, origin.z);
      car.scale.set(meterScale, -meterScale, meterScale);
      car.updateMatrix();
      car.updateMatrixWorld(true);

      console.info("[THREE CAR] Yerleştirildi", {
        lngLat: CAR_ORIGIN,
        dimensionsMeters: { length: CAR_LENGTH_METERS, width: CAR_WIDTH_METERS },
        wheelBottomMeters: 0,
        meterScale,
        mercatorPosition: car.position.toArray(),
        mercatorScale: car.scale.toArray()
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
    },

    onRemove() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      renderer?.dispose();
      renderer = undefined;
    }
  };

  return layer;
}
