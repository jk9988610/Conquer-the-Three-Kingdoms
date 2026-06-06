import { formatArtMemoryReport } from '../art/artMemoryStats';
import {
  ART_DISPLAY_COLS,
  ART_DISPLAY_ROWS,
  ART_GRID_COLS,
  ART_GRID_MAJOR_STEP,
  ART_GRID_ROWS,
} from '../art/gridConfig';
import {
  drawPackedPreview,
  getArtPacked,
  setCustomArtGrid,
  type Pixel,
  PIXEL_ART_KEYS,
} from '../art/pixelArt';
import {
  argbToPixel,
  clonePackedGrid,
  collectPackedDiff,
  copyPackedRegion,
  createPackedGrid,
  downloadPackedPng,
  flattenPackedToDisplayBlocks,
  floodFillPacked,
  getPackedPixel,
  gridIndex,
  gridToPacked,
  packedToGrid,
  pastePackedRegion,
  pixelToArgb,
  clearPackedRegion,
  type PackedGrid,
} from '../art/packedGrid';
import {
  getLastEditedArtKey,
  loadPixelEditorDraft,
  savePixelEditorDraft,
} from '../art/pixelArtDraft';
import { loadImageFromFile } from '../art/imageToGrid';
import { openImageImportModal } from './imageImportModal';
import type { PixelArtKey } from '../game/types';
import { createColorPicker, type ColorPickerValue } from './colorPicker';
import { ART_PREVIEW_HEIGHT, ART_PREVIEW_WIDTH } from '../tcg/dimensions';
import { getModalOverlayMount } from './overlayRoot';

const MIN_CELL_PX = 1;
const PANE_INSET_PX = 4;
const MAX_UNDO = 5;
const MAX_BRUSH = 12;
const MIN_VIEW_ZOOM = 0.15;
const MAX_VIEW_ZOOM = 12;

interface CellPatch {
  i: number;
  prev: number;
  next: number;
}

type UndoEntry = CellPatch[];
const PALETTE_PRESETS = [
  '#c44',
  '#422',
  '#6a8',
  '#48c',
  '#ec4',
  '#ffffff',
  '#000000',
  '#e8589a',
];

type Tool = 'paint' | 'fill' | 'eraser' | 'eyedropper' | 'select' | 'move' | 'hand';

