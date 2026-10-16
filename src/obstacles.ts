import * as THREE from 'three';
import { glowSprite, headlightCone, lightPool } from './glow';

/**
 * Obstáculos: la fila de vehículos que el Roadster saltó en la demo
 * (Cybertruck, Semi, Model Y, Cybercab, Model 3) y, arriba, el labio de la
 * rampa invertida colgando de una columna. El hueco entre ambos es el reto.
 */

function profile(points: [number, number][], depth: number, bevel = 0.05): THREE.ExtrudeGeometry {
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

const GLASS = new THREE.MeshStandardMaterial({ color: 0x1b2430, metalness: 0.6, roughness: 0.2 });
const TYRE = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.95 });
const RIM = new THREE.MeshStandardMaterial({ color: 0x9a9ea3, metalness: 0.9, roughness: 0.3 });
const STEEL = new THREE.MeshStandardMaterial({ color: 0x4a4f56, metalness: 0.7, roughness: 0.5 });
const WARNING = new THREE.MeshStandardMaterial({ color: 0xff7a00, roughness: 0.7 });
const LAMP = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 1.1 });
const HEADLAMP = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4f8ff, emissiveIntensity: 3.5 });
const TAILLAMP = new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff1010, emissiveIntensity: 2 });

let vehicleSpots = true;
let fakeLights = false;
/** Desactiva los focos reales de cada vehículo (perfil móvil); los faros emisivos se mantienen. */
export function configureObstacles(opts: { spots: boolean; fakes?: boolean }): void { vehicleSpots = opts.spots; fakeLights = !!opts.fakes; }

/** Faros delanteros (hacia +X, que tras girar el grupo apuntan a la cámara) y pilotos traseros. */
function addLights(g: THREE.Group, front: number, back: number, width: number, y: number, bar = false): void {
  if (bar) {
    g.add(shaded(new THREE.BoxGeometry(0.08, 0.08, width * 0.9), HEADLAMP, front + 0.02, y, 0));
  } else {
    for (const z of [width / 2 - 0.35, -(width / 2 - 0.35)]) g.add(shaded(new THREE.BoxGeometry(0.08, 0.14, 0.4), HEADLAMP, front + 0.02, y, z));
  }
  g.add(shaded(new THREE.BoxGeometry(0.06, 0.08, width * 0.85), TAILLAMP, back - 0.02, y, 0));
  if (fakeLights) {
    const zs = bar ? [0] : [width / 2 - 0.35, -(width / 2 - 0.35)];
    for (const z of zs) {
      const halo = glowSprite(0xffffff, bar ? 2.4 : 1.6, 0.95);
      halo.position.set(front + 0.1, y, z);
      g.add(halo);
    }
    const beam = headlightCone(8, bar ? 4.2 : 3.2, 0.2);
    beam.position.x += front;
    g.add(beam);
    const pool = lightPool(0xdfe9ff, 6, 0.22);
    pool.position.set(front + 2.5, 0.015, 0);
    g.add(pool);
    const tail = glowSprite(0xff2020, 1.6, 0.7);
    tail.position.set(back - 0.1, y, 0);
    g.add(tail);
  }
  if (!vehicleSpots) return;
  const spot = new THREE.SpotLight(0xdfe9ff, 12, 20, 0.5, 0.7, 1.5);
  spot.position.set(front, y, 0);
  spot.target.position.set(front + 12, -1.5, 0);
  g.add(spot, spot.target);
}

const tyreGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 20);
tyreGeo.rotateX(Math.PI / 2);
const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.34, 20);
rimGeo.rotateX(Math.PI / 2);

function wheel(x: number, z: number, r = 0.42): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, r, z);
  const t = new THREE.Mesh(tyreGeo, TYRE);
  const rim = new THREE.Mesh(rimGeo, RIM);
  t.scale.setScalar(r / 0.42);
  rim.scale.setScalar(r / 0.42);
  t.castShadow = true;
  g.add(t, rim);
  return g;
}

function shaded(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export interface VehicleKind {
  name: string;
  /** Largo real del vehículo (profundidad en escena, ya que miran a la cámara). */
  length: number;
  /** Ancho: extensión del obstáculo a lo largo de la pista. */
  width: number;
  height: number;
  color: THREE.Color;
  build(): THREE.Group;
}

function carKind(
  name: string, color: number, width: number, pts: [number, number][], glassPts: [number, number][], wheelX: number,
): VehicleKind {
  const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
  const height = Math.max(...pts.map((p) => p[1]), ...glassPts.map((p) => p[1]));
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.35 });
  const bodyGeo = profile(pts, width);
  const glassGeo = profile(glassPts, width * 0.9, 0.03);
  return {
    name, length: maxX - minX, width, height, color: new THREE.Color(color),
    build() {
      const g = new THREE.Group();
      g.add(shaded(bodyGeo, paint), shaded(glassGeo, GLASS));
      for (const x of [wheelX, -wheelX]) for (const z of [width / 2 - 0.1, -(width / 2 - 0.1)]) g.add(wheel(x, z));
      addLights(g, maxX, minX, width, 0.72);
      return g;
    },
  };
}

