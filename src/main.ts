import { Game } from './game';

const canvas = document.getElementById('c') as HTMLCanvasElement;
try {
  new Game(canvas).tick();
} catch (e) {
  console.error(e);
  const fatal = document.getElementById('fatal');
  if (fatal && fatal.hidden) {
    fatal.querySelector('p:not(.eyebrow)')!.textContent = 'Error al iniciar el juego: ' + (e as Error).message;
    fatal.hidden = false;
  }
}