interface Selection {
  x: number;
  y: number;
  w: number;
  h: number;
  pixels: Uint32Array;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normalizeRect(x0: number, y0: number, x1: number, y1: number) {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return { x, y, w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 };
}

let editorOverlay: HTMLElement | null = null;
let editorTeardown: (() => void) | null = null;

export function openPixelEditor(onApplied: () => void): void {
  closePixelEditor();

  let currentKey: PixelArtKey = 'heal-potion';
  let gridCols = ART_GRID_COLS;
  let gridRows = ART_GRID_ROWS;
  let grid: PackedGrid = createPackedGrid();
  const undoStack: UndoEntry[] = [];
  const redoStack: UndoEntry[] = [];
  let patchBatch: Map<number, { prev: number; next: number }> | null = null;
  let strokeUndoPushed = false;
  let paintColor: Pixel = 'rgba(255,255,255,1)';
  let paintArgb = pixelToArgb(paintColor);
  let brushSize = 1;
  let tool: Tool = 'hand';
  let showGrid = false;
  let viewPanX = 0;
  let viewPanY = 0;
  let viewZoom = 1;
  let navPanStart: { x: number; y: number; panX: number; panY: number } | null = null;
  const navPointers = new Map<number, { x: number; y: number }>();
  let lastPinchDist = 0;
  let selection: Selection | null = null;
  let clipboard: { pixels: Uint32Array; w: number; h: number } | null = null;
  let selectStart: { x: number; y: number } | null = null;
  let moveAnchor: { x: number; y: number } | null = null;
  let moveOffset = { x: 0, y: 0 };
  let lastPaintCell: { x: number; y: number } | null = null;
  let lastDragCell: { x: number; y: number } | null = null;
  let pointerDrawing = false;
  let cellSize = 4;
  let gridPixelW = gridCols * cellSize;
  let gridPixelH = gridRows * cellSize;
  let previewPixelW = ART_PREVIEW_WIDTH;
  let previewPixelH = ART_PREVIEW_HEIGHT;

  function makeEmptyGrid(): PackedGrid {
    return createPackedGrid(gridCols, gridRows);
  }

  function recordCellChange(index: number, next: number): void {
    const prev = grid[index] ?? 0;
    const nextVal = next >>> 0;
    if (prev === nextVal) return;
    if (!patchBatch) patchBatch = new Map();
    const existing = patchBatch.get(index);
    if (existing) {
      existing.next = nextVal;
    } else {
      patchBatch.set(index, { prev, next: nextVal });
    }
    grid[index] = nextVal;
  }

  function beginUndoBatch(): void {
    patchBatch = new Map();
  }

  function commitUndoBatch(): void {
    if (!patchBatch || patchBatch.size === 0) {
      patchBatch = null;
      return;
    }
    const entry: UndoEntry = [];
    for (const [i, { prev, next }] of patchBatch) {
      entry.push({ i, prev, next });
    }
    undoStack.push(entry);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    patchBatch = null;
    updateUndoRedoButtons();
  }

  function pushPatches(patches: UndoEntry): void {
    if (patches.length === 0) return;
    undoStack.push(patches);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    updateUndoRedoButtons();
  }

  function applyUndoEntry(entry: UndoEntry, useNext: boolean): void {
    for (const p of entry) {
      grid[p.i] = (useNext ? p.next : p.prev) >>> 0;
    }
  }

  function replaceGrid(next: PackedGrid): void {
    const before = clonePackedGrid(grid);
    grid = clonePackedGrid(next);
    pushPatches(collectPackedDiff(before, grid));
  }

  function resetHistory(): void {
    undoStack.length = 0;
    redoStack.length = 0;
    strokeUndoPushed = false;
    patchBatch = null;
    updateUndoRedoButtons();
  }

  function undo(): void {
    if (undoStack.length === 0) return;
    const entry = undoStack.pop()!;
    redoStack.push(entry);
    applyUndoEntry(entry, false);
    selection = null;
    selectStart = null;
    refreshAll();
    updateUndoRedoButtons();
  }

  function redo(): void {
    if (redoStack.length === 0) return;
    const entry = redoStack.pop()!;
    undoStack.push(entry);
    applyUndoEntry(entry, true);
    selection = null;
    selectStart = null;
    refreshAll();
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons(): void {
    const undoBtn = panel.querySelector<HTMLButtonElement>('[data-undo]');
    const redoBtn = panel.querySelector<HTMLButtonElement>('[data-redo]');
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  function updateClipboardButtons(): void {
    const copyBtn = panel.querySelector<HTMLButtonElement>('[data-copy]');
    const cutBtn = panel.querySelector<HTMLButtonElement>('[data-cut]');
    const pasteBtn = panel.querySelector<HTMLButtonElement>('[data-paste]');
    if (copyBtn) copyBtn.disabled = !selection;
    if (cutBtn) cutBtn.disabled = !selection;
    if (pasteBtn) pasteBtn.disabled = !clipboard;
  }

  function clearSelection(): void {
    selection = null;
    selectStart = null;
    updateSelectionBox();
    updateClipboardButtons();
  }

  function flattenEditorGrid(): void {
    grid = flattenPackedToDisplayBlocks(grid, gridCols, gridRows);
  }

  function persistDraft(): void {
    flattenEditorGrid();
    savePixelEditorDraft(currentKey, grid);
  }

  /** 优先恢复本地草稿，否则从已应用美术加载 */
  function loadArtForKey(key: PixelArtKey): void {
    gridCols = ART_GRID_COLS;
    gridRows = ART_GRID_ROWS;
    const draft = loadPixelEditorDraft(key);
    grid = draft ? clonePackedGrid(draft.grid) : clonePackedGrid(getArtPacked(key));
    selection = null;
    selectStart = null;
    viewPanX = 0;
    viewPanY = 0;
    viewZoom = 1;
    resetHistory();
    applyEditViewTransform();
  }

  const overlay = document.createElement('div');
  overlay.className = 'pixel-editor-overlay';
  overlay.dataset.modal = 'pixel-editor';

  const panel = document.createElement('div');
  panel.className = 'pixel-editor';
  panel.innerHTML = `
    <header class="pixel-editor__topbar">
      <h2 class="pixel-editor__title">像素画绘制</h2>
      <div class="pixel-editor__topbar-actions">
        <button type="button" class="btn pixel-editor__topbar-btn" data-open-debug>调试</button>
        <button type="button" class="btn pixel-editor__topbar-btn" data-fullscreen>全屏</button>
        <button type="button" class="pixel-editor__close" aria-label="关闭">×</button>
      </div>
    </header>
    <div class="pixel-editor__canvas-row" data-canvas-row>
      <section class="pixel-editor__pane pixel-editor__pane--preview">
        <div class="pixel-editor__pane-label">预览</div>
        <div class="pixel-editor__pane-fill" data-preview-panel>
          <div class="pixel-editor__art-surface" data-preview-surface>
            <canvas data-preview-grid-art></canvas>
          </div>
        </div>
      </section>
      <section class="pixel-editor__pane pixel-editor__pane--edit">
        <div class="pixel-editor__pane-label">绘制</div>
        <div class="pixel-editor__pane-fill pixel-editor__edit-viewport-wrap" data-edit-panel>
          <div class="pixel-editor__edit-viewport" data-edit-viewport>
            <div class="pixel-editor__edit-stage" data-edit-stage>
              <div class="pixel-editor__art-surface" data-edit-surface>
                <canvas data-edit-canvas></canvas>
                <canvas class="pixel-editor__grid-overlay" data-grid-layer></canvas>
                <div class="pixel-editor__sel-box" data-sel-box hidden></div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
    <section class="pixel-editor__pane pixel-editor__pane--tools">
      <div class="pixel-editor__pane-label">工具</div>
      <div class="pixel-editor__pane-fill pixel-editor__pane-fill--tools" data-tools-panel>
          <div class="pixel-editor__tools-fixed">
            <div class="pixel-editor__tools-grid pixel-editor__tools-grid--primary">
              <button type="button" class="btn pixel-editor__tool" data-tool="paint">画笔</button>
              <button type="button" class="btn pixel-editor__tool" data-tool="eraser">橡皮</button>
              <button type="button" class="btn pixel-editor__tool" data-tool="eyedropper">取色</button>
              <button type="button" class="btn" data-undo disabled>撤销</button>
              <button type="button" class="btn" data-redo disabled>重做</button>
            </div>
            <label class="pixel-editor__brush-row">
              画笔粗细
              <input type="range" min="1" max="12" value="1" data-brush-size />
              <span data-brush-size-label>1</span>
            </label>
            <div class="pixel-editor__tools-nav" data-alpha-mount></div>
            <div class="pixel-editor__tools-nav">
              <button type="button" class="btn pixel-editor__tool pixel-editor__tool--active" data-tool="hand" title="单指拖动平移">拖动</button>
              <button type="button" class="btn" data-zoom-reset title="复位视图">复位</button>
            </div>
          </div>
          <div class="pixel-editor__tools-scroll" data-tools-scroll>
            <label class="pixel-editor__card-label">卡牌 <select data-select></select></label>
            <div class="pixel-editor__tools-grid">
              <button type="button" class="btn pixel-editor__tool" data-tool="fill">填充</button>
              <button type="button" class="btn pixel-editor__tool" data-tool="select">框选</button>
              <button type="button" class="btn pixel-editor__tool" data-tool="move">摆放</button>
            </div>
            <div class="pixel-editor__clipboard-row">
              <button type="button" class="btn" data-copy disabled>复制</button>
              <button type="button" class="btn" data-cut disabled>剪切</button>
              <button type="button" class="btn" data-paste disabled>粘贴</button>
            </div>
            <div class="pixel-editor__tools-zoom">
              <button type="button" class="btn" data-zoom-out title="缩小">缩小</button>
              <button type="button" class="btn" data-zoom-in title="放大">放大</button>
            </div>
            <p class="pixel-editor__view-hint">绘制区：仅「拖动」工具下可平移/缩放画布</p>
            <div class="pixel-editor__color-block" data-color-picker></div>
            <div class="pixel-editor__presets" data-presets></div>
          </div>
          <div class="pixel-editor__tools-actions">
            <button type="button" class="btn" data-import-image>导入图片</button>
            <input type="file" accept="image/*" hidden data-import-file />
            <button type="button" class="btn" data-toggle-grid>参考线：关</button>
            <button type="button" class="btn" data-clear>清空画布</button>
            <button type="button" class="btn" data-apply>应用</button>
            <button type="button" class="btn" data-export>导出 PNG</button>
          </div>
        </div>
    </section>
    <div class="pixel-editor__drawer-backdrop" data-debug-backdrop aria-hidden="true"></div>
    <aside class="pixel-editor__drawer pixel-editor__drawer--debug" data-debug-drawer aria-hidden="true" aria-label="调试">
      <header class="pixel-editor__drawer-head">
        <span>调试</span>
        <button type="button" class="pixel-editor__drawer-close" data-close-drawer aria-label="关闭">×</button>
      </header>
      <div class="pixel-editor__drawer-body pixel-editor__debug-body">
        <pre class="pixel-editor__editor-debug-body" data-pixel-debug></pre>
      </div>
    </aside>
  `;

  const select = panel.querySelector<HTMLSelectElement>('[data-select]')!;
  const canvasRow = panel.querySelector<HTMLElement>('[data-canvas-row]')!;
  const debugBackdrop = panel.querySelector<HTMLElement>('[data-debug-backdrop]')!;
  const debugDrawer = panel.querySelector<HTMLElement>('[data-debug-drawer]')!;
  const openDebugBtn = panel.querySelector<HTMLElement>('[data-open-debug]')!;
  const previewPanel = panel.querySelector<HTMLElement>('[data-preview-panel]')!;
  const previewSurface = panel.querySelector<HTMLElement>('[data-preview-surface]')!;
  const editPanel = panel.querySelector<HTMLElement>('[data-edit-panel]')!;
  const editViewport = panel.querySelector<HTMLElement>('[data-edit-viewport]')!;
  const editStage = panel.querySelector<HTMLElement>('[data-edit-stage]')!;
  const editSurface = panel.querySelector<HTMLElement>('[data-edit-surface]')!;
  const brushSizeInput = panel.querySelector<HTMLInputElement>('[data-brush-size]')!;
  const brushSizeLabel = panel.querySelector<HTMLElement>('[data-brush-size-label]')!;
  const toolsScroll = panel.querySelector<HTMLElement>('[data-tools-scroll]')!;
  const debugEl = panel.querySelector<HTMLElement>('[data-pixel-debug]')!;
  const editCanvas = panel.querySelector<HTMLCanvasElement>('[data-edit-canvas]')!;
  const gridLayerCanvas = panel.querySelector<HTMLCanvasElement>('[data-grid-layer]')!;
  const previewGridArt = panel.querySelector<HTMLCanvasElement>('[data-preview-grid-art]')!;
  const selBox = panel.querySelector<HTMLElement>('[data-sel-box]')!;
  const colorPickerMount = panel.querySelector('[data-color-picker]')!;
  const alphaMount = panel.querySelector<HTMLElement>('[data-alpha-mount]')!;


  for (const k of PIXEL_ART_KEYS) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = k;
    select.append(opt);
  }
  select.value = currentKey;

  const picker = createColorPicker(
    { css: 'rgba(255,255,255,1)', hex: '#ffffff', alpha: 1 },
    (v: ColorPickerValue) => {
      paintColor = v.css;
      paintArgb = pixelToArgb(v.css);
    },
    { alphaMount }
  );
  colorPickerMount.append(picker.element);

  const presetsEl = panel.querySelector('[data-presets]')!;
  for (const hex of PALETTE_PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pixel-editor__preset';
    b.style.background = hex;
    b.addEventListener('click', () => {
      paintColor = hex.startsWith('#') ? hex : `rgba(255,255,255,1)`;
      paintArgb = pixelToArgb(paintColor);
    });
    presetsEl.append(b);
  }

  function setupCanvas(
    canvas: HTMLCanvasElement,
    w: number,
    h: number,
    dpr: number
  ): CanvasRenderingContext2D | null {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function canPanZoomView(): boolean {
    return tool === 'hand';
  }

  function applyEditViewTransform(): void {
    editStage.style.transform = `translate(${viewPanX}px, ${viewPanY}px) scale(${viewZoom})`;
    panel.classList.toggle('pixel-editor--pan-mode', canPanZoomView());
  }

  function updateEditorDebug(): void {
    if (!debugEl) return;
    debugEl.textContent = [
      `卡牌: ${currentKey}`,
      `工具: ${tool} · 笔粗: ${brushSize}`,
      `视图缩放: ${(viewZoom * 100).toFixed(0)}%`,
      `展示格: ${cellSize}px · 逻辑: ${gridCols}×${gridRows} · 显示: ${ART_DISPLAY_COLS}×${ART_DISPLAY_ROWS}`,
      `画布: ${gridPixelW}×${gridPixelH} · 撤销≤${MAX_UNDO}`,
      '',
      formatArtMemoryReport(),
    ].join('\n');
  }

  function availSizeInPane(
    panelEl: HTMLElement,
    minCols = ART_DISPLAY_COLS,
    minRows = ART_DISPLAY_ROWS
  ): { w: number; h: number } {
    const inset = PANE_INSET_PX * 2;
    return {
      w: Math.max(MIN_CELL_PX * minCols, panelEl.clientWidth - inset),
      h: Math.max(MIN_CELL_PX * minRows, panelEl.clientHeight - inset),
    };
  }

  function logicalRectToCanvasPx(rect: { x: number; y: number; w: number; h: number }) {
    return {
      left: (rect.x / gridCols) * gridPixelW,
      top: (rect.y / gridRows) * gridPixelH,
      width: (rect.w / gridCols) * gridPixelW,
      height: (rect.h / gridRows) * gridPixelH,
    };
  }

  function syncEditSurfaceSize(): void {
    const size = `${gridPixelW}px`;
    const sizeH = `${gridPixelH}px`;
    editStage.style.width = size;
    editStage.style.height = sizeH;
    editStage.style.minWidth = size;
    editStage.style.minHeight = sizeH;
    editStage.style.maxWidth = size;
    editStage.style.maxHeight = sizeH;
    panel.style.setProperty('--pe-art-w', size);
    panel.style.setProperty('--pe-art-h', sizeH);
  }

  function syncPreviewSurfaceSize(): void {
    const w = `${previewPixelW}px`;
    const h = `${previewPixelH}px`;
    previewSurface.style.width = w;
    previewSurface.style.height = h;
    previewSurface.style.minWidth = w;
    previewSurface.style.minHeight = h;
    previewSurface.style.maxWidth = w;
    previewSurface.style.maxHeight = h;
  }

  /** 预览区：按卡面展示分辨率（75×105）适配面板，与主页卡图一致 */
  function layoutPreview(): void {
    const avail = availSizeInPane(previewPanel);
    const aspect = gridCols / gridRows;
    let pw = Math.min(avail.w, ART_PREVIEW_WIDTH);
    let ph = Math.round(pw / aspect);
    if (ph > avail.h) {
      ph = Math.min(avail.h, ART_PREVIEW_HEIGHT);
      pw = Math.round(ph * aspect);
    }
    previewPixelW = Math.max(1, Math.floor(pw));
    previewPixelH = Math.max(1, Math.floor(ph));
    syncPreviewSurfaceSize();
    const dpr = window.devicePixelRatio || 1;
    setupCanvas(previewGridArt, previewPixelW, previewPixelH, dpr);
    refreshPreview();
  }

  /** 绘制区：按可用空间计算格宽（完整 500×700 逻辑网格） */
  function layoutViewport(): void {
    if (canvasRow.clientWidth < 24 || canvasRow.clientHeight < 24) {
      requestAnimationFrame(layoutViewport);
      return;
    }

    const editAvail = availSizeInPane(editPanel);
    cellSize = Math.max(
      MIN_CELL_PX,
      Math.floor(
        Math.min(editAvail.w / ART_DISPLAY_COLS, editAvail.h / ART_DISPLAY_ROWS)
      )
    );
    gridPixelW = ART_DISPLAY_COLS * cellSize;
    gridPixelH = ART_DISPLAY_ROWS * cellSize;
    syncEditSurfaceSize();
    layoutGrid();
    layoutPreview();
  }

  let debugOpen = false;

  function updateDebugUi(): void {
    debugBackdrop.classList.toggle('pixel-editor__drawer-backdrop--open', debugOpen);
    debugDrawer.classList.toggle('pixel-editor__drawer--open', debugOpen);
    debugBackdrop.setAttribute('aria-hidden', debugOpen ? 'false' : 'true');
    debugDrawer.setAttribute('aria-hidden', debugOpen ? 'false' : 'true');
    openDebugBtn.classList.toggle('pixel-editor__topbar-btn--active', debugOpen);
  }

  function toggleDebug(): void {
    debugOpen = !debugOpen;
    updateDebugUi();
  }

  function closeDebug(): void {
    debugOpen = false;
    updateDebugUi();
  }

  function layoutGrid(): void {
    const dpr = window.devicePixelRatio || 1;
    setupCanvas(editCanvas, gridPixelW, gridPixelH, dpr);
    setupCanvas(gridLayerCanvas, gridPixelW, gridPixelH, dpr);
    syncEditSurfaceSize();
    refreshAll();
    updateSelectionBox();
    updateEditorDebug();
  }

  /** 编辑区叠加网格（仅绘制区，不写入像素数据） */
  function drawReferenceGrid(): void {
    const ctx = gridLayerCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, gridPixelW, gridPixelH);
    if (!showGrid) return;

    const displayStep = Math.max(
      1,
      Math.round((ART_GRID_MAJOR_STEP * ART_DISPLAY_COLS) / gridCols)
    );
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = 1;

    const drawV = (c: number, strong: boolean) => {
      if (c < 0 || c > ART_DISPLAY_COLS) return;
      ctx.globalAlpha = strong ? 0.55 : 0.22;
      const x = (c / ART_DISPLAY_COLS) * gridPixelW + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, gridPixelH);
      ctx.stroke();
    };
    const drawH = (r: number, strong: boolean) => {
      if (r < 0 || r > ART_DISPLAY_ROWS) return;
      ctx.globalAlpha = strong ? 0.55 : 0.22;
      const y = (r / ART_DISPLAY_ROWS) * gridPixelH + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(gridPixelW, y);
      ctx.stroke();
    };

    for (let c = 0; c <= ART_DISPLAY_COLS; c += displayStep) drawV(c, true);
    for (let r = 0; r <= ART_DISPLAY_ROWS; r += displayStep) drawH(r, true);
    drawV(0, true);
    drawV(ART_DISPLAY_COLS, true);
    drawH(0, true);
    drawH(ART_DISPLAY_ROWS, true);
    ctx.globalAlpha = 1;
  }

  function refreshEditCanvas(): void {
    const ctx = editCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, gridPixelW, gridPixelH);
    drawPackedPreview(ctx, grid, gridPixelW, gridPixelH, gridCols, gridRows);
  }

