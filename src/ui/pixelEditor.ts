import {
  drawGridToCanvas,
  getArtGrid,
  gridDimensions,
  gridToExportCode,
  setCustomArtGrid,
  type Pixel,
  type PixelGrid,
  PIXEL_ART_KEYS,
} from '../art/pixelArt';
import { loadImageFromFile, sampleImageToGrid } from '../art/imageToGrid';
import { INNER_ASPECT_RATIO } from '../tcg/dimensions';
import type { PixelArtKey } from '../game/types';
import { createColorPicker, type ColorPickerValue } from './colorPicker';
import { getModalOverlayMount } from './overlayRoot';

const RULER_PX = 18;
const MIN_CELL_PX = 3;
/** 画布四周最小外延格数（实际随视口扩展至边框） */
const MIN_PAD_CELLS = 2;
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

function normalizeGrid(g: PixelGrid, cols: number, rows: number): PixelGrid {
  const out: PixelGrid = [];
  const srcRows = Math.max(1, g.length);
  const srcCols = Math.max(1, ...g.map((r) => r.length));
  for (let y = 0; y < rows; y++) {
    const row: Pixel[] = [];
    const sy = Math.min(rows - 1, Math.floor((y / rows) * srcRows));
    const src = g[sy] ?? [];
    for (let x = 0; x < cols; x++) {
      const sx = Math.min(srcCols - 1, Math.floor((x / cols) * srcCols));
      row.push(src[sx] ?? null);
    }
    out.push(row);
  }
  return out;
}

/** 格大时每格标号；格中每 5 格；格小每 10 格 */
function rulerLabelStep(cellPx: number): number {
  if (cellPx >= 18) return 1;
  if (cellPx >= 9) return 5;
  return 10;
}

