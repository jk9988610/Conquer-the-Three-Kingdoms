import {
  ART_DISPLAY_COLS,
  ART_DISPLAY_ROWS,
} from '../art/gridConfig';
import { gridDrawLayout } from '../art/packedGrid';
import {
  applyPixelImportMixForEditor,
  applyPixelImportMixOnDisplay,
  clonePixelImportMix,
  createDefaultEffectMix,
  DEFAULT_REMOVE_BG_MODE,
  describeEffectMix,
  formatImportEffectSliderValue,
  isThresholdImportEffect,
  normalizeRemoveBgMode,
  PIXEL_IMPORT_EFFECTS,
  REMOVE_BG_MODES,
  type PixelImportEffect,
  type PixelImportEffectMix,
  type RemoveBgMode,
  type RemoveBgModeInput,
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
  __flashTimer?: ReturnType<typeof setInterval>;
};

interface EffectHistoryEntry {
  grid: PixelGrid;
  mix: PixelImportEffectMix;
  removeBgMode: RemoveBgModeInput;
}

function clonePixelGrid(grid: PixelGrid): PixelGrid {
  return grid.map((row) => [...row]);
}

export function closeImageImportEffectModal(): void {
  const overlay = document.querySelector<EffectOverlay>('[data-modal="image-import-effect"]');
  if (overlay) {
    overlay.__effectRo?.disconnect();
    if (overlay.__flashTimer !== undefined) {
      clearInterval(overlay.__flashTimer);
      overlay.__flashTimer = undefined;
    }
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
  let removeBgMode: RemoveBgMode = DEFAULT_REMOVE_BG_MODE;
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
        <p class="img-import-effect__subtitle">拖动右侧滑条组合全图效果，算法已针对边缘与局部细节优化</p>
      </div>
      <div class="img-import-effect__topbar-actions">
        <button type="button" class="btn img-import-effect__topbar-btn" data-transparent-flash title="高亮闪烁已透明区域，便于检查抠图">透明闪烁</button>
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
  const effectNameEl = modal.querySelector<HTMLElement>('[data-effect-name]')!;
  const slidersEl = modal.querySelector<HTMLElement>('[data-effect-sliders]')!;
  const transparentFlashBtn = modal.querySelector<HTMLButtonElement>(
    '[data-transparent-flash]'
  )!;
  const fullscreenBtn = modal.querySelector<HTMLButtonElement>('[data-fullscreen]')!;
  const undoBtn = modal.querySelector<HTMLButtonElement>('[data-undo]')!;
  const redoBtn = modal.querySelector<HTMLButtonElement>('[data-redo]')!;

  let transparentFlash = false;
  let flashHighlight = false;

  const sliderByEffect = new Map<
    Exclude<PixelImportEffect, 'standard'>,
    ReturnType<typeof createRangeSliderRow>
  >();

  function updateEffectUndoRedo(): void {
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  function pushEffectUndo(): void {
    undoStack.push({
      grid: clonePixelGrid(currentGrid),
      mix: clonePixelImportMix(mix),
      removeBgMode,
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
    removeBgMode = normalizeRemoveBgMode(entry.removeBgMode);
    for (const [id, slider] of sliderByEffect) {
      slider.setValue(mix[id] ?? 0, { silent: true });
    }
    updateRemoveBgModeButtons();
    updateMixLabel();
    renderPreview();
  }

  function effectUndo(): void {
    if (undoStack.length === 0) return;
    redoStack.push({
      grid: clonePixelGrid(currentGrid),
      mix: clonePixelImportMix(mix),
      removeBgMode,
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
      removeBgMode,
    });
    const entry = redoStack.pop()!;
    restoreEffectHistory(entry);
    updateEffectUndoRedo();
  }

  const removeBgModeButtons = new Map<RemoveBgMode, HTMLButtonElement>();

  function updateRemoveBgModeButtons(): void {
    for (const [mode, btn] of removeBgModeButtons) {
      btn.classList.toggle('is-active', mode === removeBgMode);
    }
  }

  for (const opt of PIXEL_IMPORT_EFFECTS) {
    const effectId = opt.id as Exclude<PixelImportEffect, 'standard'>;
    const isThreshold = isThresholdImportEffect(effectId);
    const slider = createRangeSliderRow({
      label: opt.label,
      description: opt.description,
      value: 0,
      className: `img-import-effect__slider-row range-slider-row${
        isThreshold ? ' img-import-effect__slider-row--threshold' : ''
      }`,
      formatValue: (v) => formatImportEffectSliderValue(effectId, v),
      onChange: (v) => {
        mix[effectId] = v;
        updateMixLabel();
        renderPreview();
      },
    });
    sliderByEffect.set(effectId, slider);

    if (effectId === 'removeBg') {
      const section = document.createElement('div');
      section.className = 'img-import-effect__remove-bg-section';
      section.append(slider.root);

      if (REMOVE_BG_MODES.length > 1) {
        const modesLabel = document.createElement('div');
        modesLabel.className = 'img-import-effect__remove-bg-modes-label';
        modesLabel.textContent = '去背景方案';
        section.append(modesLabel);

        const modesEl = document.createElement('div');
        modesEl.className = 'img-import-effect__remove-bg-modes';
        for (const modeOpt of REMOVE_BG_MODES) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'img-import-effect__remove-bg-mode';
          btn.dataset.mode = modeOpt.id;
          btn.textContent = modeOpt.label;
          btn.title = modeOpt.description;
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (removeBgMode === modeOpt.id) return;
            pushEffectUndo();
            removeBgMode = modeOpt.id;
            updateRemoveBgModeButtons();
            updateMixLabel();
            renderPreview();
          });
          removeBgModeButtons.set(modeOpt.id, btn);
          modesEl.append(btn);
        }
        section.append(modesEl);
        updateRemoveBgModeButtons();
      }

      slidersEl.append(section);
    } else {
      slidersEl.append(slider.root);
    }
  }

  function updateMixLabel(): void {
    if (effectNameEl) {
      effectNameEl.textContent = describeEffectMix(mix, { removeBgMode });
    }
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

  function updateTransparentFlashBtn(): void {
    transparentFlashBtn.classList.toggle('is-active', transparentFlash);
    transparentFlashBtn.textContent = transparentFlash ? '停止闪烁' : '透明闪烁';
  }

  function stopTransparentFlash(): void {
    if (overlay.__flashTimer !== undefined) {
      clearInterval(overlay.__flashTimer);
      overlay.__flashTimer = undefined;
    }
    flashHighlight = false;
  }

  function startTransparentFlash(): void {
    stopTransparentFlash();
    flashHighlight = true;
    overlay.__flashTimer = setInterval(() => {
      flashHighlight = !flashHighlight;
      renderPreview();
    }, 480);
  }

  transparentFlashBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    transparentFlash = !transparentFlash;
    if (transparentFlash) {
      startTransparentFlash();
    } else {
      stopTransparentFlash();
      renderPreview();
    }
    updateTransparentFlashBtn();
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
    const display = applyPixelImportMixOnDisplay(currentGrid, mix, { removeBgMode });
    drawGridToCanvas(
      ctx,
      display,
      ART_DISPLAY_COLS,
      ART_DISPLAY_ROWS,
      'fit'
    );

    if (transparentFlash && flashHighlight) {
      ctx.fillStyle = 'rgba(255, 48, 140, 0.72)';
      for (let y = 0; y < display.length; y++) {
        const row = display[y] ?? [];
        for (let x = 0; x < row.length; x++) {
          if (row[x] !== null) continue;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  function resetMix(): void {
    pushEffectUndo();
    const defaults = createDefaultEffectMix();
    for (const key of Object.keys(defaults) as (keyof PixelImportEffectMix)[]) {
      mix[key] = defaults[key];
    }
    removeBgMode = DEFAULT_REMOVE_BG_MODE;
    sliderByEffect.forEach((handle) => handle.setValue(0, { silent: true }));
    updateRemoveBgModeButtons();
    updateMixLabel();
    renderPreview();
  }

  function finishConfirm(): void {
    const processed = applyPixelImportMixForEditor(currentGrid, mix, { removeBgMode });
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
  updateTransparentFlashBtn();
  updateMixLabel();
  updateEffectUndoRedo();
  requestAnimationFrame(() => {
    renderPreview();
    requestAnimationFrame(renderPreview);
  });
}
