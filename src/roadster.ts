import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/** Dimensiones del modelo (unidades del mundo, 1 ≈ 1 m). */
export const CAR_LENGTH = 4.6;
export const CAR_WIDTH = 2.0;
export const CAR_HEIGHT = 1.45;

// Ano White, cristal dorado, titanio: los materiales del Roadster 2026.
const ANO_WHITE = new THREE.MeshStandardMaterial({ color: 0xf4f4f1, metalness: 0.35, roughness: 0.42 });
const GOLD_GLASS = new THREE.MeshPhysicalMaterial({
  color: 0xd19a2c, metalness: 1, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05,
  transparent: true, opacity: 0.94,
});
const DARK = new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.2, roughness: 0.75 });
const TITANIUM = new THREE.MeshStandardMaterial({ color: 0x8e9398, metalness: 0.95, roughness: 0.28 });
const TAIL_LIGHT = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff1010, emissiveIntensity: 2.2 });
const TYRE = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.95 });

export interface Roadster {
  group: THREE.Group;
  /** Grupo interno que recibe cabeceo y barrel roll, separado de la posición. */
  body: THREE.Group;
  wheels: THREE.Mesh[];
  /** Toberas traseras (locales al body). Empuje hacia -X. */
  rearNozzles: THREE.Vector3[];
  /** Toberas de esquina (locales al body). Empuje hacia -Y. */
  cornerNozzles: THREE.Vector3[];
  tailLight: THREE.MeshStandardMaterial;
  /** Interior de las toberas: emisivo azul hielo cuando el nitro está listo. */
  nozzleGlow: THREE.MeshStandardMaterial;
  /** Carrocería procedural, se sustituye por el modelo glTF al cargar. */
  placeholder: THREE.Group;
  /** Ruedas del modelo cargado con su eje local de giro. */
  modelWheels: { node: THREE.Object3D; axis: THREE.Vector3 }[];
}

function profile(points: [number, number][], depth: number, bevel = 0.06): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, steps: 1, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/** Estrecha la carrocería hacia el morro, como la cuña del SR-71. */
function taperToNose(geo: THREE.BufferGeometry, amount: number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getX(i) + CAR_LENGTH / 2) / CAR_LENGTH;
    pos.setZ(i, pos.getZ(i) * (1 - amount * THREE.MathUtils.clamp(t, 0, 1)));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function buildRoadster(): Roadster {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const placeholder = new THREE.Group();
  body.add(placeholder);

  // Carrocería: cuña baja, morro afilado, cola alta.
  const bodyGeo = profile([
    [-2.3, 0.30], [2.3, 0.26], [2.3, 0.5], [1.85, 0.62], [0.85, 0.8], [-0.5, 0.94], [-1.75, 1.0], [-2.3, 0.94],
  ], CAR_WIDTH, 0.07);
  taperToNose(bodyGeo, 0.16);
  placeholder.add(mesh(bodyGeo, ANO_WHITE));

  // Canopy de cristal dorado, visor de astronauta.
  const canopyGeo = profile([
    [1.0, 0.74], [-0.05, 1.36], [-1.25, 1.44], [-2.0, 1.02], [-2.0, 0.84], [-0.5, 0.88],
  ], CAR_WIDTH * 0.74, 0.05);
  taperToNose(canopyGeo, 0.1);
  placeholder.add(mesh(canopyGeo, GOLD_GLASS));

  // Barra del techo T-top (titanio) y arco trasero.
  placeholder.add(mesh(new THREE.BoxGeometry(1.2, 0.04, CAR_WIDTH * 0.76), TITANIUM, -0.75, 1.46, 0));
  placeholder.add(mesh(new THREE.BoxGeometry(0.06, 0.5, CAR_WIDTH * 0.78), DARK, -1.95, 1.2, 0));

  // Barra de luz trasera de lado a lado.
  const tail = TAIL_LIGHT.clone();
  placeholder.add(mesh(new THREE.BoxGeometry(0.06, 0.07, CAR_WIDTH * 0.92), tail, -2.34, 0.86, 0));

  // Faros ocultos: dos ranuras oscuras en el morro.
  placeholder.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.42), DARK, 2.31, 0.47, 0.5));
  placeholder.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.42), DARK, 2.31, 0.47, -0.5));

  // Alerón trasero activo.
  placeholder.add(mesh(new THREE.BoxGeometry(0.55, 0.05, CAR_WIDTH * 0.98), DARK, -2.05, 1.18, 0));
  placeholder.add(mesh(new THREE.BoxGeometry(0.1, 0.22, 0.06), TITANIUM, -2.1, 1.07, 0.7));
  placeholder.add(mesh(new THREE.BoxGeometry(0.1, 0.22, 0.06), TITANIUM, -2.1, 1.07, -0.7));

  // Difusor y bajos.
  placeholder.add(mesh(new THREE.BoxGeometry(CAR_LENGTH * 0.9, 0.06, CAR_WIDTH * 0.9), DARK, 0, 0.27, 0));

  // Ruedas con disco aero.
  const wheels: THREE.Mesh[] = [];
  const tyreGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.34, 28);
  tyreGeo.rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.36, 28);
  rimGeo.rotateX(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.4, 12);
  hubGeo.rotateX(Math.PI / 2);
  for (const x of [1.5, -1.5]) {
    for (const z of [CAR_WIDTH / 2 - 0.12, -(CAR_WIDTH / 2 - 0.12)]) {
      const w = new THREE.Group();
      w.position.set(x, 0.4, z);
      const tyre = mesh(tyreGeo, TYRE);
      w.add(tyre, mesh(rimGeo, TITANIUM), mesh(hubGeo, DARK));
      placeholder.add(w);
      wheels.push(tyre);
    }
  }

  // Toberas de gas frío: 4 traseras (Thrust) + 4 en esquinas + 2 delanteras (Rocket).
  const nozzleGlow = new THREE.MeshStandardMaterial({ color: 0x15161a, emissive: 0x9fd8ff, emissiveIntensity: 0, roughness: 0.7 });
  const nozzleGeo = new THREE.CylinderGeometry(0.07, 0.12, 0.26, 14, 1, true);
  const nozzleInner = new THREE.CylinderGeometry(0.06, 0.1, 0.24, 14);
  const rearNozzles: THREE.Vector3[] = [];
  for (const z of [-0.62, -0.22, 0.22, 0.62]) {
    const n = new THREE.Group();
    n.position.set(-2.38, 0.56, z);
    n.rotation.z = Math.PI / 2;
    n.add(mesh(nozzleGeo, TITANIUM), mesh(nozzleInner, nozzleGlow));
    body.add(n);
    rearNozzles.push(new THREE.Vector3(-2.52, 0.56, z));
  }
  const cornerNozzles: THREE.Vector3[] = [];
  for (const x of [1.95, -1.95]) {
    for (const z of [0.72, -0.72]) {
      const n = new THREE.Group();
      n.position.set(x, 0.34, z);
      n.rotation.x = Math.PI;
      n.add(mesh(nozzleGeo, TITANIUM), mesh(nozzleInner, nozzleGlow));
      body.add(n);
      cornerNozzles.push(new THREE.Vector3(x, 0.2, z));
    }
  }
  for (const z of [0.78, -0.78]) {
    const n = new THREE.Group();
    n.position.set(2.0, 0.42, z);
    n.rotation.x = z > 0 ? -Math.PI / 2 : Math.PI / 2;
    n.add(mesh(nozzleGeo, TITANIUM), mesh(nozzleInner, nozzleGlow));
    body.add(n);
  }

  (TITANIUM as THREE.MeshStandardMaterial).side = THREE.DoubleSide;

  return { group, body, wheels, rearNozzles, cornerNozzles, tailLight: tail, nozzleGlow, placeholder, modelWheels: [] };
}

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

