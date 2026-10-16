const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

import type { ScoreRow } from './api';

export type NitroState = 'charging' | 'ready' | 'active';
const NICK_KEY = 'flappy-roadster-nick';

export class Hud {
  private score = $('score');
  private mult = $('mult');
  private speed = $('speed-val');
  private nitro = $('nitro');
  private nitroFill = $('nitro-fill');
  private nitroBtn = $<HTMLButtonElement>('nitro-btn');
  private nitroReady = $('nitro-ready');
  private overlay = $('overlay');
  private cardTitle = $('card-title');
  private cardOver = $('card-over');
  private best = $('best');
  private best2 = $('best2');
  private finalScore = $('final-score');
  private overSub = $('over-sub');
  private form = $<HTMLFormElement>('score-form');
  private nick = $<HTMLInputElement>('nick');
  private submitBtn = $<HTMLButtonElement>('submit-btn');
  private submitMsg = $('submit-msg');
  private boardOver = $('board-over');
  private boardTitle = $('board-title');
  private boardTitleWrap = $('board-title-wrap');
  private lastScore = -1;
  private multTimer = 0;

  constructor() {
    $('start-btn').addEventListener('click', () => this.startCb?.());
    $('retry-btn').addEventListener('click', () => this.retryCb?.());
    this.nitroBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); this.nitroCb?.(); });
    $('board-btn').addEventListener('click', () => { this.boardTitleWrap.hidden = !this.boardTitleWrap.hidden; if (!this.boardTitleWrap.hidden) this.boardCb?.(); });
    this.form.addEventListener('submit', (e) => { e.preventDefault(); const n = this.nick.value.trim(); if (n.length >= 2) this.submitCb?.(n); });
    try { this.nick.value = localStorage.getItem(NICK_KEY) ?? ''; } catch { /* sin almacenamiento */ }
    const touch = matchMedia('(pointer: coarse)').matches;
    $('ready-hint').innerHTML = touch ? 'Mantén pulsado o toca <b>N₂</b>' : 'Pulsa <b>N</b> o mantén el clic';
  }

  private startCb?: () => void;
  private retryCb?: () => void;
  private nitroCb?: () => void;
  private submitCb?: (nick: string) => void;
  private boardCb?: () => void;
  onStart(cb: () => void): void { this.startCb = cb; }
  onRetry(cb: () => void): void { this.retryCb = cb; }
  onNitro(cb: () => void): void { this.nitroCb = cb; }
  onSubmit(cb: (nick: string) => void): void { this.submitCb = cb; }
  onBoardRequest(cb: () => void): void { this.boardCb = cb; }

  /** Pinta un ranking; resalta la fila del jugador si coincide nickname y puntuación. */
  renderBoard(target: 'title' | 'over', rows: ScoreRow[], me?: { nickname: string; score: number }): void {
    const el = target === 'title' ? this.boardTitle : this.boardOver;
    el.replaceChildren();
    if (!rows.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Aún no hay récords. ¡Sé el primero!'; el.appendChild(li); return; }
    let marked = false;
    rows.forEach((r, i) => {
      const li = document.createElement('li');
      const isMe = !marked && me && r.nickname === me.nickname && r.score === me.score;
      if (isMe) { li.classList.add('me'); marked = true; }
      const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = `${i + 1}.`;
      const name = document.createElement('span'); name.className = 'name'; name.textContent = r.nickname;
      const pts = document.createElement('span'); pts.className = 'pts'; pts.textContent = String(r.score);
      li.append(rank, name, pts);
      el.appendChild(li);
    });
  }

  boardMessage(target: 'title' | 'over', text: string): void {
    const el = target === 'title' ? this.boardTitle : this.boardOver;
    const li = document.createElement('li'); li.className = 'empty'; li.textContent = text;
    el.replaceChildren(li);
  }

  setSubmitState(state: 'idle' | 'sending' | 'done' | 'error' | 'hidden', msg = ''): void {
    this.form.hidden = state === 'hidden' || state === 'done';
    this.submitBtn.disabled = state === 'sending';
    this.submitMsg.textContent = msg;
    if (state === 'idle') { this.nick.focus({ preventScroll: true }); }
  }

  rememberNick(n: string): void { try { localStorage.setItem(NICK_KEY, n); } catch { /* sin almacenamiento */ } }

  setScore(n: number): void {
    if (n === this.lastScore) return;
    this.lastScore = n;
    this.score.textContent = String(n);
    this.score.classList.remove('pop');
    void this.score.offsetWidth;
    this.score.classList.add('pop');
  }

  setSpeed(mph: number): void {
    this.speed.textContent = String(Math.round(mph));
  }

  setNitro(fill: number, state: NitroState): void {
    this.nitroFill.style.width = `${Math.round(Math.min(1, Math.max(0, fill)) * 100)}%`;
    this.nitro.classList.toggle('ready', state === 'ready');
    this.nitro.classList.toggle('active', state === 'active');
    this.nitroBtn.classList.toggle('ready', state === 'ready');
    this.nitroReady.hidden = state !== 'ready';
  }

  /** Muestra un texto de bonificación durante `seconds`. */
  flash(text: string, seconds = 0.9, nitro = false): void {
    this.mult.textContent = text;
    this.mult.classList.add('show');
    this.mult.classList.toggle('nitro', nitro);
    this.multTimer = seconds;
  }

  update(dt: number): void {
    if (this.multTimer > 0) {
      this.multTimer -= dt;
      if (this.multTimer <= 0) this.mult.classList.remove('show', 'nitro');
    }
  }

  showTitle(best: number): void {
    this.best.textContent = String(best);
    this.cardTitle.hidden = false;
    this.cardOver.hidden = true;
    this.overlay.hidden = false;
    this.nitroBtn.hidden = true;
    this.nitroReady.hidden = true;
  }

  showGameOver(score: number, best: number, record: boolean): void {
    this.finalScore.textContent = String(score);
    this.best2.textContent = String(best);
    this.overSub.textContent = record ? '¡Nuevo récord!' : 'Los propulsores no bastaron';
    this.cardTitle.hidden = true;
    this.cardOver.hidden = false;
    this.overlay.hidden = false;
    this.nitroBtn.hidden = true;
    this.nitroReady.hidden = true;
  }

  hideOverlay(): void {
    this.overlay.hidden = true;
    this.nitroReady.hidden = true;
    this.nitroBtn.hidden = false;
    this.mult.classList.remove('show', 'nitro');
  }
}
