import {
  compositePixelGrids,
  drawGridToCanvas,
  getArtGrid,
  gridDimensions,
  gridToExportCode,
  setCustomArtGrid,
  type Pixel,
  type PixelGrid,
  PIXEL_ART_KEYS,
} from '../art/pixelArt';
import { loadImageFromFile } from '../art/imageToGrid';
import { openImageImportModal } from './imageImportModal';
import type { PixelArtKey } from '../game/types';
import { createColorPicker, type ColorPickerValue } from './colorPicker';
import { getModalOverlayMount } from './overlayRoot';

const MIN_CELL_PX = 3;
const PANE_INSET_PX = 12;
const LAYER_COUNT = 3;
const MAX_UNDO = 48;

function cloneLayerGrid(grid: PixelGrid): PixelGrid {
  return grid.map((row) => [...row]);
}
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
  pixels: Pixel[][];
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normalizeRect(x0: number, y0: number, x1: number, y1: number) {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return { x, y, w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 };
}

function pixelEquals(a: Pixel, b: Pixel): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.replace(/\s/g, '').toLowerCase() === b.replace(/\s/g, '').toLowerCase();
}

/** 在逻辑像素格上填充（与参考网格线无关） */
function floodFill(
  grid: PixelGrid,
  cols: number,
  rows: number,
  x: number,
  y: number,
  fill: Pixel
): void {
  const target = grid[y]?.[x] ?? null;
  if (pixelEquals(target, fill)) return;

  const stack: [number, number][] = [[x, y]];
  const seen = new Set<string>();

  while (stack.length > 0) {
    const [cx, cy] = stack.pop()!;
    const key = `${cx},${cy}`;
    if (seen.has(key)) continue;
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
    if (!pixelEquals(grid[cy][cx] ?? null, target)) continue;
    seen.add(key);
    grid[cy][cx] = fill;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
}

function copyRegion(grid: PixelGrid, rect: Selection): Pixel[][] {
  const pixels: Pixel[][] = [];
  for (let dy = 0; dy < rect.h; dy++) {
    const row: Pixel[] = [];
    for (let dx = 0; dx < rect.w; dx++) {
      row.push(grid[rect.y + dy]?.[rect.x + dx] ?? null);
    }
    pixels.push(row);
  }
  return pixels;
}

function clearRegion(grid: PixelGrid, rect: Selection): void {
  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) {
      const yy = rect.y + dy;
      const xx = rect.x + dx;
      if (grid[yy] && xx < grid[yy].length) grid[yy][xx] = null;
    }
  }
}

function pasteRegion(
  grid: PixelGrid,
  cols: number,
  rows: number,
  atX: number,
  atY: number,
  pixels: Pixel[][]
): void {
  for (let dy = 0; dy < pixels.length; dy++) {
    for (let dx = 0; dx < pixels[dy].length; dx++) {
      const yy = atY + dy;
      const xx = atX + dx;
      if (yy < 0 || yy >= rows || xx < 0 || xx >= cols) continue;
      grid[yy][xx] = pixels[dy][dx];
    }
  }
}

let editorOverlay: HTMLElement | null = null;
let editorTeardown: (() => void) | null = null;

