import * as THREE from "three";
import { MercatorCoordinate } from "maplibre-gl";
import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";

const CAR_ORIGIN: [number, number] = [28.9768, 41.0054];
const DEBUG_ALTITUDE_METERS = 50;
const DEBUG_SCALE = 50;

export function createCarLayer(): CustomLayerInterface {
  let renderer: THREE.WebGLRenderer | undefined;
  let mapRef: MapLibreMap | undefined;

  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const car = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

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
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.frustumCulled = false;
    car.add(mesh);
    geometries.push(geometry);
    materials.push(material);
    return mesh;
  };

  // Tek parça, dev sarı blok: bu aşamada araç ayrıntısı değil görünürlük test ediliyor.
  const yellow = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false
  });
  addBox(2 * DEBUG_SCALE, 4 * DEBUG_SCALE, 0.72 * DEBUG_SCALE, yellow, 0, 0, 0);

  // Kutuya üstten bakıldığında yönü ve hacmi belli olsun diye ikinci sarı üst parça.
  const top = new THREE.MeshBasicMaterial({
    color: 0xffb800,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false
  });
  addBox(1.5 * DEBUG_SCALE, 1.8 * DEBUG_SCALE, 0.5 * DEBUG_SCALE, top, 0, -2.5 * DEBUG_SCALE, 0.61 * DEBUG_SCALE);

  scene.add(car);

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
      renderer.setPixelRatio(1);

      const mercator = MercatorCoordinate.fromLngLat(
        { lng: CAR_ORIGIN[0], lat: CAR_ORIGIN[1] },
        DEBUG_ALTITUDE_METERS
      );
      const meterScale = mercator.meterInMercatorCoordinateUnits();

      car.position.set(mercator.x, mercator.y, mercator.z);
      car.rotation.set(0, 0, 0);
      car.scale.setScalar(meterScale);
      car.updateMatrix();
      car.updateMatrixWorld(true);

      const center = map.getCenter();
      console.info("[3D CAR DEBUG] Sabitlenen blok", {
        carLngLat: CAR_ORIGIN,
        mapCenter: { lng: center.lng, lat: center.lat },
        centerDifferenceDegrees: {
          lng: center.lng - CAR_ORIGIN[0],
          lat: center.lat - CAR_ORIGIN[1]
        },
        altitudeMeters: DEBUG_ALTITUDE_METERS,
        scaleMultiplier: DEBUG_SCALE,
        geometryMeters: {
          width: 2 * DEBUG_SCALE,
          length: 4 * DEBUG_SCALE,
          height: 0.72 * DEBUG_SCALE
        },
        mercator: { x: mercator.x, y: mercator.y, z: mercator.z },
        meterScale,
        worldPosition: car.position.toArray(),
        worldScale: car.scale.toArray()
      });

      map.triggerRepaint();
    },

    render(_gl, options) {
      if (!renderer) return;

      // MapLibre MVP, Mercator dünya koordinatlarını clip-space'e taşır.
      // Three.js ayrıca mesh'in model matrisini çarptığı için önce model matrisini
      // MVP'den çıkarıp kamera matrisine yalnızca view-projection bırakıyoruz.
      car.updateMatrixWorld(true);
      const mapMvp = new THREE.Matrix4().fromArray(
        Array.from(options.modelViewProjectionMatrix)
      );
      const inverseModel = car.matrixWorld.clone().invert();
      const viewProjection = mapMvp.clone().multiply(inverseModel);

      camera.projectionMatrix.copy(viewProjection);
      camera.projectionMatrixInverse.copy(viewProjection).invert();
      camera.matrixWorld.identity();
      camera.matrixWorldInverse.identity();
      camera.matrixAutoUpdate = false;

      const originClip = new THREE.Vector4(
        car.position.x,
        car.position.y,
        car.position.z,
        1
      ).applyMatrix4(mapMvp);

      const diagnosticLayer = layer as CustomLayerInterface & {
        __debugLogged?: boolean;
      };
      if (!diagnosticLayer.__debugLogged) {
        const center = mapRef?.getCenter();
        console.info("[3D CAR DEBUG] Render matrisi", {
          mapCenter: center ? { lng: center.lng, lat: center.lat } : null,
          carMercator: car.position.toArray(),
          clipPosition: originClip.toArray(),
          clipInsideView: Math.abs(originClip.x) <= originClip.w &&
            Math.abs(originClip.y) <= originClip.w &&
            Math.abs(originClip.z) <= originClip.w,
          mapMvp: mapMvp.toArray(),
          modelMatrix: car.matrixWorld.toArray(),
          cameraProjection: viewProjection.toArray()
        });
        diagnosticLayer.__debugLogged = true;
      }

      renderer.resetState();
      renderer.render(scene, camera);
    },

    onRemove() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      renderer?.dispose();
      renderer = undefined;
      mapRef = undefined;
    }
  };

  return layer;
}
