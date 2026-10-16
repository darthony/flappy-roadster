import * as THREE from 'three';
import { NitrogenPlume } from './particles';
import type { Quality } from './quality';

/** Mapa de rugosidad con charcos: zonas lisas (mojadas) sobre asfalto. */
function puddleRoughness(size = 256): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#9a9a9a';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 70; i++) {
    const r = 10 + Math.random() * 40;
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, 'rgba(20,20,20,1)');
    g.addColorStop(0.7, 'rgba(40,40,40,0.9)');
    g.addColorStop(1, 'rgba(154,154,154,0)');
    ctx.save();
    ctx.translate(Math.random() * size, Math.random() * size);
    ctx.scale(1 + Math.random() * 2, 1);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(40, 1);
  return tex;
}

/**
 * Entorno para reflejos: negro con la tira de neón roja a ras de suelo y
 * un par de focos blancos. Lo que la pista mojada refleja.
 */
export function buildNightEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(50, 16, 8), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide })));
  const red = new THREE.MeshBasicMaterial({ color: 0xff1c1c });
  for (const z of [-4.5, 4.5]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(80, 0.25, 0.4), red);
    strip.position.set(0, -0.6, z);
    env.add(strip);
  }
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(30, 6), new THREE.MeshBasicMaterial({ color: 0x4a1010, side: THREE.DoubleSide }));
  glow.position.set(0, -2, 0); glow.rotation.x = Math.PI / 2;
  env.add(glow);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const [x, z] of [[14, -20], [-18, -24], [30, 10]]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 8), white);
    lamp.position.set(x, 9, z);
    env.add(lamp);
  }
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: 0x0a0d16, side: THREE.DoubleSide }));
  sky.position.y = 20; sky.rotation.x = Math.PI / 2;
  env.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.02).texture;
  pmrem.dispose();
  return tex;
}

/** Escenario nocturno: pista de pruebas, neón rojo, asfalto mojado y bruma. */
export class World {
  readonly group = new THREE.Group();
  private readonly dashes: THREE.Mesh[] = [];
  private readonly far: { mesh: THREE.Object3D; speed: number; span: number }[] = [];
  readonly moon: THREE.DirectionalLight;
  private readonly haze = new NitrogenPlume(220);
  private hazeT = 0;
  private hazeOn = true;

