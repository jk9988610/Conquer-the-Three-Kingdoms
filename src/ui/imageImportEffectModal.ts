import {
  ART_DISPLAY_COLS,
  ART_DISPLAY_ROWS,
} from '../art/gridConfig';
import { gridDrawLayout } from '../art/packedGrid';
import {
  applyPixelImportEffectForEditor,
  applyPixelImportEffectOnDisplay,
  PIXEL_IMPORT_EFFECTS,
  type PixelImportEffect,
} from '../art/pixelGridEffects';
import { drawGridToCanvas, prepareSharpCanvas, type PixelGrid } from '../art/pixelArt';
import { getModalOverlayMount } from './overlayRoot';

export interface ImageImportEffectModalOptions {
  grid: PixelGrid;
  onConfirm: (grid: PixelGrid) => void;
  onCancel?: () => void;
}

type EffectOverlay = HTMLElement & {
  __effectRo?: ResizeObserver;
  __onFullscreenChange?: () => void;
};

export function closeImageImportEffectModal(): void {
  const overlay = document.querySelector<EffectOverlay>('[data-modal="image-import-effect"]');
  if (overlay) {
    overlay.__effectRo?.disconnect();
    if (overlay.__onFullscreenChange) {
      document.removeEventListener('fullscreenchange', overlay.__onFullscreenChange);
    }
    if (document.fullscreenElement === overlay) {
      void document.exitFullscreen?.();
    }
  }
  overlay?.remove();
}

