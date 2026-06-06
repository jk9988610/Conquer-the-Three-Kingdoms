import { ART_GRID_COLS, ART_GRID_ROWS } from '../art/gridConfig';
import {
  applyPixelImportEffectForEditor,
  PIXEL_IMPORT_EFFECTS,
  type PixelImportEffect,
} from '../art/pixelGridEffects';
import { drawPackedPreview, prepareSharpCanvas, type PixelGrid } from '../art/pixelArt';
import { gridToPacked } from '../art/packedGrid';
import { ART_PREVIEW_HEIGHT, ART_PREVIEW_WIDTH } from '../tcg/dimensions';
import { getModalOverlayMount } from './overlayRoot';

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

/** 与编辑器预览区一致：展示块级效果 → 75×105 像素绘制 */
function packedForPreview(grid: PixelGrid, effect: PixelImportEffect) {
  const processed = applyPixelImportEffectForEditor(grid, effect);
  return gridToPacked(processed);
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
      <h3 class="img-import-modal__title">像素画效果</h3>
      <p class="img-import-modal__hint">选择一种观感处理，预览区会实时更新（与绘制页预览一致）</p>
    </header>
    <section class="img-import-effect__preview-pane">
      <div class="img-import-effect__preview-label">预览</div>
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
  const optionsEl = modal.querySelector<HTMLElement>('[data-effect-options]')!;

  previewSurface.style.width = `${ART_PREVIEW_WIDTH}px`;
  previewSurface.style.height = `${ART_PREVIEW_HEIGHT}px`;

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
    for (const [id, btn] of optionButtons) {
      btn.classList.toggle('img-import-effect__option--active', id === effect);
    }
    renderPreview();
  }

  function renderPreview(): void {
    const prepared = prepareSharpCanvas(
      previewCanvas,
      ART_PREVIEW_WIDTH,
      ART_PREVIEW_HEIGHT
    );
    if (!prepared) return;
    const { ctx } = prepared;
    ctx.clearRect(0, 0, ART_PREVIEW_WIDTH, ART_PREVIEW_HEIGHT);
    const packed = packedForPreview(grid, selected);
    drawPackedPreview(
      ctx,
      packed,
      ART_PREVIEW_WIDTH,
      ART_PREVIEW_HEIGHT,
      ART_GRID_COLS,
      ART_GRID_ROWS
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
