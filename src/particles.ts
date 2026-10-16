import * as THREE from 'three';

function softDiscTexture(size = 64): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (320.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(uColor, t.a * vAlpha);
  }
`;

/**
 * Pluma de nitrógeno: gas frío, blanco translúcido que se expande y se disipa.
 * Sin fuego. Un pool fijo de partículas actualizado en CPU.
 */
export class NitrogenPlume {
  readonly points: THREE.Points;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseSize: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private cursor = 0;
  opacity = 0.95;

  constructor(max = 900) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.baseSize = new Float32Array(max);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: softDiscTexture() }, uColor: { value: new THREE.Color(0xf6fbff) } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  /**
   * Emite `count` partículas desde `origin` en dirección `dir` (normalizada).
   * `drift` es la velocidad del aire relativa al coche (el mundo se mueve hacia -X).
   */
  emit(
    origin: THREE.Vector3, dir: THREE.Vector3, count: number,
    opts: { speed?: number; spread?: number; size?: number; life?: number; drift?: number } = {},
  ): void {
    const speed = opts.speed ?? 6, spread = opts.spread ?? 0.45, size = opts.size ?? 0.5;
    const life = opts.life ?? 0.55, drift = opts.drift ?? 0;
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const i3 = i * 3;
      this.pos[i3] = origin.x + (Math.random() - 0.5) * 0.12;
      this.pos[i3 + 1] = origin.y + (Math.random() - 0.5) * 0.12;
      this.pos[i3 + 2] = origin.z + (Math.random() - 0.5) * 0.12;
      const s = speed * (0.6 + Math.random() * 0.8);
      this.vel[i3] = dir.x * s + (Math.random() - 0.5) * spread * s - drift;
      this.vel[i3 + 1] = dir.y * s + (Math.random() - 0.5) * spread * s;
      this.vel[i3 + 2] = dir.z * s + (Math.random() - 0.5) * spread * s;
      const l = life * (0.7 + Math.random() * 0.6);
      this.life[i] = l;
      this.maxLife[i] = l;
      this.baseSize[i] = size * (0.7 + Math.random() * 0.6);
    }
  }

  update(dt: number, scroll = 0): void {
    const drag = Math.pow(0.08, dt);
    const dx = scroll * dt;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const i3 = i * 3;
      this.vel[i3] *= drag; this.vel[i3 + 1] *= drag; this.vel[i3 + 2] *= drag;
      this.vel[i3 + 1] += 1.2 * dt; // el gas frío expandido flota un poco
      this.pos[i3] += this.vel[i3] * dt - dx;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i]; // 0 → 1
      this.size[i] = this.baseSize[i] * (0.5 + t * 2.2);
      this.alpha[i] = (1 - t) * (1 - t * 0.5) * this.opacity;
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
  }
}

/** Escombros de obstáculos reventados durante el nitro. */
export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly rot: Float32Array;
  private readonly rotVel: Float32Array;
  private readonly life: Float32Array;
  private readonly scale: Float32Array;
  private cursor = 0;
  private readonly dummy = new THREE.Object3D();

  constructor(max = 96) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.rot = new Float32Array(max * 3);
    this.rotVel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.scale = new Float32Array(max);
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.4, roughness: 0.6 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.count = max;
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, new THREE.Color(0xffffff));
    this.hideAll();
  }

  burst(center: THREE.Vector3, extent: THREE.Vector3, color: THREE.Color, count: number, push: number): void {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const i3 = i * 3;
      this.pos[i3] = center.x + (Math.random() - 0.5) * extent.x;
      this.pos[i3 + 1] = center.y + (Math.random() - 0.5) * extent.y;
      this.pos[i3 + 2] = center.z + (Math.random() - 0.5) * extent.z;
      this.vel[i3] = push * (0.4 + Math.random());
      this.vel[i3 + 1] = 4 + Math.random() * 9;
      this.vel[i3 + 2] = (Math.random() - 0.5) * 10;
      this.rot[i3] = Math.random() * 6; this.rot[i3 + 1] = Math.random() * 6; this.rot[i3 + 2] = Math.random() * 6;
      this.rotVel[i3] = (Math.random() - 0.5) * 12; this.rotVel[i3 + 1] = (Math.random() - 0.5) * 12; this.rotVel[i3 + 2] = (Math.random() - 0.5) * 12;
      this.life[i] = 1.6 + Math.random();
      this.scale[i] = 0.25 + Math.random() * 0.55;
      this.mesh.setColorAt(i, color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number, worldSpeed: number): void {
    for (let i = 0; i < this.max; i++) {
      const i3 = i * 3;
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i3 + 1] -= 24 * dt;
      this.pos[i3] += (this.vel[i3] - worldSpeed) * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.1) { this.pos[i3 + 1] = 0.1; this.vel[i3 + 1] *= -0.35; }
      this.rot[i3] += this.rotVel[i3] * dt; this.rot[i3 + 1] += this.rotVel[i3 + 1] * dt; this.rot[i3 + 2] += this.rotVel[i3 + 2] * dt;
      const s = this.life[i] < 0.3 ? this.scale[i] * (this.life[i] / 0.3) : this.scale[i];
      this.dummy.position.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
      this.dummy.rotation.set(this.rot[i3], this.rot[i3 + 1], this.rot[i3 + 2]);
      this.dummy.scale.setScalar(Math.max(s, 0.0001));
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      if (this.life[i] <= 0) { this.dummy.scale.setScalar(0.0001); this.dummy.updateMatrix(); this.mesh.setMatrixAt(i, this.dummy.matrix); }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  hideAll(): void {
    this.life.fill(0);
    this.dummy.position.set(0, -100, 0);
    this.dummy.scale.setScalar(0.0001);
    this.dummy.updateMatrix();
    for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