  function refreshPreview(): void {
    const sq = previewGridArt.getContext('2d');
    if (!sq) return;
    sq.clearRect(0, 0, previewPixelW, previewPixelH);
    drawPackedPreview(sq, grid, previewPixelW, previewPixelH, gridCols, gridRows);
  }

  function refreshAll(): void {
    refreshEditCanvas();
    refreshPreview();
    drawReferenceGrid();
    updateSelectionBox();
  }

  function logicBlockForDisplayCell(dx: number, dy: number) {
    const x0 = Math.floor((dx * gridCols) / ART_DISPLAY_COLS);
    const y0 = Math.floor((dy * gridRows) / ART_DISPLAY_ROWS);
    const x1 =
      dx >= ART_DISPLAY_COLS - 1
        ? gridCols
        : Math.floor(((dx + 1) * gridCols) / ART_DISPLAY_COLS);
    const y1 =
      dy >= ART_DISPLAY_ROWS - 1
        ? gridRows
        : Math.floor(((dy + 1) * gridRows) / ART_DISPLAY_ROWS);
    return { x0, y0, x1, y1 };
  }

  /** 屏幕坐标 → 展示格（含最底行/最右列） */
  function displayCellFromPointer(
    clientX: number,
    clientY: number
  ): { dx: number; dy: number } | null {
    const rect = editCanvas.getBoundingClientRect();
    const dw = rect.width > 0 ? rect.width : gridPixelW || 1;
    const dh = rect.height > 0 ? rect.height : gridPixelH || 1;
    const canvasX = ((clientX - rect.left) / dw) * gridPixelW;
    const canvasY = ((clientY - rect.top) / dh) * gridPixelH;
    if (canvasX < 0 || canvasY < 0 || canvasX > gridPixelW || canvasY > gridPixelH) {
      return null;
    }
    const nx = Math.min(Math.max(canvasX / gridPixelW, 0), 1 - 1e-6);
    const ny = Math.min(Math.max(canvasY / gridPixelH, 0), 1 - 1e-6);
    return {
      dx: clamp(Math.floor(nx * ART_DISPLAY_COLS), 0, ART_DISPLAY_COLS - 1),
      dy: clamp(Math.floor(ny * ART_DISPLAY_ROWS), 0, ART_DISPLAY_ROWS - 1),
    };
  }

