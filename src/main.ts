import './style.css';
import {
  checkWebOtaStatus,
  isNativeShell,
  notifyAppReadyNative,
  runOtaBootstrapNative,
} from './ota/native-bridge';
import { SITE_OTA_VERSION } from './site-build';
import { bootstrapCardArt } from './art/artManifest';
import { DEFAULT_SHOP_LISTINGS, defaultPlayerHand } from './game/catalog';
import { createInitialState } from './game/state';
import type { PixelArtKey } from './game/types';
import type { GameState } from './game/types';
import { GameBoard } from './ui/gameBoard';

function renderBootStatus(app: HTMLDivElement, text: string): void {
  app.innerHTML = `<div class="boot-status" role="status">${text}</div>`;
}

/** 启动优先加载：手牌 + 商店 + 通用占位图 */
function bootPriorityArtKeys(): PixelArtKey[] {
  const keys = new Set<PixelArtKey>();
  for (const card of defaultPlayerHand()) {
    if (card.artKey) keys.add(card.artKey);
  }
  for (const listing of DEFAULT_SHOP_LISTINGS) {
    if (listing.template.artKey) keys.add(listing.template.artKey);
  }
  keys.add('generic');
  return [...keys];
}

async function startApp(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) {
    throw new Error('未找到 #app 容器');
  }

  let showBoot = false;
  const bootTimer = window.setTimeout(() => {
    showBoot = true;
    renderBootStatus(app, '加载卡图资源…');
  }, 280);

  await bootstrapCardArt({
    priorityArtKeys: bootPriorityArtKeys(),
    onProgress: ({ loaded, total }) => {
      if (!showBoot || total <= 0) return;
      renderBootStatus(app, `加载卡图资源… ${loaded}/${total}`);
    },
  });

  window.clearTimeout(bootTimer);

  app.innerHTML = '';

  let gameState: GameState = createInitialState(defaultPlayerHand());

  new GameBoard(app, gameState, {
    onStateChange: (state) => {
      gameState = state;
    },
  });
}

async function bootstrap(): Promise<void> {
  if (isNativeShell()) {
    const ota = await runOtaBootstrapNative();
    if (ota.updated) {
      window.location.reload();
      return;
    }
    if (ota.status) console.info('[ota]', ota.status);
  } else {
    const web = await checkWebOtaStatus(SITE_OTA_VERSION);
    if (web.status) console.info('[ota]', web.status);
  }

  await startApp();
  await notifyAppReadyNative();
}

void bootstrap();
