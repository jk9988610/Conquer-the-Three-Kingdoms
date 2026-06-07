import {
  ART_DISPLAY_COLS,
  ART_DISPLAY_ROWS,
} from '../art/gridConfig';
import { gridDrawLayout } from '../art/packedGrid';
import {
  applyPixelImportMixForEditor,
  applyPixelImportMixOnDisplay,
  clonePixelImportMix,
  cloneRemoveBgBoxSelection,
  computeRemoveBgDisplayMask,
  createDefaultEffectMix,
  createEmptyRemoveBgBoxSelection,
  DEFAULT_REMOVE_BG_MODE,
  describeEffectMix,
  formatImportEffectSliderValue,
  getRemoveBgEdgePalette,
  isThresholdImportEffect,
  logicalGridToDisplayGridMatting,
  normalizeRemoveBgBox,
  normalizeRemoveBgMode,
  PIXEL_IMPORT_EFFECTS,
  REMOVE_BG_MODES,
  type PixelImportEffect,
  type PixelImportEffectMix,
  type RemoveBgBox,
  type RemoveBgBoxSelection,
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
  removeBgBoxes: RemoveBgBoxSelection;
}

type PreviewNavMode = 'browse' | 'box-remove' | 'box-protect';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
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
  let removeBgBoxes: RemoveBgBoxSelection = createEmptyRemoveBgBoxSelection();
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
        <button type="button" class="btn img-import-effect__topbar-btn" data-mask-overlay title="红色叠层标出将被去除的色块">掩码预览</button>
        <button type="button" class="btn img-import-effect__topbar-btn" data-fullscreen>全屏</button>
        <button type="button" class="img-import-effect__close" data-close aria-label="关闭">×</button>
      </div>
    </header>
    <div class="img-import-effect__body">
      <section class="img-import-effect__preview-col">
        <div class="img-import-effect__preview-label">预览 · <span data-effect-name>原图</span></div>
        <div class="img-import-effect__preview-tools">
          <button type="button" class="img-import-effect__preview-tool is-active" data-preview-mode="browse" title="单指拖动、双指缩放">拖动</button>
          <button type="button" class="img-import-effect__preview-tool" data-preview-mode="box-protect" title="拖拽框选区域，强制保留不去背景">框选保护</button>
          <button type="button" class="img-import-effect__preview-tool" data-preview-mode="box-remove" title="拖拽框选区域，强制去除">框选去除</button>
          <button type="button" class="img-import-effect__preview-tool" data-preview-reset title="复位缩放与位置">复位</button>
        </div>
        <div class="img-import-effect__preview-wrap" data-preview-wrap>
          <div class="img-import-effect__preview-viewport" data-preview-viewport>
            <div class="img-import-effect__art-surface" data-preview-surface>
              <canvas data-preview-canvas></canvas>
              <div class="img-import-effect__box-layer" data-box-layer></div>
            </div>
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
  const previewViewport = modal.querySelector<HTMLElement>('[data-preview-viewport]')!;
  const previewSurface = modal.querySelector<HTMLElement>('[data-preview-surface]')!;
  const previewCanvas = modal.querySelector<HTMLCanvasElement>('[data-preview-canvas]')!;
  const previewModeButtons = modal.querySelectorAll<HTMLButtonElement>('[data-preview-mode]');
  const previewResetBtn = modal.querySelector<HTMLButtonElement>('[data-preview-reset]')!;
  const effectNameEl = modal.querySelector<HTMLElement>('[data-effect-name]')!;
  const slidersEl = modal.querySelector<HTMLElement>('[data-effect-sliders]')!;
  const transparentFlashBtn = modal.querySelector<HTMLButtonElement>(
    '[data-transparent-flash]'
  )!;
  const maskOverlayBtn = modal.querySelector<HTMLButtonElement>('[data-mask-overlay]')!;
  const fullscreenBtn = modal.querySelector<HTMLButtonElement>('[data-fullscreen]')!;
  const undoBtn = modal.querySelector<HTMLButtonElement>('[data-undo]')!;
  const redoBtn = modal.querySelector<HTMLButtonElement>('[data-redo]')!;

  let transparentFlash = false;
  let flashHighlight = false;
  let maskOverlay = false;
  let edgePaletteEl: HTMLElement | null = null;
  const boxLayer = modal.querySelector<HTMLElement>('[data-box-layer]')!;

  let previewNavMode: PreviewNavMode = 'browse';
  let previewPanX = 0;
  let previewPanY = 0;
  let previewUserScale = 1;
  let previewLayout = {
    cell: 1,
    ox: 0,
    oy: 0,
    cssW: ART_DISPLAY_COLS,
    cssH: ART_DISPLAY_ROWS,
  };

  const previewPointers = new Map<number, { x: number; y: number }>();
  let previewPinchDist = 0;
  let previewPinchMid: { x: number; y: number } | null = null;
  let boxDragPointerId: number | null = null;
  let boxDragStart: { x: number; y: number } | null = null;
  let boxDragCurrent: { x: number; y: number } | null = null;

  const sliderByEffect = new Map<
    Exclude<PixelImportEffect, 'standard'>,
    ReturnType<typeof createRangeSliderRow>
  >();

  function updateEffectUndoRedo(): void {
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  function mixOptions() {
    return { removeBgMode, removeBgBoxes };
  }

  function isRemoveBgActive(): boolean {
    return (
      (mix.removeBg ?? 0) > 0 ||
      removeBgBoxes.remove.length > 0 ||
      removeBgBoxes.protect.length > 0
    );
  }

  function pushEffectUndo(): void {
    undoStack.push({
      grid: clonePixelGrid(currentGrid),
      mix: clonePixelImportMix(mix),
      removeBgMode,
      removeBgBoxes: cloneRemoveBgBoxSelection(removeBgBoxes),
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
    removeBgBoxes = cloneRemoveBgBoxSelection(entry.removeBgBoxes);
    for (const [id, slider] of sliderByEffect) {
      slider.setValue(mix[id] ?? 0, { silent: true });
    }
    updateRemoveBgModeButtons();
    updateBoxOverlay();
    updateMixLabel();
    renderPreview();
  }

  function effectUndo(): void {
    if (undoStack.length === 0) return;
    redoStack.push({
      grid: clonePixelGrid(currentGrid),
      mix: clonePixelImportMix(mix),
      removeBgMode,
      removeBgBoxes: cloneRemoveBgBoxSelection(removeBgBoxes),
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
      removeBgBoxes: cloneRemoveBgBoxSelection(removeBgBoxes),
    });
    const entry = redoStack.pop()!;
    restoreEffectHistory(entry);
    updateEffectUndoRedo();
  }

  const removeBgModeButtons = new Map<RemoveBgMode, HTMLButtonElement>();
  let clearBoxesBtn: HTMLButtonElement | null = null;

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

      const paletteLabel = document.createElement('div');
      paletteLabel.className = 'img-import-effect__remove-bg-modes-label';
      paletteLabel.textContent = '边缘参考色';
      section.append(paletteLabel);

      edgePaletteEl = document.createElement('div');
      edgePaletteEl.className = 'img-import-effect__remove-bg-palette';
      edgePaletteEl.hidden = true;
      section.append(edgePaletteEl);

      const boxHint = document.createElement('div');
      boxHint.className = 'img-import-effect__remove-bg-modes-label';
      boxHint.textContent =
        '框选去除/保护后拖拽矩形；5×5 内仅 1 非透明自动清除，3×3 内≥6 非透明时为透明格均值填色';
      section.append(boxHint);

      const boxActionsLabel = document.createElement('div');
      boxActionsLabel.className = 'img-import-effect__remove-bg-modes-label';
      boxActionsLabel.textContent = '框选';
      section.append(boxActionsLabel);

      const boxActionsRow = document.createElement('div');
      boxActionsRow.className = 'img-import-effect__remove-bg-modes';
      clearBoxesBtn = document.createElement('button');
      clearBoxesBtn.type = 'button';
      clearBoxesBtn.className = 'img-import-effect__remove-bg-mode';
      clearBoxesBtn.textContent = '清除框选';
      clearBoxesBtn.title = '清除所有框选去除与框选保护区域';
      clearBoxesBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (removeBgBoxes.remove.length === 0 && removeBgBoxes.protect.length === 0) return;
        pushEffectUndo();
        removeBgBoxes = createEmptyRemoveBgBoxSelection();
        updateBoxOverlay();
        updateMixLabel();
        renderPreview();
      });
      boxActionsRow.append(clearBoxesBtn);
      section.append(boxActionsRow);

      slidersEl.append(section);
    } else {
      slidersEl.append(slider.root);
    }
  }

  function updateMixLabel(): void {
    if (effectNameEl) {
      effectNameEl.textContent = describeEffectMix(mix, mixOptions());
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

  function updateMaskOverlayBtn(): void {
    maskOverlayBtn.classList.toggle('is-active', maskOverlay);
    maskOverlayBtn.textContent = maskOverlay ? '关闭掩码' : '掩码预览';
  }

  maskOverlayBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    maskOverlay = !maskOverlay;
    updateMaskOverlayBtn();
    renderPreview();
  });

  function appendBoxOutline(
    box: RemoveBgBox,
    className: string,
    container: HTMLElement
  ): void {
    const { cell, ox, oy } = previewLayout;
    const el = document.createElement('div');
    el.className = className;
    el.style.left = `${ox + box.x0 * cell}px`;
    el.style.top = `${oy + box.y0 * cell}px`;
    el.style.width = `${(box.x1 - box.x0) * cell}px`;
    el.style.height = `${(box.y1 - box.y0) * cell}px`;
    container.append(el);
  }

  function updateBoxOverlay(): void {
    boxLayer.replaceChildren();
    for (const box of removeBgBoxes.remove) {
      appendBoxOutline(box, 'img-import-effect__box-outline img-import-effect__box-outline--remove', boxLayer);
    }
    for (const box of removeBgBoxes.protect) {
      appendBoxOutline(box, 'img-import-effect__box-outline img-import-effect__box-outline--protect', boxLayer);
    }
    if (boxDragStart && boxDragCurrent) {
      const a = pickDisplayCell(boxDragStart.x, boxDragStart.y);
      const b = pickDisplayCell(boxDragCurrent.x, boxDragCurrent.y);
      if (a && b) {
        const draft = normalizeRemoveBgBox(a.x, a.y, b.x, b.y);
        const kind =
          previewNavMode === 'box-protect'
            ? 'img-import-effect__box-outline img-import-effect__box-outline--protect is-draft'
            : 'img-import-effect__box-outline img-import-effect__box-outline--remove is-draft';
        appendBoxOutline(draft, kind, boxLayer);
      }
    }
  }

  function commitBoxSelection(clientX: number, clientY: number): void {
    if (!boxDragStart) return;
    const a = pickDisplayCell(boxDragStart.x, boxDragStart.y);
    const b = pickDisplayCell(clientX, clientY);
    if (!a || !b) return;
    const box = normalizeRemoveBgBox(a.x, a.y, b.x, b.y);
    if (box.x1 - box.x0 < 1 || box.y1 - box.y0 < 1) return;

    pushEffectUndo();
    if (previewNavMode === 'box-protect') {
      removeBgBoxes.protect.push(box);
    } else {
      removeBgBoxes.remove.push(box);
    }
    updateBoxOverlay();
    updateMixLabel();
    renderPreview();
  }

  function updateEdgePaletteSwatches(): void {
    if (!edgePaletteEl) return;
    const strength = mix.removeBg ?? 0;
    if (strength <= 0) {
      edgePaletteEl.replaceChildren();
      edgePaletteEl.hidden = true;
      return;
    }
    const matting = logicalGridToDisplayGridMatting(currentGrid);
    const colors = getRemoveBgEdgePalette(matting);
    edgePaletteEl.hidden = colors.length === 0;
    edgePaletteEl.replaceChildren();
    for (const c of colors) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'img-import-effect__remove-bg-swatch';
      swatch.style.backgroundColor = `rgb(${c.r},${c.g},${c.b})`;
      swatch.title = `rgb(${c.r},${c.g},${c.b}) · 外圈 ${c.count} 格`;
      edgePaletteEl.append(swatch);
    }
  }

  function applyPreviewTransform(): void {
    previewSurface.style.transform = `translate(${previewPanX}px, ${previewPanY}px) scale(${previewUserScale})`;
  }

  function resetPreviewNav(): void {
    previewPanX = 0;
    previewPanY = 0;
    previewUserScale = 1;
    applyPreviewTransform();
  }

  function updatePreviewNavModeButtons(): void {
    previewModeButtons.forEach((btn) => {
      const mode = btn.dataset.previewMode as PreviewNavMode | undefined;
      btn.classList.toggle('is-active', mode === previewNavMode);
    });
    previewViewport.classList.toggle('is-box-protect', previewNavMode === 'box-protect');
    previewViewport.classList.toggle('is-box-remove', previewNavMode === 'box-remove');
  }

  function pickDisplayCell(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = previewCanvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const { cell, ox, oy, cssW, cssH } = previewLayout;
    const nx = ((clientX - rect.left) / rect.width) * cssW;
    const ny = ((clientY - rect.top) / rect.height) * cssH;
    const gx = Math.floor((nx - ox) / cell);
    const gy = Math.floor((ny - oy) / cell);
    if (gx < 0 || gy < 0 || gx >= ART_DISPLAY_COLS || gy >= ART_DISPLAY_ROWS) return null;
    return { x: gx, y: gy };
  }

  function fillPreviewDisplayCell(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number
  ): void {
    const { cell, ox, oy } = previewLayout;
    ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
  }

  previewModeButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const mode = btn.dataset.previewMode as PreviewNavMode | undefined;
      if (!mode || mode === previewNavMode) return;
      previewNavMode = mode;
      updatePreviewNavModeButtons();
    });
  });

  previewResetBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    resetPreviewNav();
  });

  previewViewport.addEventListener('pointerdown', (e) => {
    if (previewNavMode === 'box-remove' || previewNavMode === 'box-protect') {
      e.preventDefault();
      boxDragPointerId = e.pointerId;
      boxDragStart = { x: e.clientX, y: e.clientY };
      boxDragCurrent = { x: e.clientX, y: e.clientY };
      previewViewport.setPointerCapture(e.pointerId);
      updateBoxOverlay();
      return;
    }
    e.preventDefault();
    previewViewport.setPointerCapture(e.pointerId);
    previewPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (previewPointers.size === 2) {
      const pts = [...previewPointers.values()];
      previewPinchDist = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
      previewPinchMid = {
        x: (pts[0]!.x + pts[1]!.x) / 2,
        y: (pts[0]!.y + pts[1]!.y) / 2,
      };
    } else {
      previewPinchDist = 0;
      previewPinchMid = null;
    }
  });

  previewViewport.addEventListener('pointermove', (e) => {
    if (
      (previewNavMode === 'box-remove' || previewNavMode === 'box-protect') &&
      boxDragPointerId === e.pointerId
    ) {
      e.preventDefault();
      boxDragCurrent = { x: e.clientX, y: e.clientY };
      updateBoxOverlay();
      return;
    }
    if (previewNavMode !== 'browse') return;
    if (!previewPointers.has(e.pointerId)) return;
    e.preventDefault();
    const prev = previewPointers.get(e.pointerId)!;
    previewPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (previewPointers.size === 1) {
      previewPanX += e.clientX - prev.x;
      previewPanY += e.clientY - prev.y;
      applyPreviewTransform();
      return;
    }

    if (previewPointers.size === 2) {
      const pts = [...previewPointers.values()];
      const dist = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
      const midX = (pts[0]!.x + pts[1]!.x) / 2;
      const midY = (pts[0]!.y + pts[1]!.y) / 2;
      const vRect = previewViewport.getBoundingClientRect();
      const anchorX = midX - vRect.left - vRect.width / 2;
      const anchorY = midY - vRect.top - vRect.height / 2;

      if (previewPinchDist > 0) {
        const factor = dist / previewPinchDist;
        const nextScale = clamp(previewUserScale * factor, 0.5, 12);
        const ratio = nextScale / previewUserScale;
        previewPanX = anchorX - (anchorX - previewPanX) * ratio;
        previewPanY = anchorY - (anchorY - previewPanY) * ratio;
        previewUserScale = nextScale;
      }
      if (previewPinchMid) {
        previewPanX += midX - previewPinchMid.x;
        previewPanY += midY - previewPinchMid.y;
      }
      previewPinchDist = dist;
      previewPinchMid = { x: midX, y: midY };
      applyPreviewTransform();
    }
  });

  const onPreviewPointerEnd = (e: PointerEvent) => {
    if (boxDragPointerId === e.pointerId) {
      if (boxDragStart) {
        const dx = e.clientX - boxDragStart.x;
        const dy = e.clientY - boxDragStart.y;
        if (Math.hypot(dx, dy) >= 4) {
          commitBoxSelection(e.clientX, e.clientY);
        }
      }
      boxDragPointerId = null;
      boxDragStart = null;
      boxDragCurrent = null;
      updateBoxOverlay();
      try {
        previewViewport.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      return;
    }

    previewPointers.delete(e.pointerId);
    if (previewPointers.size < 2) {
      previewPinchDist = 0;
      previewPinchMid = null;
    }
    try {
      previewViewport.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  previewViewport.addEventListener('pointerup', onPreviewPointerEnd);
  previewViewport.addEventListener('pointercancel', onPreviewPointerEnd);

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

    const layout = gridDrawLayout(
      ART_DISPLAY_COLS,
      ART_DISPLAY_ROWS,
      cssW,
      cssH,
      'fit'
    );
    previewLayout = { cell: layout.cell, ox: layout.ox, oy: layout.oy, cssW, cssH };

    previewSurface.style.width = `${cssW}px`;
    previewSurface.style.height = `${cssH}px`;
    applyPreviewTransform();

    const prepared = prepareSharpCanvas(previewCanvas, cssW, cssH);
    if (!prepared) return;
    const { ctx } = prepared;
    ctx.clearRect(0, 0, cssW, cssH);
    const display = applyPixelImportMixOnDisplay(currentGrid, mix, mixOptions());
    drawGridToCanvas(ctx, display, cssW, cssH, 'fit');

    if (transparentFlash && flashHighlight) {
      ctx.fillStyle = 'rgba(255, 48, 140, 0.72)';
      for (let y = 0; y < display.length; y++) {
        const row = display[y] ?? [];
        for (let x = 0; x < row.length; x++) {
          if (row[x] !== null) continue;
          fillPreviewDisplayCell(ctx, x, y);
        }
      }
    }

    if (maskOverlay && isRemoveBgActive()) {
      const mask = computeRemoveBgDisplayMask(
        logicalGridToDisplayGridMatting(currentGrid),
        mix.removeBg ?? 0,
        mixOptions()
      );
      if (mask) {
        ctx.fillStyle = 'rgba(255, 64, 48, 0.55)';
        for (let y = 0; y < mask.length; y++) {
          const row = mask[y] ?? [];
          for (let x = 0; x < row.length; x++) {
            if (!row[x]) continue;
            fillPreviewDisplayCell(ctx, x, y);
          }
        }
      }
    }

    updateEdgePaletteSwatches();
    updateBoxOverlay();
  }

  function resetMix(): void {
    pushEffectUndo();
    const defaults = createDefaultEffectMix();
    for (const key of Object.keys(defaults) as (keyof PixelImportEffectMix)[]) {
      mix[key] = defaults[key];
    }
    removeBgMode = DEFAULT_REMOVE_BG_MODE;
    removeBgBoxes = createEmptyRemoveBgBoxSelection();
    sliderByEffect.forEach((handle) => handle.setValue(0, { silent: true }));
    updateRemoveBgModeButtons();
    updateBoxOverlay();
    resetPreviewNav();
    updateMixLabel();
    renderPreview();
  }

  function finishConfirm(): void {
    const processed = applyPixelImportMixForEditor(currentGrid, mix, mixOptions());
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
  updatePreviewNavModeButtons();
  updateBoxOverlay();
  updateMixLabel();
  updateEffectUndoRedo();
  requestAnimationFrame(() => {
    renderPreview();
    requestAnimationFrame(renderPreview);
  });
}
