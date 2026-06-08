import './style.css';
import { bootstrapCardArt } from './art/artManifest';
import { defaultPlayerHand } from './game/catalog';
import { createInitialState } from './game/state';
import type { GameState } from './game/types';
import { GameBoard } from './ui/gameBoard';

function renderBootStatus(app: HTMLDivElement, text: string): void {
  app.innerHTML = `<div class="boot-status" role="status">${text}</div>`;
}

async function startApp(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) {
    throw new Error('未找到 #app 容器');
  }

  renderBootStatus(app, '加载卡图资源…');

  await bootstrapCardArt({
    onProgress: ({ loaded, total }) => {
      if (total <= 0) {
        renderBootStatus(app, '加载卡图资源…');
        return;
      }
      renderBootStatus(app, `加载卡图资源… ${loaded}/${total}`);
    },
  });

  app.innerHTML = '';

  let gameState: GameState = createInitialState(defaultPlayerHand());

  new GameBoard(app, gameState, {
    onStateChange: (state) => {
      gameState = state;
    },
  });
}

void startApp();