  /** 屏幕坐标 → 逻辑像素格（映射到展示块起点） */
  function cellFromPointer(clientX: number, clientY: number): { x: number; y: number } | null {
    const dc = displayCellFromPointer(clientX, clientY);
    if (!dc) return null;
    const { x0, y0 } = logicBlockForDisplayCell(dc.dx, dc.dy);
    return { x: x0, y: y0 };
  }

  function cellFromEvent(e: PointerEvent): { x: number; y: number } | null {
    return cellFromPointer(e.clientX, e.clientY);
  }

  function updateSelectionBox(rect?: { x: number; y: number; w: number; h: number }): void {
    const r =
      rect ??
      (selection
        ? { x: selection.x, y: selection.y, w: selection.w, h: selection.h }
        : null);
    if (!r) {
      selBox.hidden = true;
      return;
    }
    selBox.hidden = false;
    const px = logicalRectToCanvasPx(r);
    selBox.style.left = `${px.left}px`;
    selBox.style.top = `${px.top}px`;
    selBox.style.width = `${px.width}px`;
    selBox.style.height = `${px.height}px`;
  }

  function setTool(next: Tool): void {
    tool = next;
    panel.querySelectorAll('.pixel-editor__tool').forEach((btn) => {
      btn.classList.toggle(
        'pixel-editor__tool--active',
        (btn as HTMLElement).dataset.tool === next
      );
    });
    if (next !== 'move') {
      moveAnchor = null;
      lastDragCell = null;
    }
    if (next !== 'select') selectStart = null;
    if (next !== 'select' && next !== 'move') {
      clearSelection();
    } else if (next === 'move') {
      updateSelectionBox();
    }
    editCanvas.style.cursor =
      next === 'hand'
        ? 'grab'
        : next === 'move'
          ? selection
            ? 'grab'
            : 'not-allowed'
          : 'crosshair';
    applyEditViewTransform();
    updateEditorDebug();
  }

