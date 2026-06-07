import {
  ART_DISPLAY_COLS,
  ART_DISPLAY_ROWS,
} from '../art/gridConfig';
import { gridDrawLayout } from '../art/packedGrid';
import {
  applyImportEffectLocalOnDisplay,
  applyPixelImportMixForEditor,
  applyPixelImportMixOnDisplay,
  clonePixelImportMix,
  createDefaultEffectMix,
  describeEffectMix,
  formatImportEffectSliderValue,
  mergeDisplayRectIntoLogicalGrid,
  isThresholdImportEffect,
  PIXEL_IMPORT_EFFECTS,
  type PixelImportEffect,
  type PixelImportEffectMix,
} from '../art/pixelGridEffects';
import { drawGridToCanvas, prepareSharpCanvas, type PixelGrid } from '../art/pixelArt';
import { loadImageFromFile } from '../art/imageToGrid';
import { createRangeSliderRow } from './rangeSliderRow';
import { openImageImportModal } from './imageImportModal';
import { getModalOverlayMount } from './overlayRoot';

const MAX_EFFECT_UNDO = 10;

export interface ImageImportEffectModalOptions {
  grid: PixelGrid;
  cols: number;
  rows: number;
  onConfirm: (grid: PixelGrid) => void;
  onCancel?: () => void;
}

type EffectOverlay = HTMLElement & {
  __effectRo?: ResizeObserver;
  __onFullscreenChange?: () => void;
};

interface EffectHistoryEntry {
  grid: PixelGrid;
  mix: PixelImportEffectMix;
}

function clonePixelGrid(grid: PixelGrid): PixelGrid {
  return grid.map((row) => [...row]);
}

function normalizeDisplayRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): { x: number; y: number; w: number; h: number } {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return { x, y, w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 };
}

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

  const { cols, rows, onConfirm, onCancel } = options;
  let currentGrid = options.grid;
  const mix = createDefaultEffectMix();
  const undoStack: EffectHistoryEntry[] = [];
  const redoStack: EffectHistoryEntry[] = [];

  const overlay = document.createElement('div') as EffectOverlay;
  overlay.className = 'img-import-overlay img-import-overlay--page';
  overlay.dataset.modal = 'image-import-effect';

  const modal = document.createElement('div');
  modal.className = 'img-import-modal img-import-modal--effects img-import-modal--page';
  modal.innerHTML = `
    <header class="img-import-effect__topbar">
      <div class="img-import-effect__topbar-main">
        <h3 class="img-import-effect__title">调配像素画效果</h3>
        <p class="img-import-effect__subtitle">拖动滑条预览全图；点「框选」后在左侧拉框，框内立即生效</p>
      </div>
      <div class="img-import-effect__topbar-actions">
        <button type="button" class="btn img-import-effect__topbar-btn" data-fullscreen>全屏</button>
        <button type="button" class="img-import-effect__close" data-close aria-label="关闭">×</button>
      </div>
    </header>
    <div class="img-import-effect__body">
      <section class="img-import-effect__preview-col">
        <div class="img-import-effect__preview-label">预览 · <span data-effect-name>原图</span></div>
        <div class="img-import-effect__preview-wrap" data-preview-wrap>
          <div class="img-import-effect__art-surface" data-preview-surface>
            <canvas data-preview-canvas></canvas>
            <div class="img-import-effect__sel-box" data-preview-sel hidden></div>
          </div>
        </div>
      </section>
      <aside class="img-import-effect__sidebar">
        <div class="img-import-effect__sliders" data-effect-sliders></div>
        <footer class="img-import-effect__actions">
          <button type="button" class="btn" data-undo disabled>撤回</button>
          <button type="button" class="btn" data-redo disabled>重做</button>
          <button type="button" class="btn" data-change-image>换图</button>
          <button type="button" class="btn" data-reset>重置</button>
          <button type="button" class="btn" data-cancel>取消</button>
          <button type="button" class="btn" data-confirm>确定</button>
          <input type="file" accept="image/*" hidden data-change-file />
        </footer>
      </aside>
    </div>
  `;

  const previewWrap = modal.querySelector<HTMLElement>('[data-preview-wrap]')!;
  const previewSurface = modal.querySelector<HTMLElement>('[data-preview-surface]')!;
  const previewCanvas = modal.querySelector<HTMLCanvasElement>('[data-preview-canvas]')!;
  const previewSelBox = modal.querySelector<HTMLElement>('[data-preview-sel]')!;
  const effectNameEl = modal.querySelector<HTMLElement>('[data-effect-name]')!;
  const slidersEl = modal.querySelector<HTMLElement>('[data-effect-sliders]')!;
  const fullscreenBtn = modal.querySelector<HTMLButtonElement>('[data-fullscreen]')!;
  const undoBtn = modal.querySelector<HTMLButtonElement>('[data-undo]')!;
  const redoBtn = modal.querySelector<HTMLButtonElement>('[data-redo]')!;

  const sliderByEffect = new Map<
    Exclude<PixelImportEffect, 'standard'>,
    ReturnType<typeof createRangeSliderRow>
  >();
  const boxBtnByEffect = new Map<
    Exclude<PixelImportEffect, 'standard'>,
    HTMLButtonElement
  >();

  let armedBoxEffect: Exclude<PixelImportEffect, 'standard'> | null = null;
  let boxSelectStart: { x: number; y: number } | null = null;
  let boxPointerId: number | null = null;

  function updateEffectUndoRedo(): void {
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  function pushEffectUndo(): void {
    undoStack.push({
      grid: clonePixelGrid(currentGrid),
      mix: clonePixelImportMix(mix),
    });
    if (undoStack.length > MAX_EFFECT_UNDO) undoStack.shift();
    redoStack.length = 0;
    updateEffectUndoRedo();
  }

  function restoreEffectHistory(entry: EffectHistoryEntry): void {
    currentGrid = clonePixelGrid(entry.grid);
    const defaults = createDefaultEffectMix();
    for (const key of Object.keys(defaults) as (keyof PixelImportEffectMix)[]) {
      mix[key] = entry.mix[key] ?? 0;
    }
    for (const [id, slider] of sliderByEffect) {
      slider.setValue(mix[id] ?? 0, { silent: true });
    }
    updateBoxButtons();
    updateMixLabel();
    renderPreview();
  }

  function effectUndo(): void {
    if (undoStack.length === 0) return;
    redoStack.push({
      grid: clonePixelGrid(currentGrid),
      mix: clonePixelImportMix(mix),
    });
    const entry = undoStack.pop()!;
    restoreEffectHistory(entry);
    updateEffectUndoRedo();
  }

  function effectRedo(): void {
    if (redoStack.length === 0) return;
    undoStack.push({
      grid: clonePixelGrid(currentGrid),
      mix: clonePixelImportMix(mix),
    });
    const entry = redoStack.pop()!;
    restoreEffectHistory(entry);
    updateEffectUndoRedo();
  }

  function updateBoxButtons(): void {
    for (const [id, btn] of boxBtnByEffect) {
      const strength = mix[id] ?? 0;
      btn.disabled = strength <= 0;
      btn.classList.toggle(
        'img-import-effect__box-btn--armed',
        armedBoxEffect === id
      );
    }
    previewSurface.classList.toggle(
      'img-import-effect__art-surface--box-armed',
      armedBoxEffect !== null
    );
  }

  function cancelBoxSelect(): void {
    armedBoxEffect = null;
    boxSelectStart = null;
    boxPointerId = null;
    previewSelBox.hidden = true;
    updateBoxButtons();
  }

  function displayCellFromPreview(
    clientX: number,
    clientY: number
  ): { x: number; y: number } | null {
    const rect = previewCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return null;
    const x = Math.min(
      ART_DISPLAY_COLS - 1,
      Math.max(0, Math.ceil(nx * ART_DISPLAY_COLS) - 1)
    );
    const y = Math.min(
      ART_DISPLAY_ROWS - 1,
      Math.max(0, Math.ceil(ny * ART_DISPLAY_ROWS) - 1)
    );
    return { x, y };
  }

  function updatePreviewSelBox(rect: { x: number; y: number; w: number; h: number }): void {
    const canvasRect = previewCanvas.getBoundingClientRect();
    const surfaceRect = previewSurface.getBoundingClientRect();
    const cellW = canvasRect.width / ART_DISPLAY_COLS;
    const cellH = canvasRect.height / ART_DISPLAY_ROWS;
    const offsetX = canvasRect.left - surfaceRect.left;
    const offsetY = canvasRect.top - surfaceRect.top;
    previewSelBox.hidden = false;
    previewSelBox.style.left = `${offsetX + rect.x * cellW}px`;
    previewSelBox.style.top = `${offsetY + rect.y * cellH}px`;
    previewSelBox.style.width = `${rect.w * cellW}px`;
    previewSelBox.style.height = `${rect.h * cellH}px`;
  }

  function bakeLocalEffect(
    effectId: Exclude<PixelImportEffect, 'standard'>,
    displayRect: { x: number; y: number; w: number; h: number }
  ): void {
    const strength = mix[effectId] ?? 0;
    if (strength <= 0 || displayRect.w < 1 || displayRect.h < 1) return;

    pushEffectUndo();
    const mixSans = clonePixelImportMix(mix);
    mixSans[effectId] = 0;
    const displaySans = applyPixelImportMixOnDisplay(currentGrid, mixSans);
    const displayPatched = applyImportEffectLocalOnDisplay(
      displaySans,
      effectId,
      strength,
      displayRect
    );
    currentGrid = mergeDisplayRectIntoLogicalGrid(
      currentGrid,
      displayPatched,
      displayRect
    );
    mix[effectId] = 0;
    sliderByEffect.get(effectId)?.setValue(0, { silent: true });
    cancelBoxSelect();
    updateMixLabel();
    renderPreview();
  }

  for (const opt of PIXEL_IMPORT_EFFECTS) {
    const effectId = opt.id as Exclude<PixelImportEffect, 'standard'>;
    const isThreshold = isThresholdImportEffect(effectId);
    const rowWrap = document.createElement('div');
    rowWrap.className = `img-import-effect__slider-row range-slider-row${
      isThreshold ? ' img-import-effect__slider-row--threshold' : ''
    }`;

    const slider = createRangeSliderRow({
      label: opt.label,
      description: opt.description,
      value: 0,
      formatValue: (v) => formatImportEffectSliderValue(effectId, v),
      onChange: (v) => {
        mix[effectId] = v;
        updateBoxButtons();
        updateMixLabel();
        renderPreview();
      },
    });

    const boxBtn = document.createElement('button');
    boxBtn.type = 'button';
    boxBtn.className = 'btn img-import-effect__box-btn';
    boxBtn.textContent = '框选';
    boxBtn.title = '在预览区拉框，按当前滑条值仅对框内立即生效';
    boxBtn.disabled = true;
    boxBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if ((mix[effectId] ?? 0) <= 0) return;
      armedBoxEffect = armedBoxEffect === effectId ? null : effectId;
      boxSelectStart = null;
      previewSelBox.hidden = true;
      updateBoxButtons();
    });

    const boxRow = document.createElement('div');
    boxRow.className = 'img-import-effect__box-row';
    boxRow.append(boxBtn);

    rowWrap.append(slider.root, boxRow);
    slidersEl.append(rowWrap);
    sliderByEffect.set(effectId, slider);
    boxBtnByEffect.set(effectId, boxBtn);
  }

  function updateMixLabel(): void {
    if (effectNameEl) effectNameEl.textContent = describeEffectMix(mix);
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
    const display = applyPixelImportMixOnDisplay(currentGrid, mix);
    drawGridToCanvas(
      ctx,
      display,
      ART_DISPLAY_COLS,
      ART_DISPLAY_ROWS,
      'fit'
    );
  }

  function resetMix(): void {
    pushEffectUndo();
    const defaults = createDefaultEffectMix();
    for (const key of Object.keys(defaults) as (keyof PixelImportEffectMix)[]) {
      mix[key] = defaults[key];
    }
    sliderByEffect.forEach((handle) => handle.setValue(0, { silent: true }));
    cancelBoxSelect();
    updateBoxButtons();
    updateMixLabel();
    renderPreview();
  }

  function finishConfirm(): void {
    const processed = applyPixelImportMixForEditor(currentGrid, mix);
    closeImageImportEffectModal();
    onConfirm(processed);
  }

  function finishCancel(): void {
    onCancel?.();
    closeImageImportEffectModal();
  }

  const changeFileInput = modal.querySelector<HTMLInputElement>('[data-change-file]')!;

  changeFileInput.addEventListener('change', () => {
    const file = changeFileInput.files?.[0];
    changeFileInput.value = '';
    if (!file) return;

    void (async () => {
      try {
        const img = await loadImageFromFile(file);
        openImageImportModal({
          image: img,
          cols,
          rows,
          onConfirm: (imported) => {
            pushEffectUndo();
            currentGrid = imported;
            renderPreview();
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '导入失败';
        window.alert(msg);
      }
    })();
  });

  previewSurface.addEventListener('pointerdown', (e) => {
    if (!armedBoxEffect) return;
    const cell = displayCellFromPreview(e.clientX, e.clientY);
    if (!cell) return;
    e.preventDefault();
    e.stopPropagation();
    boxSelectStart = cell;
    boxPointerId = e.pointerId;
    previewSurface.setPointerCapture(e.pointerId);
    updatePreviewSelBox({ x: cell.x, y: cell.y, w: 1, h: 1 });
  });

  previewSurface.addEventListener('pointermove', (e) => {
    if (!armedBoxEffect || boxSelectStart === null || boxPointerId !== e.pointerId) return;
    const cell = displayCellFromPreview(e.clientX, e.clientY);
    if (!cell) return;
    e.preventDefault();
    updatePreviewSelBox(
      normalizeDisplayRect(boxSelectStart.x, boxSelectStart.y, cell.x, cell.y)
    );
  });

  const finishBoxSelect = (e: PointerEvent): void => {
    if (!armedBoxEffect || boxSelectStart === null || boxPointerId !== e.pointerId) return;
    const cell = displayCellFromPreview(e.clientX, e.clientY) ?? boxSelectStart;
    const displayRect = normalizeDisplayRect(
      boxSelectStart.x,
      boxSelectStart.y,
      cell.x,
      cell.y
    );
    const effectId = armedBoxEffect;
    previewSurface.releasePointerCapture(e.pointerId);
    boxPointerId = null;
    boxSelectStart = null;
    previewSelBox.hidden = true;
    bakeLocalEffect(effectId, displayRect);
  };

  previewSurface.addEventListener('pointerup', finishBoxSelect);
  previewSurface.addEventListener('pointercancel', finishBoxSelect);

  modal.querySelector('[data-change-image]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    changeFileInput.click();
  });
  modal.querySelector('[data-undo]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    effectUndo();
  });
  modal.querySelector('[data-redo]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    effectRedo();
  });
  modal.querySelector('[data-reset]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    resetMix();
  });
  modal.querySelector('[data-confirm]')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    finishConfirm();
  });
  modal.querySelector('[data-cancel]')?.addEventListener('click', (e) => {
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

  overlay.addEventListener(
    'touchmove',
    (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('input[type="range"]') || t.closest('.range-slider-row')) return;
    },
    { passive: true }
  );

  overlay.append(modal);
  getModalOverlayMount().append(overlay);

  const ro = new ResizeObserver(() => renderPreview());
  ro.observe(previewWrap);
  overlay.__effectRo = ro;

  updateFullscreenBtn();
  updateMixLabel();
  updateBoxButtons();
  updateEffectUndoRedo();
  requestAnimationFrame(() => {
    renderPreview();
    requestAnimationFrame(renderPreview);
  });
}
