import { listArtShopItems, type ArtShopItem } from '../art/artShopStorage';
import { isCloudArtConfigured } from '../art/cloudConfig';
import type { PixelGrid } from '../art/pixelArt';
import { pixelV1ToPixelGrid, type PixelV1Image } from '../art/pixelV1';
import { getModalOverlayMount } from './overlayRoot';

export interface ArtShopModalOptions {
  /** 将 pixel/v1 作品导入当前绘制画布 */
  onImportPixelGrid?: (grid: PixelGrid, item: ArtShopItem) => void;
}

let activeOverlay: HTMLElement | null = null;

function closeArtShopModal(): void {
  activeOverlay?.remove();
  activeOverlay = null;
  document.querySelector('[data-modal="art-shop"]')?.remove();
}

function buildPreview(item: ArtShopItem): HTMLElement {
  if (item.previewUrl) {
    const img = document.createElement('img');
    img.className = 'art-shop-item__preview';
    img.src = item.previewUrl;
    img.alt = item.title;
    img.loading = 'lazy';
    img.decoding = 'async';
    return img;
  }
  const box = document.createElement('div');
  box.className = 'art-shop-item__preview art-shop-item__preview--empty';
  box.textContent = '?';
  return box;
}

function renderList(
  listEl: HTMLElement,
  statusEl: HTMLElement,
  items: ArtShopItem[],
  options: ArtShopModalOptions
): void {
  listEl.innerHTML = '';
  if (!items.length) {
    statusEl.textContent = '商店暂无作品';
    const empty = document.createElement('p');
    empty.className = 'art-shop-empty';
    empty.textContent = '还没有人上传作品。可在 Card World 画板中上传至商店。';
    listEl.append(empty);
    return;
  }
  statusEl.textContent = `共 ${items.length} 件作品`;
  for (const item of items) {
    const row = document.createElement('article');
    row.className = 'art-shop-item';

    const preview = buildPreview(item);
    const meta = document.createElement('div');
    meta.className = 'art-shop-item__meta';
    const title = document.createElement('h3');
    title.className = 'art-shop-item__title';
    title.textContent = item.title || '未命名';
    const text = document.createElement('p');
    text.className = 'art-shop-item__text';
    text.textContent = item.text || '';
    meta.append(title, text);

    const actions = document.createElement('div');
    actions.className = 'art-shop-item__actions';

    if (options.onImportPixelGrid && item.image?.type === 'pixel/v1') {
      const importBtn = document.createElement('button');
      importBtn.type = 'button';
      importBtn.className = 'btn btn--accent';
      importBtn.textContent = '导入画板';
      importBtn.addEventListener('click', () => {
        try {
          const grid = pixelV1ToPixelGrid(item.image as PixelV1Image);
          options.onImportPixelGrid!(grid, item);
          closeArtShopModal();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          window.alert(`导入失败：${msg}`);
        }
      });
      actions.append(importBtn);
    }

    if (item.previewUrl) {
      const dlBtn = document.createElement('button');
      dlBtn.type = 'button';
      dlBtn.className = 'btn';
      dlBtn.textContent = '查看大图';
      dlBtn.addEventListener('click', () => {
        window.open(item.previewUrl!, '_blank', 'noopener,noreferrer');
      });
      actions.append(dlBtn);
    }

    row.append(preview, meta, actions);
    listEl.append(row);
  }
}

export function openArtShopModal(options: ArtShopModalOptions = {}): void {
  closeArtShopModal();

  const overlay = document.createElement('div');
  overlay.className = 'art-shop-overlay';
  overlay.dataset.modal = 'art-shop';

  const panel = document.createElement('div');
  panel.className = 'art-shop-panel';
  panel.innerHTML = `
    <header class="art-shop-panel__head">
      <h2 class="art-shop-panel__title">美术商店</h2>
      <span class="art-shop-panel__status" data-status>加载中…</span>
      <div class="art-shop-panel__head-actions">
        <button type="button" class="btn art-shop-panel__btn" data-fullscreen>全屏</button>
        <button type="button" class="art-shop-panel__close" data-close aria-label="关闭">×</button>
      </div>
    </header>
    <div class="art-shop-panel__body">
      <div class="art-shop-list" data-list></div>
    </div>
  `;

  const statusEl = panel.querySelector<HTMLElement>('[data-status]')!;
  const listEl = panel.querySelector<HTMLElement>('[data-list]')!;
  const fullscreenBtn = panel.querySelector<HTMLButtonElement>('[data-fullscreen]')!;

  const updateFullscreenBtn = (): void => {
    const on = document.fullscreenElement === overlay;
    fullscreenBtn.textContent = on ? '退出全屏' : '全屏';
  };

  fullscreenBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!document.fullscreenElement) {
      void overlay.requestFullscreen?.();
    } else {
      void document.exitFullscreen?.();
    }
  });
  document.addEventListener('fullscreenchange', updateFullscreenBtn);

  panel.querySelector('[data-close]')?.addEventListener('click', () => {
    if (document.fullscreenElement === overlay) void document.exitFullscreen?.();
    closeArtShopModal();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      if (document.fullscreenElement === overlay) void document.exitFullscreen?.();
      closeArtShopModal();
    }
  });
  panel.addEventListener('click', (e) => e.stopPropagation());

  overlay.addEventListener('remove', () => {
    document.removeEventListener('fullscreenchange', updateFullscreenBtn);
  });

  overlay.append(panel);
  getModalOverlayMount().append(overlay);
  activeOverlay = overlay;
  updateFullscreenBtn();

  void (async () => {
    if (!isCloudArtConfigured()) {
      statusEl.textContent = '未配置云端';
      listEl.innerHTML = '<p class="art-shop-empty">Supabase 未配置，无法加载商店。</p>';
      return;
    }
    if (!navigator.onLine) {
      statusEl.textContent = '需要网络';
      listEl.innerHTML = '<p class="art-shop-empty">请连接网络后重试。</p>';
      return;
    }
    try {
      const items = await listArtShopItems();
      renderList(listEl, statusEl, items, options);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      statusEl.textContent = '加载失败';
      listEl.innerHTML = `<p class="art-shop-empty">${msg}</p>`;
    }
  })();
}

export { closeArtShopModal };
