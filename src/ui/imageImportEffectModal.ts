import {
  ART_DISPLAY_COLS,
  ART_DISPLAY_ROWS,
} from '../art/gridConfig';
import { gridDrawLayout } from '../art/packedGrid';
import {
  applyPixelImportMixForEditor,
  applyPixelImportMixOnDisplay,
  createDefaultEffectMix,
  describeEffectMix,
  formatImportEffectSliderValue,
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

  const overlay = document.createElement('div') as EffectOverlay;
  overlay.className = 'img-import-overlay img-import-overlay--page';
  overlay.dataset.modal = 'image-import-effect';

  const modal = document.createElement('div');
  modal.className = 'img-import-modal img-import-modal--effects img-import-modal--page';
  modal.innerHTML = `
    <header class="img-import-effect__topbar">
      <div class="img-import-effect__topbar-main">
        <h3 class="img-import-effect__title">调配像素画效果</h3>
        <p class="img-import-effect__subtitle">拖动右侧滑条组合效果，左侧实时预览（60×84）</p>
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
          </div>
        </div>
      </section>
      <aside class="img-import-effect__sidebar">
        <div class="img-import-effect__sliders" data-effect-sliders></div>
        <footer class="img-import-effect__actions">
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
  const fullscreenBtn = modal.querySelector<HTMLButtonElement>('[data-fullscreen]')!;
  const sliderHandles: ReturnType<typeof createRangeSliderRow>[] = [];

  for (const opt of PIXEL_IMPORT_EFFECTS) {
    const effectId = opt.id as Exclude<PixelImportEffect, 'standard'>;
    const isThreshold = isThresholdImportEffect(effectId);
    const slider = createRangeSliderRow({
      label: opt.label,
      description: opt.description,
      value: 0,
      className: isThreshold ? 'img-import-effect__slider-row--threshold' : undefined,
      formatValue: (v) => formatImportEffectSliderValue(effectId, v),
      onChange: (v) => {
        mix[effectId] = v;
        updateMixLabel();
        renderPreview();
      },
    });
    slider.root.classList.add('img-import-effect__slider-row');
    sliderHandles.push(slider);
    slidersEl.append(slider.root);
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
    const defaults = createDefaultEffectMix();
    for (const key of Object.keys(defaults) as (keyof PixelImportEffectMix)[]) {
      mix[key] = defaults[key];
    }
    sliderHandles.forEach((handle) => handle.setValue(0, { silent: true }));
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

  function startChangeImage(): void {
    changeFileInput.click();
  }

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
    startChangeImage();
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
  requestAnimationFrame(() => {
    renderPreview();
    requestAnimationFrame(renderPreview);
  });
}
