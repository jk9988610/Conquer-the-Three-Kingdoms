import './style.css';
import { defaultHand } from './game/catalog';
import { createInitialState } from './game/state';
import type { GameState } from './game/types';
import { GameBoard } from './ui/gameBoard';

let gameState: GameState = createInitialState(defaultHand());

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('未找到 #app 容器');
}

new GameBoard(app, gameState, {
  onStateChange: (state) => {
    gameState = state;
  },
});