function fitGridToViewport(
  vw: number,
  vh: number,
  targetCell: number
): { cols: number; rows: number; cell: number; gridW: number; gridH: number } {
  let cell = Math.max(MIN_CELL_PX, Math.floor(targetCell));
  let cols = Math.max(4, Math.floor(vw / cell));
  let rows = Math.max(4, Math.floor(vh / cell));
  cell = Math.max(MIN_CELL_PX, Math.floor(Math.min(vw / cols, vh / rows)));
  cols = Math.max(4, Math.floor(vw / cell));
  rows = Math.max(4, Math.floor(vh / cell));
  return { cols, rows, cell, gridW: cols * cell, gridH: rows * cell };
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
  let grid: PixelGrid = [];
  let paintColor: Pixel = 'rgba(255,255,255,1)';
  let tool: Tool = 'paint';
  let showGrid = true;
  let selection: Selection | null = null;
  let selectStart: { x: number; y: number } | null = null;
  let moveAnchor: { x: number; y: number } | null = null;
  let moveOffset = { x: 0, y: 0 };
  let lastPaintCell: { x: number; y: number } | null = null;
  let pointerDrawing = false;
  const ZOOM_MIN = 4;
  const ZOOM_MAX = 8;

  let cellZoom = ZOOM_MIN;
  /** 缩放模式：单指平移画布，双指捏合缩放网格 */
  let zoomMode = false;
  let panOffset = { x: 0, y: 0 };
  let panDrag: { px: number; py: number; ox: number; oy: number } | null = null;
  const navPointers = new Map<number, { x: number; y: number }>();
  let navPinchDist0 = 0;
  let navPinchZoom0 = 1;
  let pinchRaf = 0;
  let pendingPinchFocal: { stageX: number; stageY: number } | null = null;
  let brushSize = 1;
  let baseCellSize = 4;
  let cellSize = 4;
  let gridPixelW = gridCols * cellSize;
  let gridPixelH = gridRows * cellSize;
  let viewportW = 200;
  let viewportH = 274;
  let padCellsX = MIN_PAD_CELLS;
  let padCellsY = MIN_PAD_CELLS;

  /** 从美术数据原样加载，行列与 grid[][] 一致（避免 normalize 拉伸导致与参考网格错位） */
  function reloadArtGrid(key: PixelArtKey): void {
    const src = getArtGrid(key);
    const dim = gridDimensions(src);
    gridCols = dim.cols;
    gridRows = dim.rows;
    grid = src.map((row) => [...row]);
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
          <div class="pixel-editor__canvas-shell" data-preview-shell>
            <div class="pixel-editor__ruler-corner pixel-editor__ruler-corner--ghost" aria-hidden="true"></div>
            <div class="pixel-editor__ruler-ghost pixel-editor__ruler-ghost--top" aria-hidden="true"></div>
            <div class="pixel-editor__ruler-ghost pixel-editor__ruler-ghost--left" aria-hidden="true"></div>
            <div class="pixel-editor__grid-frame" data-preview-frame>
              <div class="pixel-editor__grid-inner" data-preview-inner>
                <canvas data-preview-grid-art></canvas>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section class="pixel-editor__pane pixel-editor__pane--edit">
        <div class="pixel-editor__pane-label">绘制</div>
        <div class="pixel-editor__pane-fill" data-edit-panel>
          <div class="pixel-editor__edit-frame" data-edit-frame>
            <div class="pixel-editor__ruler-corner" data-ruler-corner></div>
            <div class="pixel-editor__ruler-top" data-ruler-top></div>
            <div class="pixel-editor__ruler-left" data-ruler-left></div>
            <div class="pixel-editor__edit-stage" data-art-stage>
              <canvas class="pixel-editor__grid-layer" data-grid-layer></canvas>
              <div class="pixel-editor__art-pan" data-art-pan>
                <canvas data-edit-canvas></canvas>
                <div class="pixel-editor__sel-box" data-sel-box hidden></div>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section class="pixel-editor__pane pixel-editor__pane--tools">
        <div class="pixel-editor__pane-label">工具</div>
        <div class="pixel-editor__pane-fill pixel-editor__pane-fill--tools" data-tools-panel>
          <div class="pixel-editor__tools-scroll" data-tools-scroll>
            <label class="pixel-editor__card-label">卡牌 <select data-select></select></label>
            <div class="pixel-editor__tools-zoom">
              <button type="button" class="btn pixel-editor__zoom-mode" data-zoom-mode-toggle title="单指拖动、双指缩放网格">缩放</button>
            </div>
            <div class="pixel-editor__tools-grid">
              <button type="button" class="btn pixel-editor__tool pixel-editor__tool--active" data-tool="paint">画笔</button>
              <button type="button" class="btn pixel-editor__tool" data-tool="fill">填充</button>
              <button type="button" class="btn pixel-editor__tool" data-tool="eraser">橡皮</button>
              <button type="button" class="btn pixel-editor__tool" data-tool="eyedropper">取色</button>
              <button type="button" class="btn pixel-editor__tool" data-tool="select">框选</button>
              <button type="button" class="btn pixel-editor__tool" data-tool="move">移动</button>
            </div>
            <label class="pixel-editor__brush-size">
              <span>画笔粗细</span>
              <input type="range" data-brush-size min="1" max="8" value="1" />
              <span data-brush-size-label>1</span>
            </label>
            <div class="pixel-editor__color-block" data-color-picker></div>
            <div class="pixel-editor__presets" data-presets></div>
          </div>
          <div class="pixel-editor__tools-actions">
            <button type="button" class="btn" data-import-image>导入图片</button>
            <input type="file" accept="image/*" hidden data-import-file />
            <button type="button" class="btn" data-toggle-grid>网格：开</button>
            <button type="button" class="btn" data-clear>清空</button>
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
  const previewShell = panel.querySelector<HTMLElement>('[data-preview-shell]')!;
  const editPanel = panel.querySelector<HTMLElement>('[data-edit-panel]')!;
  const editFrame = panel.querySelector<HTMLElement>('[data-edit-frame]')!;
  const toolsPanel = panel.querySelector<HTMLElement>('[data-tools-panel]')!;
  const toolsScroll = panel.querySelector<HTMLElement>('[data-tools-scroll]')!;
  const previewFrame = panel.querySelector<HTMLElement>('[data-preview-frame]')!;
  const previewInner = panel.querySelector<HTMLElement>('[data-preview-inner]')!;
  const debugEl = panel.querySelector<HTMLElement>('[data-pixel-debug]')!;
  const artStage = panel.querySelector<HTMLElement>('[data-art-stage]')!;
  const artPan = panel.querySelector<HTMLElement>('[data-art-pan]')!;
  const editCanvas = panel.querySelector<HTMLCanvasElement>('[data-edit-canvas]')!;
  const gridLayerCanvas = panel.querySelector<HTMLCanvasElement>('[data-grid-layer]')!;
  const previewGridArt = panel.querySelector<HTMLCanvasElement>('[data-preview-grid-art]')!;
  const selBox = panel.querySelector<HTMLElement>('[data-sel-box]')!;
  const rulerTop = panel.querySelector<HTMLElement>('[data-ruler-top]')!;
  const rulerLeft = panel.querySelector<HTMLElement>('[data-ruler-left]')!;
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

  function updateEditorDebug(): void {
    if (!debugEl) return;
    debugEl.textContent = [
      `卡牌: ${currentKey}`,
      `工具: ${tool}`,
      `画笔: ${brushSize}`,
      `格宽: ${cellSize}px`,
      `缩放: ${cellZoom.toFixed(2)}${zoomMode ? ' (手势)' : ''}`,
      `网格: ${gridCols}×${gridRows}`,
      `像素: ${gridPixelW}×${gridPixelH}`,
      `视口: ${viewportW}×${viewportH}`,
      `填充: ${Math.round((gridPixelW / viewportW) * 100)}%×${Math.round((gridPixelH / viewportH) * 100)}%`,
    ].join('\n');
  }

  function recomputePadCells(): void {
    if (cellSize < 1) return;
    padCellsX = Math.max(
      MIN_PAD_CELLS,
      Math.ceil((viewportW - gridPixelW) / (2 * cellSize))
    );
    padCellsY = Math.max(
      MIN_PAD_CELLS,
      Math.ceil((viewportH - gridPixelH) / (2 * cellSize))
    );
  }

  const padPxX = () => padCellsX * cellSize;
  const padPxY = () => padCellsY * cellSize;

  /** 可绘区左上角在舞台坐标（仅平移层移动，标尺固定） */
  function artOriginInStage(): { x: number; y: number } {
    return { x: padPxX() + panOffset.x, y: padPxY() + panOffset.y };
  }

  function panContentSize(): { w: number; h: number } {
    return { w: gridPixelW + 2 * padPxX(), h: gridPixelH + 2 * padPxY() };
  }

  function panBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    const { w: panW, h: panH } = panContentSize();
    const slackX = padPxX();
    const slackY = padPxY();
    return {
      minX: Math.min(0, viewportW - panW) - slackX,
      maxX: Math.max(0, viewportW - panW) + slackX,
      minY: Math.min(0, viewportH - panH) - slackY,
      maxY: Math.max(0, viewportH - panH) + slackY,
    };
  }

  function clampPan(o: { x: number; y: number }): { x: number; y: number } {
    const { minX, maxX, minY, maxY } = panBounds();
    return {
      x: clamp(o.x, minX, maxX),
      y: clamp(o.y, minY, maxY),
    };
  }

  /** 仅夹紧平移，不强制贴边或居中（最小缩放可拖动画边缘） */
  function snapPanHome(): void {
    panOffset = clampPan(panOffset);
  }

  function applyPanTransform(): void {
    artPan.style.transform = `translate(${panOffset.x}px, ${panOffset.y}px)`;
    drawReferenceGrid();
  }

  function syncStageLayout(): void {
    const dpr = window.devicePixelRatio || 1;
    setupCanvas(gridLayerCanvas, viewportW, viewportH, dpr);
    gridLayerCanvas.style.width = `${viewportW}px`;
    gridLayerCanvas.style.height = `${viewportH}px`;
  }

  /** 捏合过程中实时改格宽、平移、参考层（松手不再整页跳变） */
  function applyPinchZoom(pinchFocal: { stageX: number; stageY: number }): void {
    const oldCellSize = cellSize;
    const oldPanX = panOffset.x;
    const oldPanY = panOffset.y;

    cellSize = Math.max(MIN_CELL_PX, Math.round(baseCellSize * cellZoom));
    gridPixelW = gridCols * cellSize;
    gridPixelH = gridRows * cellSize;

    const dpr = window.devicePixelRatio || 1;
    setupCanvas(editCanvas, gridPixelW, gridPixelH, dpr);

    if (oldCellSize > 0) {
      const oldPadX = padCellsX * oldCellSize;
      const oldPadY = padCellsY * oldCellSize;
      recomputePadCells();
      const canvasX = pinchFocal.stageX - oldPanX - oldPadX;
      const canvasY = pinchFocal.stageY - oldPanY - oldPadY;
      const scale = cellSize / oldCellSize;
      panOffset = clampPan({
        x: pinchFocal.stageX - canvasX * scale - padPxX(),
        y: pinchFocal.stageY - canvasY * scale - padPxY(),
      });
    } else {
      recomputePadCells();
    }

    artPan.style.width = `${gridPixelW + 2 * padPxX()}px`;
    artPan.style.height = `${gridPixelH + 2 * padPxY()}px`;
    editCanvas.style.left = `${padPxX()}px`;
    editCanvas.style.top = `${padPxY()}px`;
    syncStageLayout();
    applyPanTransform();
    refreshEditCanvas();
    updateSelectionBox();
    updateEditorDebug();
  }

  function schedulePinchZoom(focal: { stageX: number; stageY: number }): void {
    pendingPinchFocal = focal;
    if (pinchRaf) return;
    pinchRaf = requestAnimationFrame(() => {
      pinchRaf = 0;
      if (pendingPinchFocal) applyPinchZoom(pendingPinchFocal);
      pendingPinchFocal = null;
    });
  }

  function updateZoomModeUi(): void {
    panel.classList.toggle('pixel-editor--zoom-mode', zoomMode);
    const btn = panel.querySelector<HTMLElement>('[data-zoom-mode-toggle]');
    if (btn) {
      btn.textContent = zoomMode ? '缩放：开' : '缩放';
      btn.classList.toggle('pixel-editor__zoom-mode--active', zoomMode);
    }
    editCanvas.style.cursor = zoomMode ? 'grab' : 'crosshair';
    if (!zoomMode) {
      navPointers.clear();
      panDrag = null;
      navPinchDist0 = 0;
    }
  }

  function pointerDist(
    a: { x: number; y: number },
    b: { x: number; y: number }
  ): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** 按预览/绘制分栏可用区域填充 TCG 比例视口 */
  function layoutViewport(): void {
    const bodyW = bodyEl.clientWidth;
    const bodyH = bodyEl.clientHeight;
    if (bodyW < 24 || bodyH < 24) {
      requestAnimationFrame(layoutViewport);
      return;
    }

    const fitInBox = (boxW: number, boxH: number) => {
      let innerW = Math.max(MIN_CELL_PX * 4, boxW - RULER_PX);
      let innerH = Math.max(MIN_CELL_PX * 4, boxH - RULER_PX);
      if (innerW / innerH > INNER_ASPECT_RATIO) {
        innerW = Math.floor(innerH * INNER_ASPECT_RATIO);
      } else {
        innerH = Math.floor(innerW / INNER_ASPECT_RATIO);
      }
      return { innerW, innerH };
    };

    const editBox = fitInBox(editPanel.clientWidth, editPanel.clientHeight);
    const previewBox = fitInBox(previewPanel.clientWidth, previewPanel.clientHeight);
    const toolsBox = fitInBox(toolsPanel.clientWidth, toolsPanel.clientHeight);
    viewportW = Math.max(
      MIN_CELL_PX * 4,
      Math.min(editBox.innerW, previewBox.innerW, toolsBox.innerW)
    );
    viewportH = Math.max(
      MIN_CELL_PX * 4,
      Math.min(editBox.innerH, previewBox.innerH, toolsBox.innerH)
    );

    const fitMin = fitGridToViewport(viewportW, viewportH, MIN_CELL_PX);
    baseCellSize = fitMin.cell;

    const shellW = viewportW + RULER_PX;
    const shellH = viewportH + RULER_PX;

    previewFrame.style.width = `${viewportW}px`;
    previewFrame.style.height = `${viewportH}px`;
    if (previewShell) {
      previewShell.style.width = `${shellW}px`;
      previewShell.style.height = `${shellH}px`;
    }
    if (editFrame) {
      editFrame.style.width = `${shellW}px`;
      editFrame.style.height = `${shellH}px`;
    }

    panel.style.setProperty('--pe-shell-w', `${shellW}px`);
    panel.style.setProperty('--pe-shell-h', `${shellH}px`);
    panel.style.setProperty('--pe-ruler-px', `${RULER_PX}px`);

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

  function layoutGrid(pinchFocal?: { stageX: number; stageY: number }): void {
    const oldCellSize = cellSize;
    const oldPanX = panOffset.x;
    const oldPanY = panOffset.y;

    cellSize = Math.max(MIN_CELL_PX, Math.round(baseCellSize * cellZoom));
    gridPixelW = gridCols * cellSize;
    gridPixelH = gridRows * cellSize;
    recomputePadCells();

    const dpr = window.devicePixelRatio || 1;
    setupCanvas(editCanvas, gridPixelW, gridPixelH, dpr);
    setupCanvas(previewGridArt, viewportW, viewportH, dpr);

    artStage.style.width = `${viewportW}px`;
    artStage.style.height = `${viewportH}px`;
    artPan.style.width = `${gridPixelW + 2 * padPxX()}px`;
    artPan.style.height = `${gridPixelH + 2 * padPxY()}px`;
    editCanvas.style.left = `${padPxX()}px`;
    editCanvas.style.top = `${padPxY()}px`;

    if (pinchFocal && oldCellSize > 0) {
      const oldPadX = padCellsX * oldCellSize;
      const oldPadY = padCellsY * oldCellSize;
      const canvasX = pinchFocal.stageX - oldPanX - oldPadX;
      const canvasY = pinchFocal.stageY - oldPanY - oldPadY;
      const scale = cellSize / oldCellSize;
      panOffset = clampPan({
        x: pinchFocal.stageX - canvasX * scale - padPxX(),
        y: pinchFocal.stageY - canvasY * scale - padPxY(),
      });
    } else {
      snapPanHome();
    }

    syncStageLayout();

    previewInner.style.width = `${viewportW}px`;
    previewInner.style.height = `${viewportH}px`;
    previewInner.style.marginLeft = '0';
    previewInner.style.marginTop = '0';

    buildRulers();
    applyPanTransform();
    refreshAll();
    updateSelectionBox();
    updateEditorDebug();
  }

  /** 网格延伸至舞台边框；金色框标示可绘区 */
  function drawReferenceGrid(): void {
    const ctx = gridLayerCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, viewportW, viewportH);
    if (!showGrid) return;

    const { x: ox, y: oy } = artOriginInStage();
    const cStart = Math.floor((0 - ox) / cellSize);
    const cEnd = Math.ceil((viewportW - ox) / cellSize);
    const rStart = Math.floor((0 - oy) / cellSize);
    const rEnd = Math.ceil((viewportH - oy) / cellSize);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
    ctx.lineWidth = 1.5;

    for (let c = cStart; c <= cEnd; c++) {
      const x = ox + c * cellSize + 0.5;
      if (x < -0.5 || x > viewportW + 0.5) continue;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, viewportH);
      ctx.stroke();
    }

    for (let r = rStart; r <= rEnd; r++) {
      const y = oy + r * cellSize + 0.5;
      if (y < -0.5 || y > viewportH + 0.5) continue;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(viewportW, y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(201, 162, 39, 0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 0.5, oy + 0.5, gridPixelW, gridPixelH);
  }

  /** 标尺固定在框图，0,0 对齐可绘区（不随平移偏移） */
  function buildRulers(): void {
    const step = rulerLabelStep(cellSize);
    const padX = padPxX();
    const padY = padPxY();

    rulerTop.innerHTML = '';
    rulerLeft.innerHTML = '';
    rulerTop.style.paddingLeft = `${padX}px`;
    rulerTop.style.paddingTop = '0';
    rulerLeft.style.paddingTop = `${padY}px`;
    rulerLeft.style.paddingLeft = '0';
    rulerTop.style.width = `${gridPixelW}px`;
    rulerTop.style.minWidth = `${gridPixelW}px`;
    rulerLeft.style.height = `${gridPixelH}px`;
    rulerLeft.style.minHeight = `${gridPixelH}px`;

    for (let c = 0; c < gridCols; c++) {
      const s = document.createElement('span');
      s.className = 'pixel-editor__ruler-tick';
      s.style.width = `${cellSize}px`;
      if (c % step === 0) {
        s.textContent = String(c);
        s.classList.add('pixel-editor__ruler-tick--labeled');
      }
      rulerTop.append(s);
    }

    for (let r = 0; r < gridRows; r++) {
      const s = document.createElement('span');
      s.className = 'pixel-editor__ruler-tick';
      s.style.height = `${cellSize}px`;
      if (r % step === 0) {
        s.textContent = String(r);
        s.classList.add('pixel-editor__ruler-tick--labeled');
      }
      rulerLeft.append(s);
    }
  }

  function refreshEditCanvas(): void {
    const ctx = editCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, gridPixelW, gridPixelH);
    drawGridToCanvas(ctx, grid, gridPixelW, gridPixelH);
  }

  function refreshPreview(): void {
    const sq = previewGridArt.getContext('2d');
    if (sq) {
      sq.clearRect(0, 0, viewportW, viewportH);
      drawGridToCanvas(sq, grid, viewportW, viewportH);
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
    if (e.target === editCanvas && typeof e.offsetX === 'number') {
      const dw = editCanvas.clientWidth || gridPixelW || 1;
      const dh = editCanvas.clientHeight || gridPixelH || 1;
      const canvasX = (e.offsetX / dw) * gridPixelW;
      const canvasY = (e.offsetY / dh) * gridPixelH;
      if (canvasX < 0 || canvasY < 0 || canvasX >= gridPixelW || canvasY >= gridPixelH) {
        return null;
      }
      return {
        x: clamp(Math.floor(canvasX / cellSize), 0, gridCols - 1),
        y: clamp(Math.floor(canvasY / cellSize), 0, gridRows - 1),
      };
    }
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
    selBox.style.left = `${padPxX() + r.x * cellSize}px`;
    selBox.style.top = `${padPxY() + r.y * cellSize}px`;
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
    if (next !== 'move') moveAnchor = null;
    if (next !== 'select') selectStart = null;
    updateEditorDebug();
  }

  function paintAt(x: number, y: number, color: Pixel = paintColor): void {
    const r = Math.floor(brushSize / 2);
    let changed = false;
    for (let dy = -r; dy <= brushSize - 1 - r; dy++) {
      for (let dx = -r; dx <= brushSize - 1 - r; dx++) {
        const cx = x + dx;
        const cy = y + dy;
        if (cx < 0 || cy < 0 || cx >= gridCols || cy >= gridRows) continue;
        if (lastPaintCell?.x === cx && lastPaintCell?.y === cy && brushSize === 1) {
          continue;
        }
        grid[cy][cx] = color;
        changed = true;
      }
    }
    if (!changed && brushSize === 1) {
      if (lastPaintCell?.x === x && lastPaintCell?.y === y) return;
      grid[y][x] = color;
    }
    lastPaintCell = { x, y };
    refreshAll();
  }

  function sampleColor(x: number, y: number): void {
    const c = grid[y][x];
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
    selection = { ...rect, pixels: copyRegion(grid, rect as Selection) };
    updateSelectionBox(rect);
    selectStart = null;
  }

  function commitMove(targetX: number, targetY: number): void {
    if (!selection) return;
    const tx = clamp(targetX, 0, gridCols - selection.w);
    const ty = clamp(targetY, 0, gridRows - selection.h);
    clearRegion(grid, selection);
    pasteRegion(grid, gridCols, gridRows, tx, ty, selection.pixels);
    selection = {
      x: tx,
      y: ty,
      w: selection.w,
      h: selection.h,
      pixels: copyRegion(grid, {
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

  for (const el of [overlay, panel, artStage, editCanvas]) {
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
      if (pointerDrawing || zoomMode) e.preventDefault();
    },
    { passive: false }
  );

  artStage.addEventListener(
    'pointerdown',
    (e) => {
      if (!zoomMode) return;
      if (e.target !== artStage && e.target !== gridLayerCanvas) return;
      e.preventDefault();
      navPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        artStage.setPointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      if (navPointers.size === 2) {
        const pts = [...navPointers.values()];
        navPinchDist0 = pointerDist(pts[0], pts[1]);
        navPinchZoom0 = cellZoom;
        panDrag = null;
      } else if (navPointers.size === 1) {
        panDrag = {
          px: e.clientX,
          py: e.clientY,
          ox: panOffset.x,
          oy: panOffset.y,
        };
      }
    },
    { passive: false }
  );

  artStage.addEventListener(
    'pointermove',
    (e) => {
      if (!zoomMode || !navPointers.has(e.pointerId)) return;
      navPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      e.preventDefault();
      if (navPointers.size >= 2) {
        const pts = [...navPointers.values()];
        const d = pointerDist(pts[0], pts[1]);
        if (navPinchDist0 > 8) {
          cellZoom = clamp(
            navPinchZoom0 * (d / navPinchDist0),
            ZOOM_MIN,
            ZOOM_MAX
          );
          const stageRect = artStage.getBoundingClientRect();
          schedulePinchZoom({
            stageX: (pts[0].x + pts[1].x) / 2 - stageRect.left,
            stageY: (pts[0].y + pts[1].y) / 2 - stageRect.top,
          });
        }
      } else if (navPointers.size === 1 && panDrag) {
        panOffset = clampPan({
          x: panDrag.ox + (e.clientX - panDrag.px),
          y: panDrag.oy + (e.clientY - panDrag.py),
        });
        applyPanTransform();
      }
    },
    { passive: false }
  );

  const endNavPointer = (e: PointerEvent) => {
    const wasPinching = navPinchDist0 > 8;
    navPointers.delete(e.pointerId);
    if (navPointers.size < 2) {
      if (wasPinching) {
        if (pinchRaf) {
          cancelAnimationFrame(pinchRaf);
          pinchRaf = 0;
        }
        if (pendingPinchFocal) {
          applyPinchZoom(pendingPinchFocal);
          pendingPinchFocal = null;
        }
        refreshPreview();
      }
      navPinchDist0 = 0;
    }
    if (navPointers.size === 0) panDrag = null;
    try {
      artStage.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };
  artStage.addEventListener('pointerup', endNavPointer);
  artStage.addEventListener('pointercancel', endNavPointer);

  editCanvas.addEventListener('pointerdown', (e) => {
    if (zoomMode) return;
    e.preventDefault();
    const cell = cellFromEvent(e);
    if (!cell) return;
    pointerDrawing = true;
    editCanvas.setPointerCapture(e.pointerId);
    const { x, y } = cell;
    if (tool === 'paint') {
      lastPaintCell = null;
      paintAt(x, y);
      return;
    }
    if (tool === 'fill') {
      floodFill(grid, gridCols, gridRows, x, y, paintColor);
      refreshAll();
      return;
    }
    if (tool === 'eraser') {
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
    if (tool === 'move' && selection) {
      const inside =
        x >= selection.x &&
        x < selection.x + selection.w &&
        y >= selection.y &&
        y < selection.y + selection.h;
      if (inside) {
        moveAnchor = { x, y };
        moveOffset = { x: x - selection.x, y: y - selection.y };
      } else {
        commitMove(x - moveOffset.x, y - moveOffset.y);
      }
    }
  });

  editCanvas.addEventListener('pointermove', (e) => {
    if (zoomMode || !editCanvas.hasPointerCapture(e.pointerId)) return;
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
      updateSelectionBox({
        x: clamp(x - moveOffset.x, 0, gridCols - selection.w),
        y: clamp(y - moveOffset.y, 0, gridRows - selection.h),
        w: selection.w,
        h: selection.h,
      });
    }
  });

  editCanvas.addEventListener('pointerup', (e) => {
    const cell = cellFromEvent(e);
    if (!cell) {
      lastPaintCell = null;
      pointerDrawing = false;
      try {
        editCanvas.releasePointerCapture(e.pointerId);
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
    }
    lastPaintCell = null;
    pointerDrawing = false;
    try {
      editCanvas.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  });

  editCanvas.addEventListener('pointercancel', (e) => {
    lastPaintCell = null;
    pointerDrawing = false;
    try {
      editCanvas.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  });

  panel.querySelectorAll('[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => setTool((btn as HTMLElement).dataset.tool as Tool));
  });

  panel.querySelector('[data-zoom-mode-toggle]')?.addEventListener('click', () => {
    zoomMode = !zoomMode;
    updateZoomModeUi();
    updateEditorDebug();
  });

  const brushRange = panel.querySelector<HTMLInputElement>('[data-brush-size]')!;
  const brushLabel = panel.querySelector('[data-brush-size-label]')!;
  brushRange.addEventListener('input', () => {
    brushSize = clamp(Number(brushRange.value) || 1, 1, 8);
    brushLabel.textContent = String(brushSize);
    updateEditorDebug();
  });

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
        grid = sampleImageToGrid(img, gridCols, gridRows);
        selection = null;
        selectStart = null;
        refreshAll();
      } catch (err) {
        const msg = err instanceof Error ? err.message : '导入失败';
        window.alert(msg);
      }
    })();
  });

  panel.querySelector('[data-clear]')?.addEventListener('click', () => {
    grid = normalizeGrid([], gridCols, gridRows);
    selection = null;
    refreshAll();
  });

  panel.querySelector('[data-apply]')?.addEventListener('click', () => {
    setCustomArtGrid(currentKey, grid);
    onApplied();
  });

  panel.querySelector('[data-export]')?.addEventListener('click', () => {
    const code = gridToExportCode(currentKey, grid);
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

  const onEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (debugOpen) {
      closeDebug();
      return;
    }
    closePixelEditor();
  };
  document.addEventListener('keydown', onEscape);

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
    document.removeEventListener('keydown', onEscape);
    if (pinchRaf) cancelAnimationFrame(pinchRaf);
    pinchRaf = 0;
    pendingPinchFocal = null;
    navPointers.clear();
    panDrag = null;
  };
  getModalOverlayMount().append(overlay);
  updateDebugUi();
  updateZoomModeUi();
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
