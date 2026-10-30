import * as THREE from "three";
import { MercatorCoordinate } from "maplibre-gl";
import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";

const CAR_ORIGIN: [number, number] = [28.9768, 41.0054];
const CAR_LENGTH_METERS = 4;
const CAR_WIDTH_METERS = 2;

function makeMaterial(color: number, emissive = 0, metalness = 0.45, roughness = 0.3) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: emissive ? 1.25 : 0,
    metalness,
    roughness
  });
}

export function createCarLayer(): CustomLayerInterface {
  let renderer: THREE.WebGLRenderer | undefined;
  let mapRef: MapLibreMap | undefined;
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const car = new THREE.Group();
  const geometry: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const addMesh = (mesh: THREE.Mesh, parent: THREE.Object3D = car) => {
    parent.add(mesh);
    geometry.push(mesh.geometry);
    const material = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.push(...material);
    return mesh;
  };

  const bodyMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  const glassMat = new THREE.MeshBasicMaterial({ color: 0xffd700 });
  const cyanMat = new THREE.MeshBasicMaterial({ color: 0xffd700 });
  const magentaMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  const rubberMat = makeMaterial(0x080d16, 0, 0.05, 0.85);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const rearMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });

  const box = (w: number, l: number, h: number, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, l, h), material);
    mesh.position.set(x, y, z);
    return addMesh(mesh);
  };

  // Gövde, burun +Y; başlangıçta kuzeye bakması için grup 180 derece döndürülür.
  box(CAR_WIDTH_METERS, CAR_LENGTH_METERS, 0.72, bodyMat, 0, 0, 0.42);
  box(1.65, 1.75, 0.48, glassMat, 0, -0.05, 1.02);
  box(1.82, 0.55, 0.16, bodyMat, 0, 1.65, 0.55);
  box(1.82, 0.45, 0.13, bodyMat, 0, -1.7, 0.55);
  box(1.98, 3.85, 0.06, cyanMat, 0, 0, 0.79);
  box(2.02, 0.08, 0.12, cyanMat, 0, 1.92, 0.55);
  box(2.02, 0.08, 0.12, rearMat, 0, -1.96, 0.55);
  box(0.12, 3.1, 0.1, magentaMat, -0.98, 0, 0.55);
  box(0.12, 3.1, 0.1, magentaMat, 0.98, 0, 0.55);
  box(0.42, 0.12, 0.1, headMat, -0.62, 2.0, 0.55);
  box(0.42, 0.12, 0.1, headMat, 0.62, 2.0, 0.55);
  box(0.48, 0.12, 0.1, rearMat, -0.62, -2.0, 0.55);
  box(0.48, 0.12, 0.1, rearMat, 0.62, -2.0, 0.55);

  for (const x of [-1.02, 1.02]) {
    for (const y of [-1.28, 1.28]) {
      const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.82, 0.58), rubberMat);
      wheel.position.set(x, y, 0.48);
      addMesh(wheel);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 12), cyanMat);
      hub.rotation.x = Math.PI / 2;
      hub.position.set(x * 1.12, y, 0.48);
      addMesh(hub);
    }
  }

  // Zemine oturan neon halo: transparan disk ve iki ince cyan halka.
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(2.15, 48),
    new THREE.MeshBasicMaterial({ color: 0x00dfff, transparent: true, opacity: 0.17, depthWrite: false, side: THREE.DoubleSide })
  );
  halo.position.z = 0.035;
  addMesh(halo);
  for (const radius of [1.85, 2.05]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius, radius + 0.035, 64),
      new THREE.MeshBasicMaterial({ color: 0x00eaff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide })
    );
    ring.position.z = 0.045;
    addMesh(ring);
  }

  scene.add(car);
  scene.add(new THREE.AmbientLight(0xb9eaff, 1.7));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(-5, -7, 12);
  scene.add(keyLight);
  const cyanLight = new THREE.PointLight(0x00dfff, 22, 18);
  cyanLight.position.set(0, 0, 3.5);
  scene.add(cyanLight);

  const layer: CustomLayerInterface = {
    id: "3d-car-layer",
    type: "custom",
    renderingMode: "3d",
    onAdd(map, gl) {
      mapRef = map;
      renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
        alpha: true
      });
      renderer.autoClear = false;
      const mercator = MercatorCoordinate.fromLngLat({ lng: CAR_ORIGIN[0], lat: CAR_ORIGIN[1] }, 0);
      const scale = mercator.meterInMercatorCoordinateUnits();
      console.info("[3D CAR] Sultanahmet anchor", { lng: CAR_ORIGIN[0], lat: CAR_ORIGIN[1], mercator: { x: mercator.x, y: mercator.y, z: 0 }, sizeMeters: { length: CAR_LENGTH_METERS, width: CAR_WIDTH_METERS }, meterScale: scale });
      car.position.set(mercator.x, mercator.y, 0);
      car.rotation.set(0, 0, 0);
      car.scale.setScalar(scale);
      map.triggerRepaint();
    },
    render(_gl, options) {
      if (!renderer) return;
      const matrixValues = Array.from(options.modelViewProjectionMatrix);
      const mvp = new THREE.Matrix4().fromArray(matrixValues);
      if (!(layer as CustomLayerInterface & { __matrixLogged?: boolean }).__matrixLogged) {
        console.info("[3D CAR] MapLibre MVP matrix", matrixValues);
        (layer as CustomLayerInterface & { __matrixLogged?: boolean }).__matrixLogged = true;
      }
      camera.projectionMatrix.copy(mvp);
      camera.projectionMatrixInverse.copy(mvp).invert();
      camera.matrixWorld.identity();
      camera.matrixWorldInverse.identity();
      camera.matrixAutoUpdate = false;
      renderer.resetState();
      renderer.render(scene, camera);
    },
    onRemove() {
      for (const item of geometry) item.dispose();
      for (const item of materials) item.dispose();
      renderer?.dispose();
      renderer = undefined;
      mapRef = undefined;
    }
  };

  return layer;
}

