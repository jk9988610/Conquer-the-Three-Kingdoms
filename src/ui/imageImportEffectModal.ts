import {
  applyPixelImportEffect,
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
      <h3 class="img-import-modal__title">像素画效果</h3>
      <p class="img-import-modal__hint">选择一种观感处理，预览区会实时更新</p>
    </header>
    <div class="img-import-effect__preview-wrap" data-preview-wrap>
      <canvas class="img-import-effect__preview" data-preview-canvas></canvas>
    </div>
    <div class="img-import-effect__options" data-effect-options></div>
    <footer class="img-import-modal__actions">
      <button type="button" class="btn" data-cancel>取消</button>
      <button type="button" class="btn" data-confirm>确定</button>
    </footer>
  `;

  const previewWrap = modal.querySelector<HTMLElement>('[data-preview-wrap]')!;
  const previewCanvas = modal.querySelector<HTMLCanvasElement>('[data-preview-canvas]')!;
  const optionsEl = modal.querySelector<HTMLElement>('[data-effect-options]')!;

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
    const rect = previewWrap.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    const prepared = prepareSharpCanvas(previewCanvas, width, height);
    if (!prepared) return;
    const { ctx } = prepared;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0c1018';
    ctx.fillRect(0, 0, width, height);
    const processed = applyPixelImportEffect(grid, selected);
    drawGridToCanvas(ctx, processed, width, height, 'fit');
  }

  function finishConfirm(): void {
    const processed = applyPixelImportEffect(grid, selected);
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

  const ro = new ResizeObserver(() => renderPreview());
  ro.observe(previewWrap);
  overlay.__effectRo = ro;

  selectEffect('standard');
  requestAnimationFrame(() => {
    renderPreview();
    requestAnimationFrame(renderPreview);
  });
}