/**
 * Carga el modelo glTF (Tesla Roadster 2020 de metarex.4d, CC-BY-4.0, repintado en Ano White),
 * lo normaliza a CAR_LENGTH con el morro hacia +X y el suelo en y=0, y sustituye la carrocería procedural.
 */
export interface LoadOptions { url?: string; simpleMaterials?: boolean }

export async function loadRoadsterModel(car: Roadster, opts: LoadOptions = {}): Promise<void> {
  const gltf = await loader.loadAsync(opts.url ?? '/models/roadster.glb');
  const model = gltf.scene;
  model.updateMatrixWorld(true);

  // ¿Hacia dónde mira? Los faros marcan el frente.
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const lengthAxis: 'x' | 'z' = size.x >= size.z ? 'x' : 'z';
  const lamps = new THREE.Vector3();
  let lampCount = 0;
  const tmpBox = new THREE.Box3();
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = false;
    if (opts.simpleMaterials) m.material = simplify(m.material as THREE.Material);
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat?.name?.startsWith('headlights')) {
      tmpBox.setFromObject(m);
      lamps.add(tmpBox.getCenter(new THREE.Vector3()));
      lampCount++;
    }
  });
  const frontSign = lampCount ? Math.sign(lamps.divideScalar(lampCount)[lengthAxis] - center[lengthAxis]) || 1 : 1;

  // Envoltorio: centra, escala y orienta.
  const wrap = new THREE.Group();
  const scale = CAR_LENGTH / size[lengthAxis];
  model.position.set(-center.x, -box.min.y, -center.z);
  wrap.add(model);
  wrap.scale.setScalar(scale);
  if (lengthAxis === 'z') wrap.rotation.y = frontSign > 0 ? Math.PI / 2 : -Math.PI / 2;
  else if (frontSign < 0) wrap.rotation.y = Math.PI;

  // Ruedas: nodos "TR.DEF-Wheel.*". Giran sobre el eje lateral del coche expresado en su espacio local.
  wrap.updateMatrixWorld(true);
  const q = new THREE.Quaternion();
  const modelWheels: { node: THREE.Object3D; axis: THREE.Vector3 }[] = [];
  model.traverse((o) => {
    if (/^TR\.DEF-Wheel\.(Bk|Ft)\.(L|R)$/.test(o.name)) {
      o.getWorldQuaternion(q).invert();
      modelWheels.push({ node: o, axis: new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize() });
    }
  });

  car.body.remove(car.placeholder);
  car.body.add(wrap);
  car.modelWheels = modelWheels;
  car.wheels.length = 0;
}

const simplified = new WeakMap<THREE.Material, THREE.Material>();
/** MeshPhysical → MeshStandard (sin clearcoat ni especular): shaders mucho más ligeros para GPUs móviles. */
function simplify(mat: THREE.Material): THREE.Material {
  const cached = simplified.get(mat);
  if (cached) return cached;
  let out = mat;
  if ((mat as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
    const p = mat as THREE.MeshPhysicalMaterial;
    const m = new THREE.MeshStandardMaterial({
      name: p.name, color: p.color, map: p.map, metalness: p.metalness, roughness: p.roughness,
      emissive: p.emissive, emissiveIntensity: p.emissiveIntensity, emissiveMap: p.emissiveMap,
      transparent: p.transparent, opacity: p.opacity, side: THREE.FrontSide, alphaTest: p.alphaTest,
    });
    out = m;
  } else if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
    const m = (mat as THREE.MeshStandardMaterial).clone();
    m.normalMap = null; m.side = THREE.FrontSide;
    out = m;
  }
  simplified.set(mat, out);
  return out;
}