export function openImageImportEffectModal(options: ImageImportEffectModalOptions): void {
  closeImageImportEffectModal();

  const { grid, onConfirm, onCancel } = options;
  let selected: PixelImportEffect = 'standard';

  const overlay = document.createElement('div') as EffectOverlay;
  overlay.className = 'img-import-overlay img-import-overlay--page';
  overlay.dataset.modal = 'image-import-effect';

  const modal = document.createElement('div');
  modal.className = 'img-import-modal img-import-modal--effects img-import-modal--page';
  modal.innerHTML = `
    <header class="img-import-effect__topbar">
      <div class="img-import-effect__topbar-main">
        <h3 class="img-import-effect__title">选择像素画效果</h3>
        <p class="img-import-effect__subtitle">左侧为像素化预览（75×105），右侧切换效果实时对比</p>
      </div>
      <div class="img-import-effect__topbar-actions">
        <button type="button" class="btn img-import-effect__topbar-btn" data-fullscreen>全屏</button>
        <button type="button" class="img-import-effect__close" data-close aria-label="关闭">×</button>
      </div>
    </header>
    <div class="img-import-effect__body">
      <section class="img-import-effect__preview-col">
        <div class="img-import-effect__preview-label">预览 · <span data-effect-name>标准</span></div>
        <div class="img-import-effect__preview-wrap" data-preview-wrap>
          <div class="img-import-effect__art-surface" data-preview-surface>
            <canvas data-preview-canvas></canvas>
          </div>
        </div>
      </section>
      <aside class="img-import-effect__sidebar">
        <div class="img-import-effect__options" data-effect-options></div>
        <footer class="img-import-effect__actions">
          <button type="button" class="btn" data-cancel>取消</button>
          <button type="button" class="btn" data-confirm>确定</button>
        </footer>
      </aside>
    </div>
  `;

  const previewWrap = modal.querySelector<HTMLElement>('[data-preview-wrap]')!;
  const previewSurface = modal.querySelector<HTMLElement>('[data-preview-surface]')!;
  const previewCanvas = modal.querySelector<HTMLCanvasElement>('[data-preview-canvas]')!;
  const effectNameEl = modal.querySelector<HTMLElement>('[data-effect-name]')!;
  const optionsEl = modal.querySelector<HTMLElement>('[data-effect-options]')!;
  const fullscreenBtn = modal.querySelector<HTMLButtonElement>('[data-fullscreen]')!;

  const optionButtons = new Map<PixelImportEffect, HTMLButtonElement>();

  for (const opt of PIXEL_IMPORT_EFFECTS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'img-import-effect__option';
    btn.dataset.effect = opt.id;
    btn.innerHTML = `<span class="img-import-effect__option-label">${opt.label}</span><span class="img-import-effect__option-desc">${opt.description}</span>`;
    btn.addEventListener('click', () => selectEffect(opt.id));
    optionsEl.append(btn);
    optionButtons.set(opt.id, btn);
  }

  function updateFullscreenBtn(): void {
    const on = document.fullscreenElement === overlay;
    fullscreenBtn.textContent = on ? '退出全屏' : '全屏';
  }

  const onFullscreenChange = (): void => {
    updateFullscreenBtn();
    requestAnimationFrame(renderPreview);
  };
  overlay.__onFullscreenChange = onFullscreenChange;
  document.addEventListener('fullscreenchange', onFullscreenChange);

  fullscreenBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!document.fullscreenElement) {
      void overlay.requestFullscreen?.();
    } else {
      void document.exitFullscreen?.();
    }
  });

  function selectEffect(effect: PixelImportEffect): void {
    selected = effect;
    const meta = PIXEL_IMPORT_EFFECTS.find((o) => o.id === effect);
    if (effectNameEl && meta) effectNameEl.textContent = meta.label;
    for (const [id, btn] of optionButtons) {
      btn.classList.toggle('img-import-effect__option--active', id === effect);
    }
    renderPreview();
  }

  function renderPreview(): void {
    const rect = previewWrap.getBoundingClientRect();
    const availW = Math.max(1, Math.floor(rect.width));
    const availH = Math.max(1, Math.floor(rect.height));
    const { cell } = gridDrawLayout(
      ART_DISPLAY_COLS,
      ART_DISPLAY_ROWS,
      availW,
      availH,
      'fit'
    );
    const cellPx = Math.max(1, Math.floor(cell));
    const cssW = ART_DISPLAY_COLS * cellPx;
    const cssH = ART_DISPLAY_ROWS * cellPx;

    previewSurface.style.width = `${cssW}px`;
    previewSurface.style.height = `${cssH}px`;

    const prepared = prepareSharpCanvas(
      previewCanvas,
      ART_DISPLAY_COLS,
      ART_DISPLAY_ROWS
    );
    if (!prepared) return;
    const { ctx } = prepared;
    previewCanvas.style.width = `${cssW}px`;
    previewCanvas.style.height = `${cssH}px`;
    ctx.clearRect(0, 0, ART_DISPLAY_COLS, ART_DISPLAY_ROWS);
    const display = applyPixelImportEffectOnDisplay(grid, selected);
    drawGridToCanvas(
      ctx,
      display,
      ART_DISPLAY_COLS,
      ART_DISPLAY_ROWS,
      'fit'
    );
  }

  function finishConfirm(): void {
    const processed = applyPixelImportEffectForEditor(grid, selected);
    closeImageImportEffectModal();
    onConfirm(processed);
  }

  function finishCancel(): void {
    onCancel?.();
    closeImageImportEffectModal();
  }

  const confirmBtn = modal.querySelector<HTMLButtonElement>('[data-confirm]')!;
  const cancelBtn = modal.querySelector<HTMLButtonElement>('[data-cancel]')!;
  confirmBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    finishConfirm();
  });
  cancelBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    finishCancel();
  });
  modal.querySelector('[data-close]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    finishCancel();
  });
  modal.addEventListener('click', (e) => e.stopPropagation());

  overlay.append(modal);
  getModalOverlayMount().append(overlay);

  const ro = new ResizeObserver(() => renderPreview());
  ro.observe(previewWrap);
  overlay.__effectRo = ro;

  updateFullscreenBtn();
  selectEffect('standard');
  requestAnimationFrame(() => {
    renderPreview();
    requestAnimationFrame(renderPreview);
  });
}
