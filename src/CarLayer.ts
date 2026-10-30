import * as THREE from "three";
import { MercatorCoordinate } from "maplibre-gl";
import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";

const CAR_LENGTH_METERS = 4.5;
const CAR_WIDTH_METERS = 1.8;
const CAR_HEIGHT_METERS = 1.5;
const CAR_CENTER_HEIGHT_METERS = 0.75;

export type InteractiveCarLayer = CustomLayerInterface & {
  setPosition: (lngLat: [number, number], bearingDegrees: number) => void;
};

export function createCarLayer(): InteractiveCarLayer {
  let renderer: THREE.WebGLRenderer | undefined;
  let mapRef: MapLibreMap | undefined;
  let currentLngLat: [number, number] = [0, 0];
  let currentBearingDegrees = 0;

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const car = new THREE.Group();
  car.frustumCulled = false;

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x7600ff,
    emissive: 0x32006f,
    emissiveIntensity: 1.1,
    metalness: 0.55,
    roughness: 0.28
  });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x071b35,
    emissive: 0x071b35,
    metalness: 0.65,
    roughness: 0.18
  });
  const wheelMaterial = new THREE.MeshStandardMaterial({
    color: 0x090d18,
    metalness: 0.25,
    roughness: 0.78
  });
  const rimMaterial = new THREE.MeshStandardMaterial({
    color:  0x00eaff,
    emissive: 0x00aacc,
    emissiveIntensity: 1.4,
    metalness: 0.8,
    roughness: 0.2
  });
  const headlightMaterial = new THREE.MeshBasicMaterial({ color: 0xc9fbff });
  const tailMaterial = new THREE.MeshBasicMaterial({ color: 0xff174d });

  const addBox = (
    name: string,
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    car.add(mesh);
    return mesh;
  };

  // Araç burnu yerel +Y yönünde; harita kuzeyi bearing=0 kabul edilir.
  addBox("chassis", [1.72, 4.35, 0.48], [0, 0, -0.08], bodyMaterial);
  addBox("hood", [1.68, 1.15, 0.18], [0, 1.48, 0.22], bodyMaterial);
  addBox("cabin", [1.42, 2.15, 0.58], [0, -0.05, 0.43], glassMaterial);
  addBox("roof-neon", [1.34, 1.75, 0.055], [0, -0.05, 0.74], rimMaterial);
  addBox("front-bumper", [1.78, 0.16, 0.16], [0, 2.18, -0.2], rimMaterial);
  addBox("rear-bumper", [1.78, 0.16, 0.16], [0, -2.18, -0.2], rimMaterial);

  for (const x of [-0.88, 0.88]) {
    addBox("headlight", [0.28, 0.08, 0.13], [x, 2.12, 0.08], headlightMaterial);
    addBox("tail-light", [0.28, 0.08, 0.13], [x, -2.12, 0.08], tailMaterial);
  }

  const wheelGeometry = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 16);
  const rimGeometry = new THREE.CylinderGeometry(0.17, 0.17, 0.235, 12);
  const wheels: THREE.Group[] = [];
  for (const x of [-0.91, 0.91]) {
    for (const y of [-1.42, 1.42]) {
      const wheel = new THREE.Group();
      wheel.position.set(x, y, -0.43);
      const tire = new THREE.Mesh(wheelGeometry, wheelMaterial);
      tire.rotation.z = Math.PI / 2;
      wheel.add(tire);
      const rim = new THREE.Mesh(rimGeometry, rimMaterial);
      rim.rotation.z = Math.PI / 2;
      wheel.add(rim);
      car.add(wheel);
      wheels.push(wheel);
    }
  }

  scene.add(car);

  const setPosition = (lngLat: [number, number], bearingDegrees: number) => {
    currentLngLat = [lngLat[0], lngLat[1]];
    currentBearingDegrees = bearingDegrees;
    if (!mapRef) return;

    const ground = MercatorCoordinate.fromLngLat(currentLngLat, 0);
    const meterScale = ground.meterInMercatorCoordinateUnits();
    car.position.set(
      ground.x,
      ground.y,
      ground.z + CAR_CENTER_HEIGHT_METERS * meterScale
    );
    // Three.js custom layer koordinatlarında Z dikeydir. 0° kuzey, 90° doğudur.
    car.rotation.set(0, 0, THREE.MathUtils.degToRad(currentBearingDegrees));
    car.scale.set(meterScale, -meterScale, meterScale);
    car.updateMatrix();
    car.updateMatrixWorld(true);
    mapRef.triggerRepaint();
  };

  const layer: InteractiveCarLayer = {
    id: "3d-car-layer",
    type: "custom",
    renderingMode: "3d",
    setPosition,
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
      setPosition(currentLngLat, currentBearingDegrees);
      console.info("[THREE CAR] Model ready", {
        dimensionsMeters: {
          length: CAR_LENGTH_METERS,
          width: CAR_WIDTH_METERS,
          height: CAR_HEIGHT_METERS
        },
        groundCenterHeightMeters: CAR_CENTER_HEIGHT_METERS,
        wheelCount: wheels.length,
        startLngLat: currentLngLat
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
      car.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
        }
      });
      bodyMaterial.dispose();
      glassMaterial.dispose();
      wheelMaterial.dispose();
      rimMaterial.dispose();
      headlightMaterial.dispose();
      tailMaterial.dispose();
      renderer?.dispose();
      renderer = undefined;
      mapRef = undefined;
    }
  };

  return layer;
}
