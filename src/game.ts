import * as THREE from 'three';
import { buildRoadster, loadRoadsterModel, type Roadster, CAR_LENGTH, CAR_HEIGHT } from './roadster';
import { NitrogenPlume, Debris } from './particles';
import { World } from './world';
import { ObstacleField, type Obstacle } from './obstacles';
import { Hud } from './hud';
import { Input } from './input';
import { Audio } from './audio';
import { fetchTop, submitScore } from './api';
import { initAnalytics, track } from './analytics';
import { detectQuality } from './quality';
import { installErrorReporting, report } from './report';
import { configureObstacles, buildWarmup } from './obstacles';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildNightEnvironment } from './world';

// Física "Mario 3 bajo el agua": inercia, caída suave, cada ráfaga suma.
const GRAVITY = -26;
const FLAP_V = 8.8;
const FLAP_KEEP = 0.35;
const TERMINAL_V = -17;
const CEILING = 11.5;
const BASE_SPEED = 7.5;
const MAX_SPEED = 12.5;
const ROLL_DURATION = 0.7;

// Nitro: 3.2 s de cohete con control de actitud automático.
const NITRO_DURATION = 3.2;
const NITRO_SPEED_MULT = 2.6;
const NITRO_ALT = 5.6;
const NITRO_FILL_PER_PASS = 0.11;
const NITRO_FILL_CENTER = 0.05;
const AFTERBURN = 0.8;

type State = 'title' | 'playing' | 'dead';

const BEST_KEY = 'flappy-roadster-best';
function loadBest(): number { try { return Number(localStorage.getItem(BEST_KEY) ?? 0) || 0; } catch { return 0; } }
function saveBest(n: number): void { try { localStorage.setItem(BEST_KEY, String(n)); } catch { /* sin almacenamiento */ } }

export class Game {
  private renderer: THREE.WebGLRenderer;
  private composer?: EffectComposer;
  private bloom?: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
  private car: Roadster;
  private plume!: NitrogenPlume;
  private debris = new Debris(96);
  private world: World;
  private field: ObstacleField;
  private hud = new Hud();
  private audio = new Audio();
  private timer = new THREE.Timer();

  private state: State = 'title';
  private y = 3;
  private vy = 0;
  private pitch = 0;
  private rolling = false;
  private rollT = 0;
  private rollBonusArmed = false;
  private speed = BASE_SPEED;
  private passed = 0;
  private score = 0;
  private best = loadBest();

  private nitro = 0;
  private nitroActive = false;
  private nitroTimer = 0;
  private nitroUses = 0;
  private afterburn = 0;
  private nitroEmitAcc = 0;
  private readyPinged = false;

  private deadTimer = 0;
  private readyT = 0;
  private readyPuffT = 0;
  private readyPingT = 0;
  private lastDeath = '';
  private spin = 0;
  private titleT = 0;
  private puffT = 0;
  private shake = 0;

  /** Se resuelve cuando los shaders y el modelo están listos. */
  readonly ready: Promise<void>;

