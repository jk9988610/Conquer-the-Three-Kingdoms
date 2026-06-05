import {
  ART_GRID_COLS,
  ART_GRID_ROWS,
  getArtPacked,
  setCustomArtGrid,
  type Pixel,
  PIXEL_ART_KEYS,
} from '../art/pixelArt';
import {
  argbToPixel,
  clonePackedGrid,
  collectPackedDiff,
  compositePackedGrids,
  copyPackedRegion,
  createPackedGrid,
  downloadPackedPng,
  drawPackedGridCells,
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
import { getModalOverlayMount } from './overlayRoot';

const MIN_CELL_PX = 1;
const PANE_INSET_PX = 4;
const LAYER_COUNT = 3;
const MAX_UNDO = 5;

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

type Tool = 'paint' | 'fill' | 'eraser' | 'eyedropper' | 'select' | 'move';

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
  let layers: PackedGrid[] = [];
  let activeLayer = 0;
  let layerVisible = [true, true, true];
  const undoStacks: UndoEntry[][] = Array.from({ length: LAYER_COUNT }, () => []);
  const redoStacks: UndoEntry[][] = Array.from({ length: LAYER_COUNT }, () => []);
  let patchBatch: Map<number, { prev: number; next: number }> | null = null;
  let strokeUndoPushed = false;
  let paintColor: Pixel = 'rgba(255,255,255,1)';
  let paintArgb = pixelToArgb(paintColor);
  let tool: Tool = 'paint';
  let showGrid = true;
  let selection: Selection | null = null;
  let selectStart: { x: number; y: number } | null = null;
  let moveAnchor: { x: number; y: number } | null = null;
  let moveOffset = { x: 0, y: 0 };
  let lastPaintCell: { x: number; y: number } | null = null;
  let lastDragCell: { x: number; y: number } | null = null;
  let pointerDrawing = false;
  let cellSize = 4;
  let gridPixelW = gridCols * cellSize;
  let gridPixelH = gridRows * cellSize;

  function makeEmptyLayer(): PackedGrid {
    return createPackedGrid(gridCols, gridRows);
  }

  function activeLayerGrid(): PackedGrid {
    return layers[activeLayer];
  }

  function compositeForDisplay(): PackedGrid {
    return compositePackedGrids(layers, layerVisible);
  }

  function recordCellChange(index: number, next: number): void {
    const grid = activeLayerGrid();
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
    const stack = undoStacks[activeLayer];
    stack.push(entry);
    if (stack.length > MAX_UNDO) stack.shift();
    redoStacks[activeLayer].length = 0;
    patchBatch = null;
    updateUndoRedoButtons();
  }

  function pushLayerPatches(patches: UndoEntry): void {
    if (patches.length === 0) return;
    const stack = undoStacks[activeLayer];
    stack.push(patches);
    if (stack.length > MAX_UNDO) stack.shift();
    redoStacks[activeLayer].length = 0;
    updateUndoRedoButtons();
  }

  function applyUndoEntry(entry: UndoEntry, useNext: boolean): void {
    const grid = activeLayerGrid();
    for (const p of entry) {
      grid[p.i] = (useNext ? p.next : p.prev) >>> 0;
    }
  }

  function replaceActiveLayer(next: PackedGrid): void {
    const before = clonePackedGrid(activeLayerGrid());
    layers[activeLayer] = clonePackedGrid(next);
    pushLayerPatches(collectPackedDiff(before, layers[activeLayer]));
  }

  function resetLayerHistory(): void {
    for (let i = 0; i < LAYER_COUNT; i++) {
      undoStacks[i].length = 0;
      redoStacks[i].length = 0;
    }
    strokeUndoPushed = false;
    patchBatch = null;
    updateUndoRedoButtons();
  }

  function undoLayer(): void {
    const u = undoStacks[activeLayer];
    if (u.length === 0) return;
    const entry = u.pop()!;
    redoStacks[activeLayer].push(entry);
    applyUndoEntry(entry, false);
    selection = null;
    selectStart = null;
    refreshAll();
    updateUndoRedoButtons();
  }

  function redoLayer(): void {
    const r = redoStacks[activeLayer];
    if (r.length === 0) return;
    const entry = r.pop()!;
    undoStacks[activeLayer].push(entry);
    applyUndoEntry(entry, true);
    selection = null;
    selectStart = null;
    refreshAll();
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons(): void {
    const undoBtn = panel.querySelector<HTMLButtonElement>('[data-undo]');
    const redoBtn = panel.querySelector<HTMLButtonElement>('[data-redo]');
    if (undoBtn) undoBtn.disabled = undoStacks[activeLayer].length === 0;
    if (redoBtn) redoBtn.disabled = redoStacks[activeLayer].length === 0;
  }

  function persistDraft(): void {
    savePixelEditorDraft(currentKey, layers, layerVisible);
  }

  /** 优先恢复本地草稿，否则从已应用美术加载 */
  function loadArtForKey(key: PixelArtKey): void {
    gridCols = ART_GRID_COLS;
    gridRows = ART_GRID_ROWS;
    const draft = loadPixelEditorDraft(key);
    if (draft) {
      layers = draft.layers.map((g) => clonePackedGrid(g));
      layerVisible = [...draft.layerVisible];
    } else {
      layers = [clonePackedGrid(getArtPacked(key)), makeEmptyLayer(), makeEmptyLayer()];
      layerVisible = [true, true, true];
    }
    activeLayer = 0;
    selection = null;
    selectStart = null;
    resetLayerHistory();
    renderLayerControls();
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
        <div class="pixel-editor__pane-fill" data-edit-panel>
          <div class="pixel-editor__art-surface" data-edit-surface>
            <canvas data-edit-canvas></canvas>
            <canvas class="pixel-editor__grid-overlay" data-grid-layer></canvas>
            <div class="pixel-editor__sel-box" data-sel-box hidden></div>
          </div>
        </div>
      </section>
    </div>
    <section class="pixel-editor__pane pixel-editor__pane--tools">
      <div class="pixel-editor__pane-label">工具</div>
      <div class="pixel-editor__pane-fill pixel-editor__pane-fill--tools" data-tools-panel>
          <div class="pixel-editor__tools-scroll" data-tools-scroll>
            <label class="pixel-editor__card-label">卡牌 <select data-select></select></label>
            <div class="pixel-editor__tools-grid">
              <button type="button" class="btn pixel-editor__tool pixel-editor__tool--active" data-tool="paint">画笔</button>
              <button type="button" class="btn pixel-editor__tool" data-tool="fill">填充</button>
              <button type="button" class="btn pixel-editor__tool" data-tool="eraser">橡皮</button>
              <button type="button" class="btn pixel-editor__tool" data-tool="eyedropper">取色</button>
              <button type="button" class="btn pixel-editor__tool" data-tool="select">框选</button>
              <button type="button" class="btn pixel-editor__tool" data-tool="move">移动</button>
              <button type="button" class="btn" data-undo disabled>撤销</button>
              <button type="button" class="btn" data-redo disabled>重做</button>
            </div>
            <div class="pixel-editor__layers">
              <div class="pixel-editor__layers-title">图层（撤销≤5步/层）</div>
              <div class="pixel-editor__layer-list" data-layer-list></div>
            </div>
            <div class="pixel-editor__color-block" data-color-picker></div>
            <div class="pixel-editor__presets" data-presets></div>
          </div>
          <div class="pixel-editor__tools-actions">
            <button type="button" class="btn" data-import-image>导入图片</button>
            <input type="file" accept="image/*" hidden data-import-file />
            <button type="button" class="btn" data-toggle-grid>网格：开</button>
            <button type="button" class="btn" data-clear>清空当前层</button>
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
  const editSurface = panel.querySelector<HTMLElement>('[data-edit-surface]')!;
  const toolsScroll = panel.querySelector<HTMLElement>('[data-tools-scroll]')!;
  const debugEl = panel.querySelector<HTMLElement>('[data-pixel-debug]')!;
  const editCanvas = panel.querySelector<HTMLCanvasElement>('[data-edit-canvas]')!;
  const gridLayerCanvas = panel.querySelector<HTMLCanvasElement>('[data-grid-layer]')!;
  const previewGridArt = panel.querySelector<HTMLCanvasElement>('[data-preview-grid-art]')!;
  const selBox = panel.querySelector<HTMLElement>('[data-sel-box]')!;
  const colorPickerMount = panel.querySelector('[data-color-picker]')!;


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
    }
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

  function renderLayerControls(): void {
    const list = panel.querySelector<HTMLElement>('[data-layer-list]');
    if (!list) return;
    list.replaceChildren();
    for (let i = 0; i < LAYER_COUNT; i++) {
      const row = document.createElement('div');
      row.className = 'pixel-editor__layer-row';

      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'btn pixel-editor__layer-pick';
      pick.textContent = `层 ${i + 1}`;
      pick.classList.toggle('pixel-editor__layer-pick--active', i === activeLayer);
      pick.addEventListener('click', () => {
        if (activeLayer === i) return;
        activeLayer = i;
        selection = null;
        selectStart = null;
        strokeUndoPushed = false;
        selBox.hidden = true;
        renderLayerControls();
        refreshAll();
        updateUndoRedoButtons();
        updateEditorDebug();
      });

      const vis = document.createElement('button');
      vis.type = 'button';
      vis.className = 'btn pixel-editor__layer-vis';
      vis.textContent = layerVisible[i] ? '显' : '隐';
      vis.classList.toggle('pixel-editor__layer-vis--off', !layerVisible[i]);
      vis.title = layerVisible[i] ? '隐藏该层' : '显示该层';
      vis.addEventListener('click', () => {
        layerVisible[i] = !layerVisible[i];
        renderLayerControls();
        refreshAll();
      });

      row.append(pick, vis);
      list.append(row);
    }
  }

  function updateEditorDebug(): void {
    if (!debugEl) return;
    debugEl.textContent = [
      `卡牌: ${currentKey}`,
      `工具: ${tool}`,
      `图层: ${activeLayer + 1}/${LAYER_COUNT}（撤销仅本层）`,
      `格宽: ${cellSize}px`,
      `网格: ${gridCols}×${gridRows}`,
      `画布: ${gridPixelW}×${gridPixelH}`,
    ].join('\n');
  }

  function availSizeInPane(panelEl: HTMLElement): { w: number; h: number } {
    const inset = PANE_INSET_PX * 2;
    return {
      w: Math.max(MIN_CELL_PX * gridCols, panelEl.clientWidth - inset),
      h: Math.max(MIN_CELL_PX * gridRows, panelEl.clientHeight - inset),
    };
  }

  function syncArtSurfaceSize(): void {
    const size = `${gridPixelW}px`;
    const sizeH = `${gridPixelH}px`;
    for (const el of [previewSurface, editSurface]) {
      el.style.width = size;
      el.style.height = sizeH;
      el.style.minWidth = size;
      el.style.minHeight = sizeH;
      el.style.maxWidth = size;
      el.style.maxHeight = sizeH;
    }
    panel.style.setProperty('--pe-art-w', size);
    panel.style.setProperty('--pe-art-h', sizeH);
  }

  /** 按三栏可用空间计算格宽，预览与绘制画布像素尺寸一致 */
  function layoutViewport(): void {
    if (canvasRow.clientWidth < 24 || canvasRow.clientHeight < 24) {
      requestAnimationFrame(layoutViewport);
      return;
    }

    const previewAvail = availSizeInPane(previewPanel);
    const editAvail = availSizeInPane(editPanel);
    const availW = Math.min(previewAvail.w, editAvail.w);
    const availH = Math.min(previewAvail.h, editAvail.h);

    cellSize = Math.max(
      MIN_CELL_PX,
      Math.floor(Math.min(availW / gridCols, availH / gridRows))
    );
    gridPixelW = gridCols * cellSize;
    gridPixelH = gridRows * cellSize;
    syncArtSurfaceSize();
    layoutGrid();
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
    setupCanvas(previewGridArt, gridPixelW, gridPixelH, dpr);
    setupCanvas(gridLayerCanvas, gridPixelW, gridPixelH, dpr);
    syncArtSurfaceSize();
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

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
    ctx.lineWidth = 1;

    for (let c = 0; c <= gridCols; c++) {
      const x = c * cellSize + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, gridPixelH);
      ctx.stroke();
    }

    for (let r = 0; r <= gridRows; r++) {
      const y = r * cellSize + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(gridPixelW, y);
      ctx.stroke();
    }
  }

  function refreshEditCanvas(): void {
    const ctx = editCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, gridPixelW, gridPixelH);
    drawPackedGridCells(ctx, compositeForDisplay(), cellSize, gridCols, gridRows);
  }

  function refreshPreview(): void {
    const sq = previewGridArt.getContext('2d');
    if (sq) {
      sq.clearRect(0, 0, gridPixelW, gridPixelH);
      drawPackedGridCells(sq, compositeForDisplay(), cellSize, gridCols, gridRows);
    }
  }

  function refreshAll(): void {
    refreshEditCanvas();
    refreshPreview();
    drawReferenceGrid();
    updateSelectionBox();
  }

  /** 屏幕坐标 → 逻辑像素格（仅 TCG 画布内；参考格线外延区返回 null） */
  function cellFromPointer(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = editCanvas.getBoundingClientRect();
    const dw = rect.width > 0 ? rect.width : gridPixelW || 1;
    const dh = rect.height > 0 ? rect.height : gridPixelH || 1;
    const canvasX = ((clientX - rect.left) / dw) * gridPixelW;
    const canvasY = ((clientY - rect.top) / dh) * gridPixelH;
    if (canvasX < 0 || canvasY < 0 || canvasX >= gridPixelW || canvasY >= gridPixelH) {
      return null;
    }
    return {
      x: clamp(Math.floor(canvasX / cellSize), 0, gridCols - 1),
      y: clamp(Math.floor(canvasY / cellSize), 0, gridRows - 1),
    };
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
    selBox.style.left = `${r.x * cellSize}px`;
    selBox.style.top = `${r.y * cellSize}px`;
    selBox.style.width = `${r.w * cellSize}px`;
    selBox.style.height = `${r.h * cellSize}px`;
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
    if (next === 'move') updateSelectionBox();
    editCanvas.style.cursor =
      next === 'move' ? (selection ? 'grab' : 'not-allowed') : 'crosshair';
    updateEditorDebug();
  }

  function paintAt(x: number, y: number, colorArgb: number = paintArgb): void {
    if (lastPaintCell?.x === x && lastPaintCell?.y === y) return;
    recordCellChange(gridIndex(x, y, gridCols), colorArgb);
    lastPaintCell = { x, y };
    refreshAll();
  }

  function sampleColor(x: number, y: number): void {
    const v = getPackedPixel(compositeForDisplay(), x, y, gridCols);
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
      selection = null;
      selBox.hidden = true;
      return;
    }
    selection = {
      ...rect,
      pixels: copyPackedRegion(
        activeLayerGrid(),
        rect.x,
        rect.y,
        rect.w,
        rect.h,
        gridCols
      ),
    };
    updateSelectionBox(rect);
    selectStart = null;
    if (tool === 'move') {
      editCanvas.style.cursor = 'grab';
    }
  }

  function commitMove(targetX: number, targetY: number): void {
    if (!selection) return;
    const layer = activeLayerGrid();
    const tx = clamp(targetX, 0, gridCols - selection.w);
    const ty = clamp(targetY, 0, gridRows - selection.h);
    clearPackedRegion(layer, selection.x, selection.y, selection.w, selection.h, gridCols, recordCellChange);
    pastePackedRegion(
      layer,
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
      pixels: copyPackedRegion(layer, tx, ty, selection.w, selection.h, gridCols),
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
    e.preventDefault();
    const cell = cellFromEvent(e);
    if (!cell) return;
    pointerDrawing = true;
    editSurface.setPointerCapture(e.pointerId);
    const { x, y } = cell;
    if (tool === 'paint') {
      if (!strokeUndoPushed) {
        beginUndoBatch();
        strokeUndoPushed = true;
      }
      lastPaintCell = null;
      paintAt(x, y);
      return;
    }
    if (tool === 'fill') {
      beginUndoBatch();
      floodFillPacked(
        activeLayerGrid(),
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
      if (!strokeUndoPushed) {
        beginUndoBatch();
        strokeUndoPushed = true;
      }
      lastPaintCell = null;
      paintAt(x, y, 0);
      return;
    }
    if (tool === 'eyedropper') {
      sampleColor(x, y);
      setTool('paint');
      return;
    }
    if (tool === 'select') {
      selectStart = { x, y };
      updateSelectionBox({ x, y, w: 1, h: 1 });
      return;
    }
    if (tool === 'move') {
      if (!selection) return;
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
    const cell = cellFromEvent(e);
    if (!cell) return;
    const { x, y } = cell;
    if (tool === 'paint') {
      paintAt(x, y);
      return;
    }
    if (tool === 'eraser') {
      paintAt(x, y, 0);
      return;
    }
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

  panel.querySelector('[data-undo]')?.addEventListener('click', () => undoLayer());
  panel.querySelector('[data-redo]')?.addEventListener('click', () => redoLayer());

  panel.querySelector('[data-toggle-grid]')?.addEventListener('click', () => {
    showGrid = !showGrid;
    drawReferenceGrid();
    const btn = panel.querySelector('[data-toggle-grid]');
    if (btn) btn.textContent = showGrid ? '网格：开' : '网格';
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
          onConfirm: (grid) => {
            replaceActiveLayer(gridToPacked(grid));
            selection = null;
            selectStart = null;
            refreshAll();
            persistDraft();
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '导入失败';
        window.alert(msg);
      }
    })();
  });

  panel.querySelector('[data-clear]')?.addEventListener('click', () => {
    replaceActiveLayer(makeEmptyLayer());
    selection = null;
    refreshAll();
  });

  panel.querySelector('[data-apply]')?.addEventListener('click', () => {
    const merged = packedToGrid(compositeForDisplay());
    setCustomArtGrid(currentKey, merged);
    persistDraft();
    onApplied();
  });

  panel.querySelector('[data-export]')?.addEventListener('click', () => {
    const merged = compositePackedGrids(layers);
    downloadPackedPng(merged, `${currentKey}.png`);
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
      if (e.shiftKey) redoLayer();
      else undoLayer();
      return;
    }
    if (mod && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      redoLayer();
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
  layoutGrid();

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
