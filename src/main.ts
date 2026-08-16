import './style.css';
import { setBootStatus } from './bootStatus';
import {
  checkWebOtaStatus,
  getBundleVersionLabelNative,
  isNativeShell,
  notifyAppReadyNative,
  runOtaBootstrapNative,
} from './ota/native-bridge';
import { SITE_OTA_VERSION } from './site-build';
import { getResolvedArtManifestUrl, bootstrapCardArt } from './art/artManifest';
import { countLoadedCustomArtImages } from './art/artImage';
import { DEFAULT_SHOP_LISTINGS, defaultPlayerHand } from './game/catalog';
import { createInitialState } from './game/state';
import type { PixelArtKey } from './game/types';
import type { GameState } from './game/types';
import { GameBoard } from './ui/gameBoard';
import { APP_VERSION } from './version';

const ART_BOOT_TIMEOUT_MS = 12000;

function renderBootStatus(app: HTMLDivElement, text: string): void {
  app.innerHTML = `<div class="boot-status" role="status">${text}</div>`;
}

function renderBootError(app: HTMLDivElement, text: string): void {
  app.innerHTML = `<div class="boot-status boot-status--error" role="alert">${text}</div>`;
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

async function bootstrapCardArtWithTimeout(
  app: HTMLDivElement,
  showBoot: () => boolean
): Promise<Awaited<ReturnType<typeof bootstrapCardArt>>> {
  return Promise.race([
    bootstrapCardArt({
      priorityArtKeys: bootPriorityArtKeys(),
      onProgress: ({ loaded, total }) => {
        if (!showBoot() || total <= 0) return;
        renderBootStatus(app, `加载卡图资源… ${loaded}/${total}`);
      },
    }),
    new Promise<null>((resolve) => {
      window.setTimeout(() => {
        console.warn('[boot] 卡图加载超时，先进入游戏');
        resolve(null);
      }, ART_BOOT_TIMEOUT_MS);
    }),
  ]);
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

  const manifest = await bootstrapCardArtWithTimeout(app, () => showBoot);

  const entryCount = manifest ? Object.keys(manifest.entries).length : 0;
  const loaded = countLoadedCustomArtImages();
  setBootStatus({
    artManifestUrl: getResolvedArtManifestUrl(),
    artEntryCount: entryCount,
    artImageLoaded: loaded,
    artLoadHint:
      loaded === 0 && entryCount === 0
        ? '卡图未加载：请检查网络，或在「绘制」页上传云端'
        : loaded === 0 && entryCount > 0
          ? '卡图清单已读但 PNG 未解码，请检查网络后刷新'
          : loaded < entryCount
            ? `部分卡图已加载（${loaded}/${entryCount}）`
            : '',
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
  const app = document.querySelector<HTMLDivElement>('#app');

  setBootStatus({
    appVersion: APP_VERSION,
    siteOtaVersion: SITE_OTA_VERSION,
    nativeShell: isNativeShell(),
  });

  try {
    if (isNativeShell()) {
      const ota = await runOtaBootstrapNative();
      if (ota.updated) {
        window.location.reload();
        return;
      }
      const label = ota.label || (await getBundleVersionLabelNative());
      setBootStatus({ otaBundleLabel: label, otaDetail: ota.status });
    } else {
      const web = await Promise.race([
        checkWebOtaStatus(SITE_OTA_VERSION),
        new Promise<{ status: string }>((resolve) =>
          window.setTimeout(() => resolve({ status: '版本检查超时，已跳过' }), 8000)
        ),
      ]);
      setBootStatus({ otaDetail: web.status });
    }

    await startApp();
    await notifyAppReadyNative();
  } catch (err) {
    console.error('[boot] failed', err);
    if (app) {
      const msg = err instanceof Error ? err.message : String(err);
      renderBootError(app, `启动失败：${msg}`);
    }
  }
}

void bootstrap();
