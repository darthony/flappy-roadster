export type Action = 'flap' | 'roll' | 'nitro';
type Handler = () => void;

const HOLD_MS = 380;
const SWIPE_PX = 36;
const DOUBLE_TAP_MS = 0;

/**
 * Entrada unificada: toque/clic = ráfaga, deslizar = barrel roll,
 * mantener = nitro. Teclado: Espacio, R, N (o Shift / Enter).
 */
export class Input {
  private handlers: Record<Action, Handler[]> = { flap: [], roll: [], nitro: [] };
  private holdTimer: number | undefined;
  private startX = 0;
  private startY = 0;
  private swiped = false;
  private pointerDown = false;

  constructor(target: HTMLElement) {
    target.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.card, #nitro-btn')) return;
      e.preventDefault();
      this.pointerDown = true;
      this.swiped = false;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.fire('flap');
      clearTimeout(this.holdTimer);
      this.holdTimer = window.setTimeout(() => { if (this.pointerDown && !this.swiped) this.fire('nitro'); }, HOLD_MS);
    }, { passive: false });
    const end = () => { this.pointerDown = false; clearTimeout(this.holdTimer); };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    target.addEventListener('pointermove', (e) => {
      if (!this.pointerDown || this.swiped) return;
      const dx = e.clientX - this.startX, dy = e.clientY - this.startY;
      if (dx * dx + dy * dy > SWIPE_PX * SWIPE_PX) {
        this.swiped = true;
        clearTimeout(this.holdTimer);
        this.fire('roll');
      }
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if ((e.target as HTMLElement).closest?.('input, textarea, button')) return;
      switch (e.code) {
        case 'Space': case 'ArrowUp': case 'KeyW':
          e.preventDefault(); this.fire('flap'); break;
        case 'KeyR': case 'ArrowRight': case 'ArrowDown': case 'KeyD':
          e.preventDefault(); this.fire('roll'); break;
        case 'KeyN': case 'ShiftLeft': case 'ShiftRight': case 'Enter':
          e.preventDefault(); this.fire('nitro'); break;
      }
    });
    void DOUBLE_TAP_MS;
  }

  on(action: Action, h: Handler): void {
    this.handlers[action].push(h);
  }

  private fire(action: Action): void {
    for (const h of this.handlers[action]) h();
  }
}
