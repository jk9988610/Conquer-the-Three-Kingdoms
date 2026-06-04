import {
  drawGridToCanvas,
  getArtGrid,
  gridToExportCode,
  setCustomArtGrid,
  type Pixel,
  type PixelGrid,
  PIXEL_ART_KEYS,
} from '../art/pixelArt';
import { INNER_ASPECT_RATIO } from '../tcg/dimensions';
import type { PixelArtKey } from '../game/types';
import { createColorPicker, type ColorPickerValue } from './colorPicker';
import { getModalOverlayMount } from './overlayRoot';

const RULER_PX = 18;
const MIN_CELL_PX = 3;
/** 画布四周参考格线外延格数（最小缩放下亦同） */
const GRID_PAD_CELLS = 4;
const HEIGHT_SCALE = 1.3;

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

function resampleGrid(
  g: PixelGrid,
  oldCols: number,
  oldRows: number,
  newCols: number,
  newRows: number
): PixelGrid {
  if (oldCols === newCols && oldRows === newRows) return normalizeGrid(g, newCols, newRows);
  const out: PixelGrid = [];
  for (let y = 0; y < newRows; y++) {
    const row: Pixel[] = [];
    for (let x = 0; x < newCols; x++) {
      const sx = Math.min(oldCols - 1, Math.floor((x / newCols) * oldCols));
      const sy = Math.min(oldRows - 1, Math.floor((y / newRows) * oldRows));
      row.push(g[sy]?.[sx] ?? null);
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

function floodFill(
  grid: PixelGrid,
  cols: number,
  rows: number,
  x: number,
  y: number,
  fill: Pixel
): void {
  const target = grid[y]?.[x] ?? null;
  if (target === fill) return;

  const stack: [number, number][] = [[x, y]];
  const seen = new Set<string>();

  while (stack.length > 0) {
    const [cx, cy] = stack.pop()!;
    const key = `${cx},${cy}`;
    if (seen.has(key)) continue;
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
    if ((grid[cy][cx] ?? null) !== target) continue;
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
  let grid = normalizeGrid(getArtGrid(currentKey), gridCols, gridRows);
  let paintColor: Pixel = 'rgba(255,255,255,1)';
  let tool: Tool = 'paint';
  let showGrid = true;
  let selection: Selection | null = null;
  let selectStart: { x: number; y: number } | null = null;
  let moveAnchor: { x: number; y: number } | null = null;
  let moveOffset = { x: 0, y: 0 };
  let lastPaintCell: { x: number; y: number } | null = null;
  let pointerDrawing = false;
  /** 预览/编辑外框相对弹窗的放大系数 */
  const VIEW_AREA_SCALE = 2;
  const ZOOM_MIN = 4;
  const ZOOM_MAX = 8;
  const TOOLS_COL_W = 168;
  const DEBUG_COL_W = 132;
  const COL_GAP = 12;
  const COL_HEAD_H = 24;

  let cellZoom = ZOOM_MIN;
  /** 缩放模式：单指平移画布，双指捏合缩放网格 */
  let zoomMode = false;
  let panOffset = { x: 0, y: 0 };
  let panDrag: { px: number; py: number; ox: number; oy: number } | null = null;
  const navPointers = new Map<number, { x: number; y: number }>();
  let navPinchDist0 = 0;
  let navPinchZoom0 = 1;
  let brushSize = 1;
  let baseCellSize = 4;
  let cellSize = 4;
  let gridPixelW = gridCols * cellSize;
  let gridPixelH = gridRows * cellSize;
  let viewportW = 200;
  let viewportH = 274;
  let contentH = 274;
  let gridScrollW = 800;
  let gridScrollH = 1000;
  let lockedViewportW = 0;
  let lockedViewportH = 0;

  const overlay = document.createElement('div');
  overlay.className = 'pixel-editor-overlay';
  overlay.dataset.modal = 'pixel-editor';

  const panel = document.createElement('div');
  panel.className = 'pixel-editor';
  panel.innerHTML = `
    <header class="pixel-editor__head">
      <h2>像素画绘制</h2>
      <button type="button" class="pixel-editor__close">×</button>
    </header>
    <div class="pixel-editor__body" data-body>
      <div class="pixel-editor__col pixel-editor__col--preview" data-col-preview>
        <div class="pixel-editor__col-head">预览</div>
        <div class="pixel-editor__col-panel" data-preview-panel>
          <div class="pixel-editor__grid-frame" data-preview-frame>
            <div class="pixel-editor__grid-inner" data-preview-inner>
              <canvas data-preview-grid-art></canvas>
            </div>
          </div>
        </div>
      </div>
      <div class="pixel-editor__col pixel-editor__col--edit" data-col-edit>
        <div class="pixel-editor__col-head">绘制</div>
        <div class="pixel-editor__col-panel" data-edit-panel>
          <div class="pixel-editor__edit-scroll" data-edit-scroll>
          <div class="pixel-editor__edit-scroll-inner" data-edit-scroll-inner>
          <div class="pixel-editor__workspace" data-workspace>
            <div class="pixel-editor__ruler-corner" data-ruler-corner></div>
            <div class="pixel-editor__ruler-top" data-ruler-top></div>
            <div class="pixel-editor__ruler-left" data-ruler-left></div>
            <canvas class="pixel-editor__grid-layer" data-grid-layer></canvas>
            <div class="pixel-editor__art-stage" data-art-stage>
              <div class="pixel-editor__art-pan" data-art-pan>
                <canvas data-edit-canvas></canvas>
                <div class="pixel-editor__sel-box" data-sel-box hidden></div>
              </div>
            </div>
          </div>
          </div>
          </div>
        </div>
      </div>
      <div class="pixel-editor__col pixel-editor__col--side" data-col-side>
        <div class="pixel-editor__col-head">工具</div>
        <div class="pixel-editor__side-panel" data-side-panel>
        <div class="pixel-editor__tools-panel">
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
          <div class="pixel-editor__tools-actions">
            <button type="button" class="btn" data-toggle-grid>网格：开</button>
            <button type="button" class="btn" data-clear>清空</button>
            <button type="button" class="btn" data-apply>应用</button>
            <button type="button" class="btn" data-export>导出</button>
          </div>
        </div>
        <div class="pixel-editor__editor-debug">
          <div class="pixel-editor__editor-debug-title">调试</div>
          <pre class="pixel-editor__editor-debug-body" data-pixel-debug></pre>
        </div>
        </div>
      </div>
    </div>
  `;

  const select = panel.querySelector<HTMLSelectElement>('[data-select]')!;
  const bodyEl = panel.querySelector<HTMLElement>('[data-body]')!;
  const colPreview = panel.querySelector<HTMLElement>('[data-col-preview]')!;
  const colEdit = panel.querySelector<HTMLElement>('[data-col-edit]')!;
  const colSide = panel.querySelector<HTMLElement>('[data-col-side]')!;
  const sidePanel = panel.querySelector<HTMLElement>('[data-side-panel]')!;
  const previewPanel = panel.querySelector<HTMLElement>('[data-preview-panel]')!;
  const editPanel = panel.querySelector<HTMLElement>('[data-edit-panel]')!;
  const editScroll = panel.querySelector<HTMLElement>('[data-edit-scroll]')!;
  const editScrollInner = panel.querySelector<HTMLElement>('[data-edit-scroll-inner]')!;
  const previewFrame = panel.querySelector<HTMLElement>('[data-preview-frame]')!;
  const previewInner = panel.querySelector<HTMLElement>('[data-preview-inner]')!;
  const debugEl = panel.querySelector<HTMLElement>('[data-pixel-debug]')!;
  const workspace = panel.querySelector<HTMLElement>('[data-workspace]')!;
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

  const canvasPadPx = () => GRID_PAD_CELLS * cellSize;

  /** 可绘像素区左上角在工作区坐标（含外延 padding） */
  function artCanvasOriginInWorkspace(): { x: number; y: number } {
    const pad = canvasPadPx();
    return { x: RULER_PX + pad + panOffset.x, y: RULER_PX + pad + panOffset.y };
  }

  function panContentSize(): { w: number; h: number } {
    const pad = canvasPadPx();
    return { w: gridPixelW + 2 * pad, h: gridPixelH + 2 * pad };
  }

  /** 平移范围：含画布外延；最小缩放下额外留白便于画到边缘格 */
  function panBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    const pad = canvasPadPx();
    const { w: panW, h: panH } = panContentSize();
    const slack = pad;
    return {
      minX: Math.min(0, viewportW - panW) - slack,
      maxX: Math.max(0, viewportW - panW) + slack,
      minY: Math.min(0, viewportH - panH) - slack,
      maxY: Math.max(0, viewportH - panH) + slack,
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
    buildRulers();
  }

  /** 捏合过程中只改格宽与平移，不触发 snapPanHome / 整页重排 */
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
      const oldPad = GRID_PAD_CELLS * oldCellSize;
      const newPad = canvasPadPx();
      const canvasX = pinchFocal.stageX - oldPanX - oldPad;
      const canvasY = pinchFocal.stageY - oldPanY - oldPad;
      const scale = cellSize / oldCellSize;
      panOffset = clampPan({
        x: pinchFocal.stageX - canvasX * scale - newPad,
        y: pinchFocal.stageY - canvasY * scale - newPad,
      });
    }

    const pad = canvasPadPx();
    const contentW = gridPixelW + 2 * pad;
    const contentH = gridPixelH + 2 * pad;
    artPan.style.width = `${contentW}px`;
    artPan.style.height = `${contentH}px`;
    applyPanTransform();
    refreshEditCanvas();
    updateSelectionBox();
    updateEditorDebug();
  }

  function ensureArtGridDims(): void {
    if (lockedViewportW === viewportW && lockedViewportH === viewportH) {
      return;
    }
    const fit = fitGridToViewport(viewportW, viewportH, baseCellSize * ZOOM_MIN);
    if (lockedViewportW > 0 && lockedViewportH > 0) {
      grid = resampleGrid(grid, gridCols, gridRows, fit.cols, fit.rows);
    }
    gridCols = fit.cols;
    gridRows = fit.rows;
    lockedViewportW = viewportW;
    lockedViewportH = viewportH;
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

  /** 固定 TCG 内框比例视口；高度 ×1.3 */
  function layoutViewport(): void {
    const bodyW = bodyEl.clientWidth || panel.clientWidth;
    const bodyH =
      bodyEl.clientHeight || Math.min(window.innerHeight * 0.55, 400);
    const sideW = TOOLS_COL_W + DEBUG_COL_W + COL_GAP;
    const colCount = 2;
    const areaMul = VIEW_AREA_SCALE / 2;
    const drawColW = Math.max(
      120,
      Math.floor(
        ((bodyW - sideW - COL_GAP * (colCount + 1)) / colCount) * areaMul
      )
    );

    contentH = Math.max(
      140,
      Math.floor(
        (bodyH - COL_HEAD_H * 2 - 16) * areaMul * HEIGHT_SCALE
      )
    );
    viewportH = contentH;
    viewportW = Math.max(
      MIN_CELL_PX * 4,
      Math.round(viewportH * INNER_ASPECT_RATIO)
    );
    if (viewportW > drawColW - 8) {
      viewportW = drawColW - 8;
      viewportH = Math.max(
        MIN_CELL_PX * 4,
        Math.round(viewportW / INNER_ASPECT_RATIO)
      );
      contentH = viewportH;
    }

    const fitMin = fitGridToViewport(viewportW, viewportH, MIN_CELL_PX);
    baseCellSize = fitMin.cell;

    const colPad = 20;
    colPreview.style.flex = `0 0 ${viewportW + colPad}px`;
    colEdit.style.flex = `0 0 ${viewportW + RULER_PX + colPad}px`;
    colSide.style.flex = `0 0 ${sideW}px`;

    previewPanel.style.height = `${contentH}px`;
    editPanel.style.height = `${contentH}px`;
    sidePanel.style.height = `${contentH}px`;

    previewFrame.style.width = `${viewportW}px`;
    previewFrame.style.height = `${viewportH}px`;
    editScroll.style.width = `${viewportW + RULER_PX}px`;
    editScroll.style.height = `${viewportH + RULER_PX}px`;

    ensureArtGridDims();
    layoutGrid();
  }

  /** 缩放只改格宽；行列固定；参考格线仅画布外 GRID_PAD_CELLS 格 */
  function layoutGrid(pinchFocal?: { stageX: number; stageY: number }): void {
    const oldCellSize = cellSize;
    const oldPanX = panOffset.x;
    const oldPanY = panOffset.y;

    cellSize = Math.max(MIN_CELL_PX, Math.round(baseCellSize * cellZoom));
    gridPixelW = gridCols * cellSize;
    gridPixelH = gridRows * cellSize;
    const pad = canvasPadPx();
    const contentW = gridPixelW + 2 * pad;
    const contentH = gridPixelH + 2 * pad;

    const dpr = window.devicePixelRatio || 1;
    setupCanvas(editCanvas, gridPixelW, gridPixelH, dpr);
    setupCanvas(previewGridArt, viewportW, viewportH, dpr);

    artStage.style.width = `${viewportW}px`;
    artStage.style.height = `${viewportH}px`;
    artPan.style.width = `${contentW}px`;
    artPan.style.height = `${contentH}px`;
    editCanvas.style.left = `${pad}px`;
    editCanvas.style.top = `${pad}px`;

    if (pinchFocal && oldCellSize > 0) {
      const oldPad = GRID_PAD_CELLS * oldCellSize;
      const canvasX = pinchFocal.stageX - oldPanX - oldPad;
      const canvasY = pinchFocal.stageY - oldPanY - oldPad;
      const scale = cellSize / oldCellSize;
      panOffset = clampPan({
        x: pinchFocal.stageX - canvasX * scale - pad,
        y: pinchFocal.stageY - canvasY * scale - pad,
      });
    } else {
      snapPanHome();
    }

    gridScrollW = RULER_PX + Math.max(viewportW, contentW);
    gridScrollH = RULER_PX + Math.max(viewportH, contentH);
    setupCanvas(gridLayerCanvas, gridScrollW, gridScrollH, dpr);

    workspace.style.width = `${gridScrollW}px`;
    workspace.style.height = `${gridScrollH}px`;
    workspace.style.gridTemplateColumns = `${RULER_PX}px 1fr`;
    workspace.style.gridTemplateRows = `${RULER_PX}px 1fr`;

    gridLayerCanvas.style.gridColumn = '1 / -1';
    gridLayerCanvas.style.gridRow = '1 / -1';
    artStage.style.gridColumn = '2';
    artStage.style.gridRow = '2';

    editScrollInner.style.minWidth = `${gridScrollW}px`;
    editScrollInner.style.minHeight = `${gridScrollH}px`;

    previewInner.style.width = `${viewportW}px`;
    previewInner.style.height = `${viewportH}px`;
    previewInner.style.marginLeft = '0';
    previewInner.style.marginTop = '0';

    applyPanTransform();
    refreshAll();
    updateSelectionBox();
    updateEditorDebug();
  }

  function drawReferenceGrid(): void {
    const ctx = gridLayerCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, gridScrollW, gridScrollH);
    if (!showGrid) return;

    const { x: ox, y: oy } = artCanvasOriginInWorkspace();
    const step = rulerLabelStep(cellSize);
    const cMin = -GRID_PAD_CELLS;
    const cMax = gridCols + GRID_PAD_CELLS - 1;
    const rMin = -GRID_PAD_CELLS;
    const rMax = gridRows + GRID_PAD_CELLS - 1;
    const x0 = ox + cMin * cellSize;
    const x1 = ox + (cMax + 1) * cellSize;
    const y0 = oy + rMin * cellSize;
    const y1 = oy + (rMax + 1) * cellSize;

    for (let c = cMin; c <= cMax; c++) {
      const x = ox + c * cellSize + 0.5;
      const major = c % step === 0;
      ctx.strokeStyle = major
        ? 'rgba(255,255,255,0.42)'
        : 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
      ctx.stroke();
    }

    for (let r = rMin; r <= rMax; r++) {
      const y = oy + r * cellSize + 0.5;
      const major = r % step === 0;
      ctx.strokeStyle = major
        ? 'rgba(255,255,255,0.42)'
        : 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(201, 162, 39, 0.75)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 0.5, oy + 0.5, gridPixelW, gridPixelH);
  }

  function buildRulers(): void {
    const step = rulerLabelStep(cellSize);
    const pad = canvasPadPx();
    const tickCols = gridCols + 2 * GRID_PAD_CELLS;
    const tickRows = gridRows + 2 * GRID_PAD_CELLS;

    rulerTop.innerHTML = '';
    rulerLeft.innerHTML = '';
    rulerTop.style.width = `${tickCols * cellSize}px`;
    rulerLeft.style.height = `${tickRows * cellSize}px`;
    rulerTop.style.paddingLeft = `${pad + panOffset.x}px`;
    rulerLeft.style.paddingTop = `${pad + panOffset.y}px`;

    for (let i = 0; i < tickCols; i++) {
      const c = i - GRID_PAD_CELLS;
      const s = document.createElement('span');
      s.className = 'pixel-editor__ruler-tick';
      s.style.width = `${cellSize}px`;
      if (c % step === 0) {
        s.textContent = String(c);
        s.classList.add('pixel-editor__ruler-tick--major');
      }
      rulerTop.append(s);
    }

    for (let i = 0; i < tickRows; i++) {
      const r = i - GRID_PAD_CELLS;
      const s = document.createElement('span');
      s.className = 'pixel-editor__ruler-tick';
      s.style.height = `${cellSize}px`;
      if (r % step === 0) {
        s.textContent = String(r);
        s.classList.add('pixel-editor__ruler-tick--major');
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

  /** 指针 → 格子：优先 offsetX/Y（避免裁剪后 getBoundingClientRect 偏大） */
  function cellFromEvent(e: PointerEvent): { x: number; y: number } {
    let canvasX: number;
    let canvasY: number;
    if (e.target === editCanvas) {
      const dw = editCanvas.clientWidth || gridPixelW || 1;
      const dh = editCanvas.clientHeight || gridPixelH || 1;
      canvasX = (e.offsetX / dw) * gridPixelW;
      canvasY = (e.offsetY / dh) * gridPixelH;
    } else {
      const rect = editCanvas.getBoundingClientRect();
      const dw = rect.width > 0 ? rect.width : gridPixelW;
      const dh = rect.height > 0 ? rect.height : gridPixelH;
      canvasX = ((e.clientX - rect.left) / dw) * gridPixelW;
      canvasY = ((e.clientY - rect.top) / dh) * gridPixelH;
    }
    const x = clamp(Math.floor(canvasX / cellSize), 0, gridCols - 1);
    const y = clamp(Math.floor(canvasY / cellSize), 0, gridRows - 1);
    return { x, y };
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
    const pad = canvasPadPx();
    selBox.hidden = false;
    selBox.style.left = `${pad + r.x * cellSize}px`;
    selBox.style.top = `${pad + r.y * cellSize}px`;
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

  for (const el of [overlay, panel, editScroll, editCanvas]) {
    el.addEventListener('contextmenu', blockBrowserGesture);
  }

  panel.addEventListener(
    'touchmove',
    (e) => {
      if (pointerDrawing || zoomMode) e.preventDefault();
    },
    { passive: false }
  );

  editScroll.addEventListener(
    'pointerdown',
    (e) => {
      if (!zoomMode) return;
      e.preventDefault();
      navPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        editScroll.setPointerCapture(e.pointerId);
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

  editScroll.addEventListener(
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
          applyPinchZoom({
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
        layoutGrid();
      }
      navPinchDist0 = 0;
    }
    if (navPointers.size === 0) panDrag = null;
    try {
      editScroll.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  };
  editScroll.addEventListener('pointerup', endNavPointer);
  editScroll.addEventListener('pointercancel', endNavPointer);

  editCanvas.addEventListener('pointerdown', (e) => {
    if (zoomMode) return;
    e.preventDefault();
    pointerDrawing = true;
    editCanvas.setPointerCapture(e.pointerId);
    const { x, y } = cellFromEvent(e);
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
    const { x, y } = cellFromEvent(e);
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
    const { x, y } = cellFromEvent(e);
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
    grid = normalizeGrid(getArtGrid(currentKey), gridCols, gridRows);
    selection = null;
    selectStart = null;
    refreshAll();
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

  const requestClose = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    closePixelEditor();
  };
  const closeBtn = panel.querySelector('.pixel-editor__close');
  closeBtn?.addEventListener('click', requestClose);
  closeBtn?.addEventListener('pointerup', requestClose);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePixelEditor();
  });

  const onEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closePixelEditor();
  };
  document.addEventListener('keydown', onEscape);

  const ro = new ResizeObserver(() => layoutViewport());
  ro.observe(bodyEl);
  ro.observe(panel);

  overlay.append(panel);
  editorOverlay = overlay;
  editorTeardown = () => {
    ro.disconnect();
    document.removeEventListener('keydown', onEscape);
    navPointers.clear();
    panDrag = null;
  };
  getModalOverlayMount().append(overlay);
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