export function openPixelEditor(onApplied: () => void): void {
  closePixelEditor();

  let currentKey: PixelArtKey = 'heal-potion';
  let gridCols = 16;
  let gridRows = 22;
  let layers: PixelGrid[] = [];
  let activeLayer = 0;
  let layerVisible = [true, true, true];
  const undoStacks: PixelGrid[][] = Array.from({ length: LAYER_COUNT }, () => []);
  const redoStacks: PixelGrid[][] = Array.from({ length: LAYER_COUNT }, () => []);
  let strokeUndoPushed = false;
  let paintColor: Pixel = 'rgba(255,255,255,1)';
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

  function makeEmptyGrid(): PixelGrid {
    const out: PixelGrid = [];
    for (let y = 0; y < gridRows; y++) {
      out.push(Array.from({ length: gridCols }, (): Pixel => null));
    }
    return out;
  }

  function activeLayerGrid(): PixelGrid {
    return layers[activeLayer];
  }

  function compositeForDisplay(): PixelGrid {
    return compositePixelGrids(layers, layerVisible);
  }

  function resetLayerHistory(): void {
    for (let i = 0; i < LAYER_COUNT; i++) {
      undoStacks[i].length = 0;
      redoStacks[i].length = 0;
    }
    strokeUndoPushed = false;
    updateUndoRedoButtons();
  }

  function pushLayerUndo(): void {
    const stack = undoStacks[activeLayer];
    stack.push(cloneLayerGrid(activeLayerGrid()));
    if (stack.length > MAX_UNDO) stack.shift();
    redoStacks[activeLayer].length = 0;
    updateUndoRedoButtons();
  }

  function undoLayer(): void {
    const u = undoStacks[activeLayer];
    if (u.length === 0) return;
    redoStacks[activeLayer].push(cloneLayerGrid(activeLayerGrid()));
    layers[activeLayer] = u.pop()!;
    selection = null;
    selectStart = null;
    refreshAll();
    updateUndoRedoButtons();
  }

  function redoLayer(): void {
    const r = redoStacks[activeLayer];
    if (r.length === 0) return;
    undoStacks[activeLayer].push(cloneLayerGrid(activeLayerGrid()));
    layers[activeLayer] = r.pop()!;
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

  /** 从美术数据加载到第 1 层，其余层清空 */
  function reloadArtGrid(key: PixelArtKey): void {
    const src = getArtGrid(key);
    const dim = gridDimensions(src);
    gridCols = dim.cols;
    gridRows = dim.rows;
    layers = [
      src.map((row) => [...row]),
      makeEmptyGrid(),
      makeEmptyGrid(),
    ];
    activeLayer = 0;
    layerVisible = [true, true, true];
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
        <button type="button" class="pixel-editor__close" aria-label="关闭">×</button>
      </div>
    </header>
    <div class="pixel-editor__body pixel-editor__body--thirds" data-body>
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
              <div class="pixel-editor__layers-title">图层（撤销/重做仅当前层）</div>
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
            <button type="button" class="btn" data-export>导出</button>
          </div>
        </div>
      </section>
    </div>
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
  const bodyEl = panel.querySelector<HTMLElement>('[data-body]')!;
  const debugBackdrop = panel.querySelector<HTMLElement>('[data-debug-backdrop]')!;
  const debugDrawer = panel.querySelector<HTMLElement>('[data-debug-drawer]')!;
  const openDebugBtn = panel.querySelector<HTMLElement>('[data-open-debug]')!;
  const previewPanel = panel.querySelector<HTMLElement>('[data-preview-panel]')!;
  const previewSurface = panel.querySelector<HTMLElement>('[data-preview-surface]')!;
  const editPanel = panel.querySelector<HTMLElement>('[data-edit-panel]')!;
  const editSurface = panel.querySelector<HTMLElement>('[data-edit-surface]')!;
  const toolsPanel = panel.querySelector<HTMLElement>('[data-tools-panel]')!;
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
    if (bodyEl.clientWidth < 24 || bodyEl.clientHeight < 24) {
      requestAnimationFrame(layoutViewport);
      return;
    }

    const previewAvail = availSizeInPane(previewPanel);
    const editAvail = availSizeInPane(editPanel);
    const toolsAvail = availSizeInPane(toolsPanel);
    const availW = Math.min(previewAvail.w, editAvail.w, toolsAvail.w);
    const availH = Math.min(previewAvail.h, editAvail.h, toolsAvail.h);

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
    drawGridToCanvas(ctx, compositeForDisplay(), gridPixelW, gridPixelH);
  }

  function refreshPreview(): void {
    const sq = previewGridArt.getContext('2d');
    if (sq) {
      sq.clearRect(0, 0, gridPixelW, gridPixelH);
      drawGridToCanvas(sq, compositeForDisplay(), gridPixelW, gridPixelH);
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

  function paintAt(x: number, y: number, color: Pixel = paintColor): void {
    const layer = activeLayerGrid();
    if (lastPaintCell?.x === x && lastPaintCell?.y === y) return;
    layer[y][x] = color;
    lastPaintCell = { x, y };
    refreshAll();
  }

  function sampleColor(x: number, y: number): void {
    const c = compositeForDisplay()[y][x];
    if (c) {
      paintColor = c;
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
    selection = { ...rect, pixels: copyRegion(activeLayerGrid(), rect as Selection) };
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
    clearRegion(layer, selection);
    pasteRegion(layer, gridCols, gridRows, tx, ty, selection.pixels);
    selection = {
      x: tx,
      y: ty,
      w: selection.w,
      h: selection.h,
      pixels: copyRegion(layer, {
        x: tx,
        y: ty,
        w: selection.w,
        h: selection.h,
        pixels: [],
      }),
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
        pushLayerUndo();
        strokeUndoPushed = true;
      }
      lastPaintCell = null;
      paintAt(x, y);
      return;
    }
    if (tool === 'fill') {
      pushLayerUndo();
      floodFill(activeLayerGrid(), gridCols, gridRows, x, y, paintColor);
      refreshAll();
      return;
    }
    if (tool === 'eraser') {
      if (!strokeUndoPushed) {
        pushLayerUndo();
        strokeUndoPushed = true;
      }
      lastPaintCell = null;
      paintAt(x, y, null);
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
      pushLayerUndo();
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
      paintAt(x, y, null);
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
      moveAnchor = null;
      lastDragCell = null;
      editCanvas.style.cursor = 'grab';
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
    currentKey = select.value as PixelArtKey;
    reloadArtGrid(currentKey);
    selection = null;
    selectStart = null;
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
            pushLayerUndo();
            layers[activeLayer] = grid;
            selection = null;
            selectStart = null;
            refreshAll();
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '导入失败';
        window.alert(msg);
      }
    })();
  });

  panel.querySelector('[data-clear]')?.addEventListener('click', () => {
    pushLayerUndo();
    layers[activeLayer] = makeEmptyGrid();
    selection = null;
    refreshAll();
  });

  panel.querySelector('[data-apply]')?.addEventListener('click', () => {
    const merged = compositePixelGrids(layers);
    setCustomArtGrid(currentKey, merged);
    onApplied();
  });

  panel.querySelector('[data-export]')?.addEventListener('click', () => {
    const merged = compositePixelGrids(layers);
    const code = gridToExportCode(currentKey, merged);
    try {
      void navigator.clipboard.writeText(code);
    } catch {
      /* noop */
    }
  });

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
  ro.observe(bodyEl);
  ro.observe(previewPanel);
  ro.observe(editPanel);
  ro.observe(toolsPanel);

  reloadArtGrid(currentKey);

  overlay.append(panel);
  editorOverlay = overlay;
  editorTeardown = () => {
    ro.disconnect();
    document.removeEventListener('keydown', onEditorKey);
  };
  getModalOverlayMount().append(overlay);
  updateDebugUi();
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
