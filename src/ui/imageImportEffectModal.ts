import {
  ART_DISPLAY_COLS,
  ART_DISPLAY_ROWS,
} from '../art/gridConfig';
import {
  applyPixelImportEffectForEditor,
  applyPixelImportEffectOnDisplay,
  PIXEL_IMPORT_EFFECTS,
  type PixelImportEffect,
} from '../art/pixelGridEffects';
import { drawGridToCanvas, prepareSharpCanvas, type PixelGrid } from '../art/pixelArt';
import { getModalOverlayMount } from './overlayRoot';

/** 与绘制页预览一致：每展示像素 2×2 CSS 像素，整数倍放大 */
const PREVIEW_CELL_PX = 2;
const PREVIEW_CSS_WIDTH = ART_DISPLAY_COLS * PREVIEW_CELL_PX;
const PREVIEW_CSS_HEIGHT = ART_DISPLAY_ROWS * PREVIEW_CELL_PX;

export interface ImageImportEffectModalOptions {
  grid: PixelGrid;
  onConfirm: (grid: PixelGrid) => void;
  onCancel?: () => void;
}

type EffectOverlay = HTMLElement & { __effectRo?: ResizeObserver };

export function closeImageImportEffectModal(): void {
  const overlay = document.querySelector<EffectOverlay>('[data-modal="image-import-effect"]');
  overlay?.__effectRo?.disconnect();
  overlay?.remove();
}

export function openImageImportEffectModal(options: ImageImportEffectModalOptions): void {
  closeImageImportEffectModal();

  const { grid, onConfirm, onCancel } = options;
  let selected: PixelImportEffect = 'standard';

  const overlay = document.createElement('div') as EffectOverlay;
  overlay.className = 'img-import-overlay';
  overlay.dataset.modal = 'image-import-effect';

  const modal = document.createElement('div');
  modal.className = 'img-import-modal img-import-modal--effects';
  modal.innerHTML = `
    <header class="img-import-modal__head">
      <h3 class="img-import-modal__title">选择像素画效果</h3>
      <p class="img-import-modal__hint">以下为像素化预览（75×105），切换效果可实时对比</p>
    </header>
    <section class="img-import-effect__preview-pane">
      <div class="img-import-effect__preview-label">预览 · <span data-effect-name>标准</span></div>
      <div class="img-import-effect__preview-wrap" data-preview-wrap>
        <div class="img-import-effect__art-surface" data-preview-surface>
          <canvas data-preview-canvas></canvas>
        </div>
      </div>
    </section>
    <div class="img-import-effect__options" data-effect-options></div>
    <footer class="img-import-modal__actions">
      <button type="button" class="btn" data-cancel>取消</button>
      <button type="button" class="btn" data-confirm>确定</button>
    </footer>
  `;

  const previewSurface = modal.querySelector<HTMLElement>('[data-preview-surface]')!;
  const previewCanvas = modal.querySelector<HTMLCanvasElement>('[data-preview-canvas]')!;
  const effectNameEl = modal.querySelector<HTMLElement>('[data-effect-name]')!;
  const optionsEl = modal.querySelector<HTMLElement>('[data-effect-options]')!;

  previewSurface.style.width = `${PREVIEW_CSS_WIDTH}px`;
  previewSurface.style.height = `${PREVIEW_CSS_HEIGHT}px`;

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
    const prepared = prepareSharpCanvas(
      previewCanvas,
      ART_DISPLAY_COLS,
      ART_DISPLAY_ROWS
    );
    if (!prepared) return;
    const { ctx } = prepared;
    previewCanvas.style.width = `${PREVIEW_CSS_WIDTH}px`;
    previewCanvas.style.height = `${PREVIEW_CSS_HEIGHT}px`;
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
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) finishCancel();
  });
  modal.addEventListener('click', (e) => e.stopPropagation());

  overlay.append(modal);
  getModalOverlayMount().append(overlay);

  selectEffect('standard');
  requestAnimationFrame(() => {
    renderPreview();
    requestAnimationFrame(renderPreview);
  });
}