  private async warmup(modelUrl: string, simpleMaterials: boolean): Promise<void> {
    const t0 = performance.now();
    const warm = buildWarmup();
    warm.position.set(20, 0, 0);
    this.scene.add(warm, this.debris.mesh);
    this.hud.setLoading('Preparando pista…');
    const lap = (label: string) => console.info(`[warmup] ${label} ${Math.round(performance.now() - t0)} ms`);
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
      lap('shaders de pista');
      this.hud.setLoading('Cargando Roadster…');
      await loadRoadsterModel(this.car, { url: modelUrl, simpleMaterials });
      lap('modelo cargado');
      await this.renderer.compileAsync(this.scene, this.camera);
      lap('shaders del coche');
    } catch (e) {
      report({ kind: 'model', message: (e as Error).message });
      console.warn('No se pudo cargar el modelo del Roadster, se usa el procedural', e);
    } finally {
      this.scene.remove(warm);
      this.hud.setLoading(null);
      track('warmup_done', { ms: Math.round(performance.now() - t0) });
    }
  }

  private readonly tmpV = new THREE.Vector3();
  private readonly tmpD = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly camTarget = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    const q = detectQuality();
    installErrorReporting(canvas);
    initAnalytics();
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.hud.flash('GPU reiniciando…', 2, true); });
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q.profile === 'high', powerPreference: 'high-performance' });
    } catch (e) {
      report({ kind: 'webgl', message: 'no se pudo crear el contexto: ' + (e as Error).message });
      showFatal('Tu navegador no pudo iniciar WebGL. Cierra esta pestaña, vuelve a abrir el juego o prueba con otro navegador.');
      throw e;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene.environment = buildNightEnvironment(this.renderer);
    this.scene.environmentIntensity = 1.0;

    configureObstacles({ spots: q.vehicleSpots });
    this.world = new World(this.scene, q);
    this.field = new ObstacleField(this.scene);
    this.plume = new NitrogenPlume(q.particles);
    this.car = buildRoadster();
    this.car.group.position.set(0, this.y, 0);
    this.scene.add(this.car.group, this.plume.points, this.debris.mesh);
    this.world.moon.target = this.car.group;
    // Precompila shaders de todos los obstáculos y del coche antes de jugar: en móvil la
    // compilación en el primer frame bloquea el hilo principal varios segundos.
    this.ready = this.warmup(q.profile === 'low' ? '/models/roadster-lite.glb' : '/models/roadster.glb', q.simpleMaterials);

    const input = new Input(document.body);
    input.on('flap', () => this.onFlap());
    input.on('roll', () => this.onRoll());
    input.on('nitro', () => this.onNitro());
    this.hud.onStart(() => this.start());
    this.hud.onRetry(() => this.start());
    this.hud.onNitro(() => this.onNitro());
    this.hud.onThrust(() => this.onFlap());
    this.hud.onSubmit((nick) => this.submit(nick));
    this.hud.onBoardRequest(() => this.loadBoard('title'));
    document.body.addEventListener('pointerdown', () => this.audio.unlock(), { once: false });
    window.addEventListener('keydown', () => this.audio.unlock());

    if (q.bloom) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.45, 0.45, 0.9);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.hud.showTitle(this.best);
    this.hud.setNitro(0, 'charging');
    if (import.meta.env.DEV) {
      (window as unknown as { __fr: unknown }).__fr = {
        fillNitro: () => { this.nitro = 1; },
        fireNitro: () => { this.nitro = 1; this.onNitro(); },
        state: () => ({ state: this.state, lastDeath: this.lastDeath, y: this.y, vy: this.vy, score: this.score, speed: this.speed, nitro: this.nitro, nitroActive: this.nitroActive,
          next: this.field.list.filter((o) => !o.passed).map((o) => ({ x: o.group.position.x, len: o.kind.width, bottom: o.kind.height, top: o.gapTop }))[0] ?? null }),
        start: () => this.start(),
        flap: () => this.onFlap(),
        roll: () => this.onRoll(),
      };
    }
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    this.bloom?.setSize(Math.round(w / 2), Math.round(h / 2));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- Entrada ----------

  private onFlap(): void {
    if (this.state === 'title') { this.start(); return; }
    if (this.state !== 'playing' || this.nitroActive) return;
    this.vy = Math.max(this.vy, 0) * FLAP_KEEP + FLAP_V;
    this.puffCorners(16, 8);
    this.audio.flap();
    navigator.vibrate?.(8);
  }

  private onRoll(): void {
    if (this.state !== 'playing' || this.nitroActive || this.rolling) return;
    this.rolling = true;
    this.rollT = 0;
    this.rollBonusArmed = true;
    this.audio.roll();
    // Las toberas laterales delanteras y de esquina provocan el giro.
    this.car.group.updateMatrixWorld();
    for (const n of this.car.cornerNozzles.slice(0, 2)) {
      this.plume.emit(this.nozzleWorld(n), this.dirWorld(0, -0.4, 1), 10, { speed: 7, size: 0.5, life: 0.5 });
    }
  }

  private onNitro(): void {
    if (this.state !== 'playing' || this.nitroActive || this.nitro < 1) return;
    this.nitroActive = true;
    this.nitroTimer = NITRO_DURATION;
    this.nitro = 0;
    this.readyPinged = false;
    this.rolling = false;
    this.rollT = 0;
    this.shake = 1;
    this.hud.flash('NITRO ×10', NITRO_DURATION, true);
    track('nitro_fired', { score: this.score, use: this.nitroUses + 1 });
    this.audio.nitroStart();
    navigator.vibrate?.([30, 40, 60]);
  }

  // ---------- Estado ----------

  private start(): void {
    this.audio.unlock();
    this.state = 'playing';
    this.y = 4.5; this.vy = 4; this.pitch = 0;
    this.rolling = false; this.rollT = 0;
    this.speed = BASE_SPEED; this.passed = 0; this.score = 0;
    this.nitro = 0; this.nitroActive = false; this.nitroTimer = 0; this.nitroUses = 0; this.afterburn = 0;
    this.readyPinged = false; this.spin = 0; this.shake = 0;
    this.car.body.rotation.set(0, 0, 0);
    this.car.group.rotation.set(0, 0, 0);
    this.field.gapH = 5.4;
    this.field.reset();
    this.plume.clear();
    this.debris.hideAll();
    this.hud.hideOverlay();
    this.hud.setScore(0);
    this.hud.setNitro(0, 'charging');
    track('game_start');
  }

  private die(): void {
    if (this.state !== 'playing') return;
    this.state = 'dead';
    this.deadTimer = 0;
    this.nitroActive = false;
    this.rolling = false;
    this.vy = 7;
    this.spin = (Math.random() < 0.5 ? -1 : 1) * 7;
    this.shake = 1;
    this.audio.crash();
    navigator.vibrate?.(80);
    this.car.group.updateMatrixWorld();
    for (const n of this.car.cornerNozzles) {
      this.plume.emit(this.nozzleWorld(n), this.dirWorld(0, 1, 0), 30, { speed: 9, spread: 1.2, size: 0.8, life: 0.9 });
    }
    if (this.score > this.best) { this.best = this.score; saveBest(this.best); }
    track('game_over', { score: this.score, passed: this.passed, nitro_uses: this.nitroUses });
  }

  private loadBoard(target: 'title' | 'over', me?: { nickname: string; score: number }): void {
    this.hud.boardMessage(target, 'Cargando…');
    fetchTop()
      .then((rows) => this.hud.renderBoard(target, rows, me))
      .catch(() => this.hud.boardMessage(target, 'No se pudo cargar el ranking.'));
  }

  private submit(nick: string): void {
    const score = this.score;
    this.hud.setSubmitState('sending', 'Enviando…');
    this.hud.rememberNick(nick);
    submitScore(nick, score)
      .then((r) => {
        this.hud.setSubmitState('done', r.rank <= 20 ? `¡Puesto #${r.rank} del ranking!` : `Puesto #${r.rank}. Sigue intentándolo.`);
        this.hud.renderBoard('over', r.top, { nickname: r.nickname, score: r.score });
        track('score_submitted', { score, rank: r.rank });
      })
      .catch((e: Error) => this.hud.setSubmitState('idle', e.message || 'No se pudo guardar.'));
  }

  // ---------- Utilidades ----------

  private nozzleWorld(local: THREE.Vector3): THREE.Vector3 {
    return this.car.body.localToWorld(this.tmpV.copy(local));
  }

  private dirWorld(x: number, y: number, z: number): THREE.Vector3 {
    this.car.body.getWorldQuaternion(this.tmpQ);
    return this.tmpD.set(x, y, z).applyQuaternion(this.tmpQ).normalize();
  }

  private puffCorners(count: number, speed: number): void {
    this.car.group.updateMatrixWorld();
    for (const n of this.car.cornerNozzles) {
      this.plume.emit(this.nozzleWorld(n), this.dirWorld(0, -1, 0), count, { speed, spread: 0.55, size: 1.0, life: 0.7 });
    }
  }

  private carBox(): [number, number, number, number] {
    // Caja algo indulgente: 4.2 de largo, de 0.15 a 1.3 de alto.
    return [-CAR_LENGTH / 2 + 0.2, CAR_LENGTH / 2 - 0.2, this.y + 0.15, this.y + CAR_HEIGHT - 0.15];
  }

  /** Altura objetivo durante el nitro: el centro del hueco más próximo por delante, o una altura de crucero. */
  private nitroAltitude(): number {
    let best: Obstacle | undefined;
    for (const o of this.field.list) {
      if (o.passed || o.destroyed) continue;
      const ox = o.group.position.x;
      if (ox > -2 && (!best || ox < best.group.position.x)) best = o;
    }
    if (!best) return NITRO_ALT;
    return best.kind.height + best.gapH / 2 - CAR_HEIGHT / 2;
  }

  private targetSpeed(): number {
    return Math.min(MAX_SPEED, BASE_SPEED + this.passed * 0.12);
  }

  private onPass(o: Obstacle): void {
    o.passed = true;
    this.passed++;
    this.field.gapH = Math.max(3.9, 5.4 - this.passed * 0.035);
    let pts = 1;
    const carMid = this.y + CAR_HEIGHT / 2;
    const gapMid = o.kind.height + o.gapH / 2;
    const centered = Math.abs(carMid - gapMid) < o.gapH * 0.18;
    let label = '';
    if (centered) { pts += 1; label = 'CENTRO +1'; }
    if (this.rolling && this.rollBonusArmed) { pts *= 2; label = 'BARREL ROLL ×2'; this.rollBonusArmed = false; }
    this.score += pts;
    if (label) this.hud.flash(label);
    const fillDiv = 1 + 0.4 * this.nitroUses;
    this.nitro = Math.min(1, this.nitro + (NITRO_FILL_PER_PASS + (centered ? NITRO_FILL_CENTER : 0)) / fillDiv);
    if (this.nitro >= 1 && !this.readyPinged) { this.readyPinged = true; this.audio.ready(); this.hud.flash('N₂ LISTO', 1.2, true); navigator.vibrate?.([15, 30, 15]); }
  }

  private onSmash(o: Obstacle): void {
    o.passed = true;
    this.passed++;
    this.score += 10;
    this.field.destroy(o);
    const c = this.tmpV.set(o.group.position.x, o.kind.height / 2, 0);
    this.debris.burst(c, new THREE.Vector3(o.kind.width, o.kind.height, o.kind.length), o.kind.color, 22, 14);
    this.debris.burst(this.tmpV.set(o.group.position.x, o.gapTop + 0.3, 0), new THREE.Vector3(2.6, 0.5, 3), new THREE.Color(0xff7a00), 8, 12);
    this.audio.explode();
    this.shake = Math.min(1, this.shake + 0.6);
    navigator.vibrate?.(20);
  }

  // ---------- Bucle ----------

  tick = (): void => {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 1 / 30);
    this.update(dt);
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.tick);
  };

  private update(dt: number): void {
    switch (this.state) {
      case 'title': this.updateTitle(dt); break;
      case 'playing': this.updatePlaying(dt); break;
      case 'dead': this.updateDead(dt); break;
    }
    const worldSpeed = this.state === 'title' ? 2.5 : this.speed;
    this.world.update(dt, worldSpeed);
    this.plume.update(dt, worldSpeed);
    this.debris.update(dt, this.speed);
    for (const w of this.car.wheels) w.rotation.z -= (worldSpeed / 0.4) * dt;
    for (const w of this.car.modelWheels) w.node.rotateOnAxis(w.axis, -(worldSpeed / 0.35) * dt);
    this.updateCamera(dt);
    this.hud.update(dt);
    this.hud.setSpeed(worldSpeed * 8);
  }

  private updateTitle(dt: number): void {
    this.titleT += dt;
    this.y = 3 + Math.sin(this.titleT * 1.6) * 0.35;
    this.car.group.position.y = this.y;
    this.car.body.rotation.y = Math.sin(this.titleT * 0.5) * 0.9;
    this.car.body.rotation.z = Math.sin(this.titleT * 1.6 + 1) * 0.08;
    this.puffT -= dt;
    if (this.puffT <= 0) {
      this.puffT = 0.12;
      this.car.group.updateMatrixWorld();
      for (const n of this.car.cornerNozzles) {
        this.plume.emit(this.nozzleWorld(n), this.dirWorld(0, -1, 0), 2, { speed: 4, size: 0.8, life: 0.7 });
      }
    }
    this.speed = 0;
  }

  private updatePlaying(dt: number): void {
    // Velocidad: base por dificultad, multiplicada durante el nitro y decayendo después.
    const base = this.targetSpeed();
    if (this.nitroActive) this.speed = THREE.MathUtils.damp(this.speed, base * NITRO_SPEED_MULT, 6, dt);
    else if (this.afterburn > 0) { this.afterburn -= dt; this.speed = THREE.MathUtils.damp(this.speed, base, 3, dt); }
    else this.speed = THREE.MathUtils.damp(this.speed, base, 4, dt);

    if (this.nitroActive) {
      this.nitroTimer -= dt;
      // Control de actitud: los propulsores de esquina apuntan al centro del siguiente hueco.
      this.y = THREE.MathUtils.damp(this.y, this.nitroAltitude(), 4, dt);
      this.vy = 0;
      this.rollT += dt / 0.8;
      this.nitroEmitAcc += dt * 540;
      this.car.group.updateMatrixWorld();
      const dir = this.dirWorld(-1, 0, 0);
      while (this.nitroEmitAcc >= 1) {
        this.nitroEmitAcc -= 1;
        const n = this.car.rearNozzles[Math.floor(Math.random() * 4)];
        this.plume.emit(this.nozzleWorld(n), dir, 1, { speed: 10, spread: 0.3, size: 1.3, life: 0.9 });
      }
      if (this.nitroTimer <= 0) {
        this.nitroActive = false;
        this.afterburn = AFTERBURN;
        this.nitroUses++;
        this.vy = 2;
        this.rollT = Math.ceil(this.rollT - 0.001);
        this.rolling = false;
      }
    } else {
      this.vy = Math.max(TERMINAL_V, this.vy + GRAVITY * dt);
      this.y += this.vy * dt;
      if (this.y > CEILING) { this.y = CEILING; this.vy = Math.min(this.vy, 0); }
      if (this.y <= 0) { this.y = 0; this.lastDeath = 'ground'; this.die(); return; }
      if (this.rolling) {
        this.rollT += dt / ROLL_DURATION;
        if (this.rollT >= 1) { this.rolling = false; this.rollT = 0; }
      }
    }

    // Postura del coche.
    const targetPitch = this.nitroActive ? 0.06 : THREE.MathUtils.clamp(this.vy * 0.05, -0.65, 0.42);
    this.pitch = THREE.MathUtils.damp(this.pitch, targetPitch, 9, dt);
    this.car.group.position.y = this.y;
    this.car.body.rotation.set((this.rolling || this.nitroActive ? this.rollT : 0) * Math.PI * 2, 0, this.pitch);

    // Obstáculos.
    this.field.update(dt, this.speed);
    const [minX, maxX, minY, maxY] = this.carBox();
    for (const o of this.field.list) {
      if (o.passed) continue;
      const ox = o.group.position.x;
      if (this.nitroActive) {
        if (this.field.hits(o, minX - 0.5, maxX + 0.5, 0, 40) || ox + o.kind.width / 2 < minX) this.onSmash(o);
        continue;
      }
      if (this.afterburn > 0 && this.field.hits(o, minX, maxX, minY, maxY)) { this.onSmash(o); continue; }
      const hit = this.field.hits(o, minX, maxX, minY, maxY);
      if (hit) { this.lastDeath = `${hit} ${o.kind.name} y=${this.y.toFixed(2)} ox=${ox.toFixed(2)}`; this.die(); return; }
      if (ox + o.kind.width / 2 < minX) this.onPass(o);
    }
    this.field.gapH = Math.max(3.9, 5.4 - this.passed * 0.035);

    this.hud.setScore(this.score);
    this.hud.setNitro(this.nitro, this.nitroActive ? 'active' : this.nitro >= 1 ? 'ready' : 'charging');
    this.updateReadyEffects(dt);
  }

  /** Mientras el nitro está cargado: toberas latiendo en azul hielo, ráfagas cortas y pitido suave. */
  private updateReadyEffects(dt: number): void {
    const ready = this.nitro >= 1 && !this.nitroActive;
    if (!ready) {
      this.car.nozzleGlow.emissiveIntensity = THREE.MathUtils.damp(this.car.nozzleGlow.emissiveIntensity, 0, 12, dt);
      this.readyT = 0;
      return;
    }
    this.readyT += dt;
    this.car.nozzleGlow.emissiveIntensity = 2.5 + 2.5 * Math.sin(this.readyT * 14);
    this.readyPuffT -= dt;
    if (this.readyPuffT <= 0) {
      this.readyPuffT = 0.45;
      this.car.group.updateMatrixWorld();
      const dir = this.dirWorld(-1, 0, 0);
      for (const n of this.car.rearNozzles) this.plume.emit(this.nozzleWorld(n), dir, 4, { speed: 5, spread: 0.3, size: 0.6, life: 0.4 });
    }
    this.readyPingT -= dt;
    if (this.readyPingT <= 0) { this.readyPingT = 2.2; this.audio.readyTick(); }
  }

  private updateDead(dt: number): void {
    this.deadTimer += dt;
    this.speed = THREE.MathUtils.damp(this.speed, 0, 2, dt);
    if (this.y > 0) {
      this.vy += GRAVITY * dt;
      this.y = Math.max(0, this.y + this.vy * dt);
      this.car.body.rotation.z += this.spin * dt;
      this.car.body.rotation.x += this.spin * 0.4 * dt;
    }
    this.car.group.position.y = this.y;
    this.field.update(dt, this.speed);
    if (this.deadTimer > 1.3 && !document.getElementById('card-over')?.offsetParent) {
      this.hud.showGameOver(this.score, this.best, this.score > 0 && this.score >= this.best);
      this.hud.setSubmitState(this.score > 0 ? 'idle' : 'hidden', this.score > 0 ? '' : '');
      this.loadBoard('over');
    }
  }

  private updateCamera(dt: number): void {
    const aspect = this.camera.aspect;
    const portrait = Math.max(0, 1.25 - aspect);
    const targetFov = (this.nitroActive ? 66 : 50) + portrait * 14;
    this.camera.fov = THREE.MathUtils.damp(this.camera.fov, targetFov, 4, dt);
    this.camera.updateProjectionMatrix();

    const lookY = this.state === 'title' ? 3.4 - portrait * 2.2 : THREE.MathUtils.clamp(this.y * 0.35 + 2.6, 3.0, 6.5);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const s = this.shake * 0.16;
    const camX = this.state === 'title' ? 7.5 - portrait * 3 : 4.5;
    const camZ = 15 + portrait * 14;
    this.camera.position.set(
      camX + (Math.random() - 0.5) * s,
      lookY + 0.9 + (Math.random() - 0.5) * s,
      camZ,
    );
    this.camTarget.set(camX, lookY, 0);
    this.camera.lookAt(this.camTarget);
  }
}

function showFatal(message: string): void {
  const el = document.getElementById('fatal');
  if (!el) return;
  el.querySelector('p')!.textContent = message;
  el.hidden = false;
}
