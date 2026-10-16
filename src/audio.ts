/** Sonido sintetizado: siseo de nitrógeno, sin muestras externas. */
export class Audio {
  private ctx?: AudioContext;
  private noise?: AudioBuffer;
  private master?: GainNode;

  /** Debe llamarse desde un gesto del usuario. */
  unlock(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    } catch { return; }
    const sr = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, sr * 2, sr);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  private hiss(duration: number, gain: number, freq: number, q = 0.8): void {
    if (!this.ctx || !this.noise || !this.master) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  flap(): void { this.hiss(0.22, 0.6, 3200, 0.6); }
  roll(): void { this.hiss(0.5, 0.35, 1800, 1.2); }
  nitroStart(): void { this.hiss(3.4, 0.9, 900, 0.4); this.hiss(0.6, 0.8, 4500, 0.5); }
  explode(): void { this.hiss(0.35, 0.9, 400, 0.3); }
  crash(): void { this.hiss(0.7, 1.0, 250, 0.2); }
  readyTick(): void { this.hiss(0.08, 0.25, 5200, 2); }
  ready(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, t);
    o.frequency.setValueAtTime(1320, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.3);
  }
}
