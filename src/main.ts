import { Game } from './game';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const game = new Game(canvas);
game.tick();