  constructor(scene: THREE.Scene, q: Quality) {
    this.hazeOn = q.haze;
    scene.background = new THREE.Color(0x030308);
    scene.fog = new THREE.Fog(0x07070c, 28, 110);

    scene.add(new THREE.HemisphereLight(0x1a2236, 0x0d0405, 0.35));
    this.moon = new THREE.DirectionalLight(0xbfcde8, 1.1);
    this.moon.position.set(-6, 20, 12);
    this.moon.castShadow = q.shadows;
    this.moon.shadow.mapSize.set(1024, 1024);
    this.moon.shadow.camera.left = -14; this.moon.shadow.camera.right = 26;
    this.moon.shadow.camera.top = 16; this.moon.shadow.camera.bottom = -4;
    this.moon.shadow.camera.near = 1; this.moon.shadow.camera.far = 60;
    this.moon.shadow.bias = -0.0008;
    scene.add(this.moon, this.moon.target);

    // Lavado rojo del neón: luces fijas respecto a la cámara (la pista se desplaza bajo ellas).
    for (let i = 0; i < q.neonLights; i++) {
      const l = new THREE.PointLight(0xff2020, q.neonLights < 6 ? 9 : 5, q.neonLights < 6 ? 18 : 13, 2);
      l.position.set(q.neonLights < 6 ? -2 + i * 10 : -8 + i * 7, 0.7, i % 2 === 0 ? 4.4 : -4.4);
      scene.add(l);
    }
    const key = new THREE.SpotLight(0xf2f6ff, 230, 40, 0.5, 1.0, 2);
    key.position.set(3, 16, 10);
    key.target.position.set(0, 4, 0);
    scene.add(key, key.target);
    const fill = new THREE.SpotLight(0xdfe6ff, 90, 40, 0.7, 1.0, 2);
    fill.position.set(-8, 10, -12);
    fill.target.position.set(0, 4, 0);
    scene.add(fill, fill.target);

    const under = new THREE.PointLight(0xff3030, 1.2, 9, 2);
    under.position.set(0, 0.5, 0);
    scene.add(under);

    // Asfalto general y pista mojada.
    const tarmac = new THREE.Mesh(new THREE.PlaneGeometry(400, 160), new THREE.MeshStandardMaterial({ color: 0x08090c, roughness: 0.95 }));
    tarmac.rotation.x = -Math.PI / 2;
    tarmac.position.set(60, -0.02, 0);
    tarmac.receiveShadow = true;
    this.group.add(tarmac);

    const wet = new THREE.MeshStandardMaterial({
      color: 0x0c0e13, roughness: 0.28, metalness: 0.15, roughnessMap: puddleRoughness(), envMapIntensity: 1.8,
    });
    const road = new THREE.Mesh(new THREE.PlaneGeometry(400, 9), wet);
    road.rotation.x = -Math.PI / 2;
    road.position.set(60, 0, 0);
    road.receiveShadow = true;
    this.group.add(road);

    // Tira de neón rojo en ambos bordes.
    const neon = new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff1a1a, emissiveIntensity: 2.2, roughness: 0.4 });
    for (const z of [-4.45, 4.45]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(400, 0.05, 0.22), neon);
      strip.position.set(60, 0.03, z);
      this.group.add(strip);
    }

    const dashMat = new THREE.MeshStandardMaterial({ color: 0x7c828d, emissive: 0x2a2d33, emissiveIntensity: 0.3, roughness: 0.6 });
    const dashGeo = new THREE.PlaneGeometry(2.2, 0.16);
    for (let i = 0; i < 40; i++) {
      const d = new THREE.Mesh(dashGeo, dashMat);
      d.rotation.x = -Math.PI / 2;
      d.position.set(-20 + i * 5, 0.006, 0);
      this.dashes.push(d);
      this.group.add(d);
    }

    // Fondo: hangares en silueta, torres de luz, bancos de prueba con balizas.
    const silhouette = new THREE.MeshStandardMaterial({ color: 0x0f1117, roughness: 0.9 });
    const windowMat = new THREE.MeshStandardMaterial({ color: 0xffe9c4, emissive: 0xffd28a, emissiveIntensity: 1.2 });
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.5 });
    const beaconMat = new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff1010, emissiveIntensity: 2.5 });
    const span = 160;
    for (let i = 0; i < 6; i++) {
      const h = new THREE.Group();
      const w = 12 + Math.random() * 14, hh = 4 + Math.random() * 4;
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, hh, 8), silhouette);
      box.position.y = hh / 2;
      h.add(box);
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, w, 12, 1, false, 0, Math.PI), silhouette);
      roof.rotation.z = Math.PI / 2;
      roof.position.y = hh;
      h.add(roof);
      const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.35, 0.1), windowMat);
      win.position.set(0, 1.4, 4.06);
      h.add(win);
      h.position.set(-30 + i * (span / 6) + Math.random() * 8, 0, -30 - Math.random() * 20);
      this.group.add(h);
      this.far.push({ mesh: h, speed: 0.22, span });
    }
    for (let i = 0; i < 5; i++) {
      const tower = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 16, 6), silhouette);
      pole.position.y = 8;
      const head = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.6, 0.5), lampMat);
      head.position.y = 16;
      tower.add(pole, head);
      tower.position.set(i * 34 + 6, 0, i % 2 === 0 ? -22 : 24);
      this.group.add(tower);
      this.far.push({ mesh: tower, speed: 0.4, span: 170 });
    }
    for (let i = 0; i < 3; i++) {
      const stand = new THREE.Group();
      const t = new THREE.Mesh(new THREE.BoxGeometry(2.4, 18, 2.4), silhouette);
      t.position.y = 9;
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), beaconMat);
      beacon.position.y = 18.3;
      stand.add(t, beacon);
      stand.position.set(i * 55 + 10, 0, -48);
      this.group.add(stand);
      this.far.push({ mesh: stand, speed: 0.15, span });
    }

    // Bruma baja que cruza la pista.
    (this.haze.points.material as THREE.ShaderMaterial).uniforms.uColor.value.set(0x8c93a3);
    this.haze.opacity = 0.16;
    scene.add(this.haze.points);
    scene.add(this.group);
  }

  update(dt: number, speed: number): void {
    for (const d of this.dashes) {
      d.position.x -= speed * dt;
      if (d.position.x < -30) d.position.x += 200;
    }
    for (const f of this.far) {
      f.mesh.position.x -= speed * f.speed * dt;
      if (f.mesh.position.x < -40) f.mesh.position.x += f.span;
    }
    this.hazeT -= dt;
    if (this.hazeOn && this.hazeT <= 0) {
      this.hazeT = 0.35;
      const origin = new THREE.Vector3(10 + Math.random() * 50, 0.6 + Math.random() * 1.2, (Math.random() - 0.5) * 14);
      this.haze.emit(origin, new THREE.Vector3(0, 0.15, 0), 1, { speed: 0.6, spread: 0.3, size: 5, life: 7 });
    }
    this.haze.update(dt, speed);
  }
}