  function fillDisplayCell(dx: number, dy: number, colorArgb: number): void {
    if (dx < 0 || dy < 0 || dx >= ART_DISPLAY_COLS || dy >= ART_DISPLAY_ROWS) return;
    const { x0, y0, x1, y1 } = logicBlockForDisplayCell(dx, dy);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        recordCellChange(gridIndex(x, y, gridCols), colorArgb);
      }
    }
  }

  function forEachDisplayLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    visit: (dx: number, dy: number) => void
  ): void {
    let x = x0;
    let y = y0;
    const adx = Math.abs(x1 - x0);
    const ady = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = adx - ady;

    while (true) {
      visit(x, y);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -ady) {
        err -= ady;
        x += sx;
      }
      if (e2 < adx) {
        err += adx;
        y += sy;
      }
    }
  }

  /** 笔刷粗细按展示像素（75×105）计，与卡面所见块一致 */
  function stampBrushAtDisplay(centerDx: number, centerDy: number, colorArgb: number): void {
    const r = brushSize - 1;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (brushSize > 1 && dx * dx + dy * dy > r * r + r * 0.2) continue;
        fillDisplayCell(centerDx + dx, centerDy + dy, colorArgb);
      }
    }
  }

  /** 沿展示格连线绘制/擦除，避免拖动时跳过格子形成网格残留 */
  function paintAtDisplay(dc: { dx: number; dy: number }, colorArgb: number = paintArgb): void {
    if (lastPaintCell?.x === dc.dx && lastPaintCell?.y === dc.dy && brushSize === 1) {
      return;
    }
    if (lastPaintCell) {
      forEachDisplayLine(lastPaintCell.x, lastPaintCell.y, dc.dx, dc.dy, (px, py) => {
        stampBrushAtDisplay(px, py, colorArgb);
      });
    } else {
      stampBrushAtDisplay(dc.dx, dc.dy, colorArgb);
    }
    lastPaintCell = { x: dc.dx, y: dc.dy };
    refreshAll();
  }

  function sampleColor(x: number, y: number): void {
    const v = getPackedPixel(grid, x, y, gridCols);
    const c = argbToPixel(v);
    if (c) {
      paintColor = c;
      paintArgb = v;
      picker.setFromCss(c);
    }
  }

  function finishSelection(x1: number, y1: number): void {
    if (!selectStart) return;
    const rect = normalizeRect(selectStart.x, selectStart.y, x1, y1);
    rect.x = clamp(rect.x, 0, gridCols - 1);
    rect.y = clamp(rect.y, 0, gridRows - 1);
    rect.w = Math.min(rect.w, gridCols - rect.x);
    rect.h = Math.min(rect.h, gridRows - rect.y);
    if (rect.w < 1 || rect.h < 1) {
      clearSelection();
      return;
    }
    selection = {
      ...rect,
      pixels: copyPackedRegion(grid, rect.x, rect.y, rect.w, rect.h, gridCols),
    };
    updateSelectionBox(rect);
    selectStart = null;
    updateClipboardButtons();
    if (tool === 'move') {
      editCanvas.style.cursor = 'grab';
    }
  }

  function copySelection(): void {
    if (!selection) return;
    clipboard = {
      pixels: selection.pixels.slice(),
      w: selection.w,
      h: selection.h,
    };
    updateClipboardButtons();
  }

  function cutSelection(): void {
    if (!selection) return;
    beginUndoBatch();
    clipboard = {
      pixels: selection.pixels.slice(),
      w: selection.w,
      h: selection.h,
    };
    clearPackedRegion(
      grid,
      selection.x,
      selection.y,
      selection.w,
      selection.h,
      gridCols,
      recordCellChange
    );
    commitUndoBatch();
    clearSelection();
    refreshAll();
  }

  function pasteClipboard(): void {
    if (!clipboard) return;
    beginUndoBatch();
    const tx = clamp(selection?.x ?? 0, 0, Math.max(0, gridCols - clipboard.w));
    const ty = clamp(selection?.y ?? 0, 0, Math.max(0, gridRows - clipboard.h));
    pastePackedRegion(
      grid,
      gridCols,
      gridRows,
      tx,
      ty,
      clipboard.w,
      clipboard.h,
      clipboard.pixels,
      recordCellChange
    );
    commitUndoBatch();
    selection = {
      x: tx,
      y: ty,
      w: clipboard.w,
      h: clipboard.h,
      pixels: copyPackedRegion(grid, tx, ty, clipboard.w, clipboard.h, gridCols),
    };
    updateSelectionBox();
    updateClipboardButtons();
    refreshAll();
  }

  function commitMove(targetX: number, targetY: number): void {
    if (!selection) return;
    const tx = clamp(targetX, 0, gridCols - selection.w);
    const ty = clamp(targetY, 0, gridRows - selection.h);
    clearPackedRegion(grid, selection.x, selection.y, selection.w, selection.h, gridCols, recordCellChange);
    pastePackedRegion(
      grid,
      gridCols,
      gridRows,
      tx,
      ty,
      selection.w,
      selection.h,
      selection.pixels,
      recordCellChange
    );
    selection = {
      x: tx,
      y: ty,
      w: selection.w,
      h: selection.h,
      pixels: copyPackedRegion(grid, tx, ty, selection.w, selection.h, gridCols),
    };
    refreshAll();
  }

  const blockBrowserGesture = (e: Event) => e.preventDefault();

  for (const el of [overlay, panel, editSurface, editCanvas]) {
    el.addEventListener('contextmenu', blockBrowserGesture);
  }

  if (toolsScroll) {
    toolsScroll.addEventListener(
      'touchmove',
      (e) => e.stopPropagation(),
      { passive: true }
    );
    toolsScroll.addEventListener(
      'wheel',
      (e) => e.stopPropagation(),
      { passive: true }
    );
  }

  panel.addEventListener(
    'touchmove',
    (e) => {
      const t = e.target as Node;
      if (toolsScroll?.contains(t)) return;
      if (pointerDrawing) e.preventDefault();
    },
    { passive: false }
  );

  const onEditPointerDown = (e: PointerEvent) => {
    if (tool === 'hand' || navPointers.size >= 2) return;
    e.preventDefault();
    const dc = displayCellFromPointer(e.clientX, e.clientY);
    const cell = cellFromEvent(e);
    if (!dc && !cell) return;
    pointerDrawing = true;
    editSurface.setPointerCapture(e.pointerId);
    if (tool === 'paint') {
      if (!dc) return;
      if (!strokeUndoPushed) {
        beginUndoBatch();
        strokeUndoPushed = true;
      }
      lastPaintCell = null;
      paintAtDisplay(dc);
      return;
    }
    if (tool === 'fill') {
      if (!cell) return;
      const { x, y } = cell;
      beginUndoBatch();
      floodFillPacked(
        grid,
        gridCols,
        gridRows,
        x,
        y,
        paintArgb,
        recordCellChange
      );
      commitUndoBatch();
      refreshAll();
      return;
    }
    if (tool === 'eraser') {
      if (!dc) return;
      if (!strokeUndoPushed) {
        beginUndoBatch();
        strokeUndoPushed = true;
      }
      lastPaintCell = null;
      paintAtDisplay(dc, 0);
      return;
    }
    if (tool === 'eyedropper') {
      if (!cell) return;
      sampleColor(cell.x, cell.y);
      setTool('paint');
      return;
    }
    if (tool === 'select') {
      if (!cell) return;
      const { x, y } = cell;
      selectStart = { x, y };
      updateSelectionBox({ x, y, w: 1, h: 1 });
      return;
    }
    if (tool === 'move') {
      if (!cell || !selection) return;
      const { x, y } = cell;
      beginUndoBatch();
      moveAnchor = { x, y };
      moveOffset = { x: x - selection.x, y: y - selection.y };
      lastDragCell = { x, y };
      return;
    }
  };

  editSurface.addEventListener('pointerdown', onEditPointerDown);

  const onEditPointerMove = (e: PointerEvent) => {
    if (!editSurface.hasPointerCapture(e.pointerId)) return;
    e.preventDefault();
    const dc = displayCellFromPointer(e.clientX, e.clientY);
    const cell = cellFromEvent(e);
    if (tool === 'paint') {
      if (!dc) return;
      paintAtDisplay(dc);
      return;
    }
    if (tool === 'eraser') {
      if (!dc) return;
      paintAtDisplay(dc, 0);
      return;
    }
    if (!cell) return;
    const { x, y } = cell;
    if (tool === 'select' && selectStart) {
      updateSelectionBox(normalizeRect(selectStart.x, selectStart.y, x, y));
      return;
    }
    if (tool === 'move' && moveAnchor && selection) {
      lastDragCell = { x, y };
      updateSelectionBox({
        x: clamp(x - moveOffset.x, 0, gridCols - selection.w),
        y: clamp(y - moveOffset.y, 0, gridRows - selection.h),
        w: selection.w,
        h: selection.h,
      });
    }
  };

  editSurface.addEventListener('pointermove', onEditPointerMove);

  const onEditPointerUp = (e: PointerEvent) => {
    const cell = cellFromEvent(e) ?? lastDragCell;
    if (!cell) {
      if (tool === 'move' && moveAnchor) {
        moveAnchor = null;
        lastDragCell = null;
      }
      lastPaintCell = null;
      strokeUndoPushed = false;
      pointerDrawing = false;
      try {
        editSurface.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      return;
    }
    const { x, y } = cell;
    if (tool === 'select' && selectStart) finishSelection(x, y);
    if (tool === 'move' && moveAnchor && selection) {
      commitMove(x - moveOffset.x, y - moveOffset.y);
      commitUndoBatch();
      moveAnchor = null;
      lastDragCell = null;
      editCanvas.style.cursor = 'grab';
    }
    if (strokeUndoPushed && (tool === 'paint' || tool === 'eraser')) {
      commitUndoBatch();
    }
    lastPaintCell = null;
    strokeUndoPushed = false;
    pointerDrawing = false;
    try {
      editSurface.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };

  editSurface.addEventListener('pointerup', onEditPointerUp);

  editSurface.addEventListener('pointercancel', (e) => {
    if (strokeUndoPushed && (tool === 'paint' || tool === 'eraser')) {
      commitUndoBatch();
    }
    if (tool === 'move' && moveAnchor) {
      patchBatch = null;
    }
    lastPaintCell = null;
    strokeUndoPushed = false;
    moveAnchor = null;
    lastDragCell = null;
    pointerDrawing = false;
    try {
      editSurface.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  });

  panel.querySelectorAll('[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => setTool((btn as HTMLElement).dataset.tool as Tool));
  });

  panel.querySelector('[data-undo]')?.addEventListener('click', () => undo());
  panel.querySelector('[data-redo]')?.addEventListener('click', () => redo());
  panel.querySelector('[data-copy]')?.addEventListener('click', () => copySelection());
  panel.querySelector('[data-cut]')?.addEventListener('click', () => cutSelection());
  panel.querySelector('[data-paste]')?.addEventListener('click', () => pasteClipboard());

  brushSizeInput.addEventListener('input', () => {
    brushSize = clamp(Number(brushSizeInput.value) || 1, 1, MAX_BRUSH);
    brushSizeLabel.textContent = String(brushSize);
    updateEditorDebug();
  });

  panel.querySelector('[data-zoom-in]')?.addEventListener('click', () => {
    if (!canPanZoomView()) return;
    viewZoom = clamp(viewZoom * 1.25, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM);
    applyEditViewTransform();
    updateEditorDebug();
  });
  panel.querySelector('[data-zoom-out]')?.addEventListener('click', () => {
    if (!canPanZoomView()) return;
    viewZoom = clamp(viewZoom / 1.25, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM);
    applyEditViewTransform();
    updateEditorDebug();
  });
  panel.querySelector('[data-zoom-reset]')?.addEventListener('click', () => {
    if (!canPanZoomView()) return;
    viewPanX = 0;
    viewPanY = 0;
    viewZoom = 1;
    applyEditViewTransform();
    updateEditorDebug();
  });

  editViewport.addEventListener(
    'wheel',
    (e) => {
      if (!canPanZoomView()) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      viewZoom = clamp(viewZoom * factor, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM);
      applyEditViewTransform();
      updateEditorDebug();
    },
    { passive: false }
  );

  editViewport.addEventListener('pointerdown', (e) => {
    navPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (navPointers.size === 2 && canPanZoomView()) {
      const pts = [...navPointers.values()];
      lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      return;
    }
    if (canPanZoomView()) {
      e.preventDefault();
      editViewport.setPointerCapture(e.pointerId);
      navPanStart = { x: e.clientX, y: e.clientY, panX: viewPanX, panY: viewPanY };
    }
  });

  editViewport.addEventListener('pointermove', (e) => {
    if (!navPointers.has(e.pointerId)) return;
    navPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (navPointers.size === 2 && canPanZoomView()) {
      e.preventDefault();
      const pts = [...navPointers.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (lastPinchDist > 0) {
        viewZoom = clamp(
          viewZoom * (dist / lastPinchDist),
          MIN_VIEW_ZOOM,
          MAX_VIEW_ZOOM
        );
        applyEditViewTransform();
        updateEditorDebug();
      }
      lastPinchDist = dist;
      return;
    }

    if (canPanZoomView() && navPanStart && editViewport.hasPointerCapture(e.pointerId)) {
      e.preventDefault();
      viewPanX = navPanStart.panX + (e.clientX - navPanStart.x);
      viewPanY = navPanStart.panY + (e.clientY - navPanStart.y);
      applyEditViewTransform();
    }
  });

  const onNavPointerEnd = (e: PointerEvent) => {
    navPointers.delete(e.pointerId);
    if (navPointers.size < 2) lastPinchDist = 0;
    navPanStart = null;
    try {
      editViewport.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };
  editViewport.addEventListener('pointerup', onNavPointerEnd);
  editViewport.addEventListener('pointercancel', onNavPointerEnd);

  panel.querySelector('[data-toggle-grid]')?.addEventListener('click', () => {
    showGrid = !showGrid;
    drawReferenceGrid();
    const btn = panel.querySelector('[data-toggle-grid]');
    if (btn) btn.textContent = showGrid ? '参考线：开' : '参考线：关';
  });

  select.addEventListener('change', () => {
    persistDraft();
    currentKey = select.value as PixelArtKey;
    loadArtForKey(currentKey);
    layoutGrid();
    refreshAll();
  });

  const importFileInput = panel.querySelector<HTMLInputElement>('[data-import-file]')!;

  panel.querySelector('[data-import-image]')?.addEventListener('click', () => {
    importFileInput.click();
  });

  importFileInput.addEventListener('change', () => {
    const file = importFileInput.files?.[0];
    importFileInput.value = '';
    if (!file) return;

    void (async () => {
      try {
        const img = await loadImageFromFile(file);
        openImageImportModal({
          image: img,
          cols: gridCols,
          rows: gridRows,
          onConfirm: (imported) => {
            replaceGrid(gridToPacked(imported));
            clearSelection();
            viewPanX = 0;
            viewPanY = 0;
            viewZoom = 1;
            applyEditViewTransform();
            flattenEditorGrid();
            refreshAll();
            savePixelEditorDraft(currentKey, grid);
            requestAnimationFrame(() => layoutViewport());
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '导入失败';
        window.alert(msg);
      }
    })();
  });

  panel.querySelector('[data-clear]')?.addEventListener('click', () => {
    replaceGrid(makeEmptyGrid());
    selection = null;
    refreshAll();
  });

  panel.querySelector('[data-apply]')?.addEventListener('click', () => {
    flattenEditorGrid();
    setCustomArtGrid(currentKey, packedToGrid(grid));
    savePixelEditorDraft(currentKey, grid);
    onApplied();
  });

  panel.querySelector('[data-export]')?.addEventListener('click', () => {
    flattenEditorGrid();
    refreshAll();
    downloadPackedPng(grid, `${currentKey}.png`);
  });

  const fullscreenBtn = panel.querySelector<HTMLElement>('[data-fullscreen]')!;

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

  openDebugBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDebug();
  });
  debugBackdrop.addEventListener('click', closeDebug);
  debugDrawer.addEventListener('click', (e) => e.stopPropagation());
  panel.querySelectorAll('[data-close-drawer]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeDebug();
    });
  });

  const requestClose = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    closeDebug();
    closePixelEditor();
  };
  const closeBtn = panel.querySelector('.pixel-editor__close');
  closeBtn?.addEventListener('click', requestClose);
  closeBtn?.addEventListener('pointerup', requestClose);

  const onEditorKey = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && (e.key === 'c' || e.key === 'C') && selection) {
      e.preventDefault();
      copySelection();
      return;
    }
    if (mod && (e.key === 'x' || e.key === 'X') && selection) {
      e.preventDefault();
      cutSelection();
      return;
    }
    if (mod && (e.key === 'v' || e.key === 'V') && clipboard) {
      e.preventDefault();
      pasteClipboard();
      return;
    }
    if (e.key !== 'Escape') return;
    if (debugOpen) {
      closeDebug();
      return;
    }
    closePixelEditor();
  };
  document.addEventListener('keydown', onEditorKey);

  const ro = new ResizeObserver(() => layoutViewport());
  ro.observe(canvasRow);
  ro.observe(previewPanel);
  ro.observe(editPanel);

  const lastKey = getLastEditedArtKey();
  if (lastKey && PIXEL_ART_KEYS.includes(lastKey)) {
    currentKey = lastKey;
    select.value = lastKey;
  }
  loadArtForKey(currentKey);
  setTool('hand');
  layoutGrid();
  updateClipboardButtons();

  overlay.append(panel);
  editorOverlay = overlay;
  editorTeardown = () => {
    persistDraft();
    ro.disconnect();
    document.removeEventListener('keydown', onEditorKey);
    document.removeEventListener('fullscreenchange', updateFullscreenBtn);
  };
  getModalOverlayMount().append(overlay);
  updateDebugUi();
  updateFullscreenBtn();
  requestAnimationFrame(() => {
    layoutViewport();
    requestAnimationFrame(() => layoutViewport());
  });
}

export function closePixelEditor(): void {
  editorTeardown?.();
  editorTeardown = null;
  editorOverlay?.remove();
  editorOverlay = null;
  document.querySelector('[data-modal="pixel-editor"]')?.remove();
}