const CYBERTRUCK: VehicleKind = {
  name: 'Cybertruck', length: 5.9, width: 2.2, height: 1.95, color: new THREE.Color(0xb9bcc0),
  build() {
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, metalness: 0.9, roughness: 0.35, flatShading: true });
    const body = profile([[-2.95, 0.55], [2.95, 0.55], [2.95, 0.95], [1.1, 1.95], [-2.6, 1.62], [-2.95, 1.45]], 2.2, 0.02);
    g.add(shaded(body, steel));
    g.add(shaded(profile([[1.0, 1.0], [0.1, 1.92], [-1.2, 1.9], [-1.4, 1.1]], 2.0, 0.02), GLASS));
    for (const x of [1.8, -1.8]) for (const z of [1.0, -1.0]) g.add(wheel(x, z, 0.5));
    addLights(g, 2.95, -2.95, 2.2, 0.95, true);
    return g;
  },
};

const SEMI: VehicleKind = {
  name: 'Semi', length: 12.5, width: 2.5, height: 4.1, color: new THREE.Color(0xf1f1ee),
  build() {
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.6, metalness: 0.2 });
    const cab = profile([[3.5, 0.6], [6.2, 0.6], [6.2, 1.5], [5.6, 3.4], [5.0, 3.9], [3.5, 3.9]], 2.5, 0.04);
    g.add(shaded(cab, white));
    g.add(shaded(profile([[5.4, 1.8], [5.9, 2.0], [5.5, 3.3], [4.9, 3.7], [4.4, 3.6], [4.4, 2.0]], 2.4, 0.02), GLASS));
    g.add(shaded(new THREE.BoxGeometry(9.5, 2.9, 2.5), white, -1.5, 2.55, 0));
    g.add(shaded(new THREE.BoxGeometry(9.5, 0.3, 2.5), STEEL, -1.5, 1.0, 0));
    for (const x of [5.2, 2.6, -3.6, -4.9]) for (const z of [1.15, -1.15]) g.add(wheel(x, z, 0.5));
    addLights(g, 6.2, -6.25, 2.5, 1.1);
    g.add(shaded(new THREE.BoxGeometry(0.1, 0.12, 2.3), HEADLAMP, 6.22, 3.85, 0));
    return g;
  },
};

const MODEL_Y = carKind('Model Y', 0x2b4a86, 1.95,
  [[-2.4, 0.4], [2.4, 0.4], [2.4, 0.8], [1.7, 0.95], [-2.0, 1.1], [-2.4, 0.95]],
  [[0.9, 0.98], [0.2, 1.6], [-1.4, 1.65], [-2.1, 1.1]], 1.55);

const CYBERCAB = carKind('Cybercab', 0xd0a74a, 1.9,
  [[-2.1, 0.42], [2.1, 0.42], [2.1, 0.75], [1.5, 0.9], [-1.8, 1.0], [-2.1, 0.85]],
  [[0.9, 0.9], [0.1, 1.5], [-1.2, 1.5], [-1.9, 1.0]], 1.35);

const MODEL_3 = carKind('Model 3', 0xa8202b, 1.9,
  [[-2.35, 0.38], [2.35, 0.38], [2.35, 0.68], [1.6, 0.85], [-2.0, 0.95], [-2.35, 0.8]],
  [[0.7, 0.86], [0.0, 1.42], [-1.3, 1.45], [-2.0, 0.95]], 1.5);

export const VEHICLES: VehicleKind[] = [CYBERTRUCK, SEMI, MODEL_Y, CYBERCAB, MODEL_3];

const columnGeo = new THREE.BoxGeometry(0.8, 40, 0.8);
const NEON_LIP = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff1a1a, emissiveIntensity: 2 });
const lipGeo = new THREE.BoxGeometry(2.6, 0.5, 3.2);
const stripeGeo = new THREE.BoxGeometry(0.5, 0.52, 3.24);
const lampGeo = new THREE.BoxGeometry(2.2, 0.08, 0.2);

export interface Obstacle {
  group: THREE.Group;
  kind: VehicleKind;
  vehicle: THREE.Group;
  column: THREE.Mesh;
  lip: THREE.Group;
  gapTop: number;
  gapH: number;
  passed: boolean;
  destroyed: boolean;
  columnRetract: number;
}

