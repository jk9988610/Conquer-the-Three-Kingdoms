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
  const ZOOM_MAX = 16;
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
  let lastCellZoom = ZOOM_MIN;

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

  function artOriginInWorkspace(): { x: number; y: number } {
    return { x: RULER_PX + panOffset.x, y: RULER_PX + panOffset.y };
  }

  function clampPan(o: { x: number; y: number }): { x: number; y: number } {
    const maxX = Math.max(0, gridPixelW - viewportW);
    const maxY = Math.max(0, gridPixelH - viewportH);
    return {
      x: clamp(o.x, 0, maxX),
      y: clamp(o.y, 0, maxY),
    };
  }

  /** 缩小或网格小于视口时居中归位 */
  function snapPanHome(prevZoom?: number): void {
    const zoomedOut = prevZoom !== undefined && cellZoom < prevZoom - 0.001;
    const fits =
      gridPixelW <= viewportW + 1 && gridPixelH <= viewportH + 1;
    if (zoomedOut || fits) {
      panOffset = {
        x: Math.max(0, Math.floor((viewportW - gridPixelW) / 2)),
        y: Math.max(0, Math.floor((viewportH - gridPixelH) / 2)),
      };
    } else {
      panOffset = clampPan(panOffset);
    }
  }

  function applyPanTransform(): void {
    artPan.style.transform = `translate(${panOffset.x}px, ${panOffset.y}px)`;
    drawReferenceGrid();
    buildRulers();
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

  /** 缩放只改格宽；行列固定；参考网格在独立层无限延伸 */
  function layoutGrid(prevZoom?: number): void {
    const prev = prevZoom ?? lastCellZoom;
    cellSize = Math.max(MIN_CELL_PX, Math.round(baseCellSize * cellZoom));
    gridPixelW = gridCols * cellSize;
    gridPixelH = gridRows * cellSize;

    const dpr = window.devicePixelRatio || 1;
    setupCanvas(editCanvas, gridPixelW, gridPixelH, dpr);
    setupCanvas(previewGridArt, viewportW, viewportH, dpr);

    artStage.style.width = `${viewportW}px`;
    artStage.style.height = `${viewportH}px`;

    snapPanHome(prev);
    lastCellZoom = cellZoom;

    const extend = 520;
    gridScrollW = RULER_PX + Math.max(viewportW, gridPixelW) + extend;
    gridScrollH = RULER_PX + Math.max(viewportH, gridPixelH) + extend;
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

    const { x: ox, y: oy } = artOriginInWorkspace();
    const step = rulerLabelStep(cellSize);

    const cStart = Math.floor(-ox / cellSize) - 1;
    const cEnd = Math.ceil((gridScrollW - ox) / cellSize) + 1;
    for (let c = cStart; c <= cEnd; c++) {
      const x = ox + c * cellSize + 0.5;
      const major = c % step === 0;
      ctx.strokeStyle = major
        ? 'rgba(255,255,255,0.42)'
        : 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, gridScrollH);
      ctx.stroke();
    }

    const rStart = Math.floor(-oy / cellSize) - 1;
    const rEnd = Math.ceil((gridScrollH - oy) / cellSize) + 1;
    for (let r = rStart; r <= rEnd; r++) {
      const y = oy + r * cellSize + 0.5;
      const major = r % step === 0;
      ctx.strokeStyle = major
        ? 'rgba(255,255,255,0.42)'
        : 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(gridScrollW, y);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(201, 162, 39, 0.75)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 0.5, oy + 0.5, gridPixelW, gridPixelH);
  }

  function buildRulers(): void {
    const step = rulerLabelStep(cellSize);
    const { x: ox, y: oy } = artOriginInWorkspace();

    rulerTop.innerHTML = '';
    rulerLeft.innerHTML = '';
    rulerTop.style.width = `${gridScrollW - RULER_PX}px`;
    rulerLeft.style.height = `${gridScrollH - RULER_PX}px`;

    const cStart = Math.floor(-ox / cellSize);
    const cCount = Math.ceil((gridScrollW - RULER_PX) / cellSize) + 2;
    for (let i = 0; i < cCount; i++) {
      const c = cStart + i;
      const s = document.createElement('span');
      s.className = 'pixel-editor__ruler-tick';
      s.style.width = `${cellSize}px`;
      if (c % step === 0) {
        s.textContent = String(c);
        s.classList.add('pixel-editor__ruler-tick--major');
      }
      rulerTop.append(s);
    }

    const rStart = Math.floor(-oy / cellSize);
    const rCount = Math.ceil((gridScrollH - RULER_PX) / cellSize) + 2;
    for (let i = 0; i < rCount; i++) {
      const r = rStart + i;
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

  function cellFromEvent(e: PointerEvent): { x: number; y: number } {
    const r = editCanvas.getBoundingClientRect();
    const x = clamp(
      Math.floor(((e.clientX - r.left) / r.width) * gridCols),
      0,
      gridCols - 1
    );
    const y = clamp(
      Math.floor(((e.clientY - r.top) / r.height) * gridRows),
      0,
      gridRows - 1
    );
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
          const prev = cellZoom;
          cellZoom = clamp(
            navPinchZoom0 * (d / navPinchDist0),
            ZOOM_MIN,
            ZOOM_MAX
          );
          layoutGrid(prev);
        }
      } else if (navPointers.size === 1 && panDrag) {
        panOffset = {
          x: panDrag.ox + (e.clientX - panDrag.px),
          y: panDrag.oy + (e.clientY - panDrag.py),
        };
        applyPanTransform();
      }
    },
    { passive: false }
  );

  const endNavPointer = (e: PointerEvent) => {
    navPointers.delete(e.pointerId);
    if (navPointers.size < 2) navPinchDist0 = 0;
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