/**
 * Grupo con un ejemplar de cada vehículo y un labio de rampa, para precompilar
 * todos los shaders al arrancar (evita el tirón al aparecer cada tipo por primera vez).
 */
export function buildWarmup(): THREE.Group {
  const g = new THREE.Group();
  VEHICLES.forEach((k, i) => {
    const v = k.build();
    v.rotation.y = -Math.PI / 2;
    v.position.x = i * 6;
    g.add(v);
  });
  const column = new THREE.Mesh(columnGeo, STEEL);
  column.position.set(0, 30, 0);
  const lip = new THREE.Group();
  lip.add(shaded(lipGeo, STEEL));
  lip.add(shaded(stripeGeo, WARNING, 0, 0, 0));
  lip.add(shaded(lampGeo, LAMP, 0, -0.26, 1.5));
  lip.add(shaded(new THREE.BoxGeometry(2.6, 0.05, 0.08), NEON_LIP, 0, -0.27, -1.6));
  lip.position.y = 8;
  g.add(column, lip);
  return g;
}

export class ObstacleField {
  readonly list: Obstacle[] = [];
  private readonly root = new THREE.Group();
  private untilNext = 0;
  /** Altura del hueco; la fija el juego según la dificultad. */
  gapH = 5.4;
  spacing = 14;
  readonly spawnX = 44;

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
  }

  reset(): void {
    for (const o of this.list) this.root.remove(o.group);
    this.list.length = 0;
    this.untilNext = 18;
  }

  private spawn(): void {
    const kind = VEHICLES[Math.floor(Math.random() * VEHICLES.length)];
    const group = new THREE.Group();
    const vehicle = kind.build();
    vehicle.rotation.y = -Math.PI / 2; // de frente a la cámara, como en la demo
    group.add(vehicle);

    const gapH = this.gapH;
    const gapTop = kind.height + gapH;
    const column = new THREE.Mesh(columnGeo, STEEL);
    column.position.set(0, gapTop + 20.5, 0);
    column.castShadow = true;
    group.add(column);

    const lip = new THREE.Group();
    lip.position.y = gapTop + 0.25;
    lip.add(shaded(lipGeo, STEEL));
    for (const x of [-0.9, 0, 0.9]) lip.add(shaded(stripeGeo, WARNING, x, 0, 0));
    lip.add(shaded(lampGeo, LAMP, 0, -0.26, 1.5));
    lip.add(shaded(new THREE.BoxGeometry(2.6, 0.05, 0.08), NEON_LIP, 0, -0.27, -1.6));
    if (fakeLights) { const g = glowSprite(0xfff2c0, 3.2, 0.7); g.position.set(0, -0.3, 1.5); lip.add(g); }
    group.add(lip);

    group.position.x = this.spawnX;
    this.root.add(group);
    this.list.push({ group, kind, vehicle, column, lip, gapTop, gapH, passed: false, destroyed: false, columnRetract: 0 });
  }

  update(dt: number, speed: number): void {
    const dx = speed * dt;
    this.untilNext -= dx;
    if (this.untilNext <= 0) {
      this.spawn();
      this.untilNext = this.spacing + Math.random() * 4;
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      o.group.position.x -= dx;
      if (o.columnRetract > 0) {
        o.columnRetract -= dt;
        o.column.position.y += 60 * dt;
      }
      if (o.group.position.x < -30) {
        this.root.remove(o.group);
        this.list.splice(i, 1);
      }
    }
  }

  /** Revienta el obstáculo (modo nitro): oculta el vehículo y el labio, sube la columna. */
  destroy(o: Obstacle): void {
    o.destroyed = true;
    o.vehicle.visible = false;
    o.lip.visible = false;
    o.columnRetract = 0.6;
  }

  /**
   * Colisión AABB en el plano XY contra un coche con caja [minX,maxX]×[minY,maxY] (mundo).
   */
  hits(o: Obstacle, minX: number, maxX: number, minY: number, maxY: number): 'vehicle' | 'column' | 'lip' | null {
    if (o.destroyed) return null;
    const ox = o.group.position.x;
    const hl = o.kind.width / 2;
    if (maxX > ox - hl && minX < ox + hl && minY < o.kind.height) return 'vehicle';
    const colBottom = o.column.position.y - 20;
    if (maxX > ox - 0.4 && minX < ox + 0.4 && maxY > colBottom) return 'column';
    if (maxX > ox - 1.3 && minX < ox + 1.3 && maxY > o.gapTop) return 'lip';
    return null;
  }
}
