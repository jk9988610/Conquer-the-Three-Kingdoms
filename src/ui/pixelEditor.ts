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
import { getOverlayMount } from './overlayRoot';

const GRID_COLS = 16;
/** 与卡面内框同比例，格线为正方形 */
const GRID_ROWS = Math.max(1, Math.round(GRID_COLS / INNER_ASPECT_RATIO));
const RULER_PX = 18;

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

type Tool = 'paint' | 'select' | 'move';

interface Selection {
  x: number;
  y: number;
  w: number;
  h: number;
  pixels: Pixel[][];
}

function normalizeGrid(g: PixelGrid): PixelGrid {
  const rows: PixelGrid = [];
  for (let y = 0; y < GRID_ROWS; y++) {
    const src = g[y] ?? [];
    const row: Pixel[] = [];
    for (let x = 0; x < GRID_COLS; x++) {
      row.push(src[x] ?? null);
    }
    rows.push(row);
  }
  return rows;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normalizeRect(x0: number, y0: number, x1: number, y1: number) {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return { x, y, w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 };
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
  atX: number,
  atY: number,
  pixels: Pixel[][]
): void {
  for (let dy = 0; dy < pixels.length; dy++) {
    for (let dx = 0; dx < pixels[dy].length; dx++) {
      const yy = atY + dy;
      const xx = atX + dx;
      if (yy < 0 || yy >= GRID_ROWS || xx < 0 || xx >= GRID_COLS) continue;
      grid[yy][xx] = pixels[dy][dx];
    }
  }
}

export function openPixelEditor(onApplied: () => void): void {
  closePixelEditor();

  let currentKey: PixelArtKey = 'heal-potion';
  let grid = normalizeGrid(getArtGrid(currentKey));
  let paintColor: Pixel = 'rgba(255,255,255,1)';
  let tool: Tool = 'paint';
  let showGrid = true;
  let selection: Selection | null = null;
  let selectStart: { x: number; y: number } | null = null;
  let moveAnchor: { x: number; y: number } | null = null;
  let moveOffset = { x: 0, y: 0 };
  let lastPaintCell: { x: number; y: number } | null = null;
  let pointerDrawing = false;
  let cellSize = 14;
  let gridPixelW = GRID_COLS * cellSize;
  let gridPixelH = GRID_ROWS * cellSize;

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
    <div class="pixel-editor__toolbar">
      <label>卡牌 <select data-select></select></label>
      <button type="button" class="btn pixel-editor__tool pixel-editor__tool--active" data-tool="paint">画笔</button>
      <button type="button" class="btn pixel-editor__tool" data-tool="select">框选</button>
      <button type="button" class="btn pixel-editor__tool" data-tool="move">移动</button>
      <button type="button" class="btn" data-toggle-grid>网格：开</button>
      <button type="button" class="btn" data-clear>清空</button>
      <button type="button" class="btn" data-apply>应用</button>
      <button type="button" class="btn" data-export>导出</button>
    </div>
    <div class="pixel-editor__color-row">
      <div data-color-picker></div>
      <div class="pixel-editor__presets" data-presets></div>
    </div>
    <div class="pixel-editor__body" data-body>
      <div class="pixel-editor__col pixel-editor__col--preview" data-col-preview>
        <div class="pixel-editor__col-head">预览</div>
        <div class="pixel-editor__preview-workspace" data-preview-workspace>
          <div class="pixel-editor__ruler-spacer" data-ruler-spacer></div>
          <div class="pixel-editor__grid-frame" data-preview-frame>
            <canvas data-preview-grid-art></canvas>
            <canvas data-preview-grid></canvas>
          </div>
        </div>
      </div>
      <div class="pixel-editor__col pixel-editor__col--edit" data-col-edit>
        <div class="pixel-editor__col-head">绘制</div>
        <div class="pixel-editor__workspace" data-workspace>
          <div class="pixel-editor__ruler-corner" data-ruler-corner></div>
          <div class="pixel-editor__ruler-top" data-ruler-top></div>
          <div class="pixel-editor__ruler-left" data-ruler-left></div>
          <div class="pixel-editor__canvas-stack" data-canvas-stack>
            <canvas data-edit-canvas></canvas>
            <canvas data-grid-canvas></canvas>
            <div class="pixel-editor__sel-box" data-sel-box hidden></div>
          </div>
        </div>
      </div>
    </div>
    <textarea class="pixel-editor__export" data-export-area readonly rows="5"></textarea>
  `;

  const select = panel.querySelector<HTMLSelectElement>('[data-select]')!;
  const bodyEl = panel.querySelector<HTMLElement>('[data-body]')!;
  const colPreview = panel.querySelector<HTMLElement>('[data-col-preview]')!;
  const colEdit = panel.querySelector<HTMLElement>('[data-col-edit]')!;
  const previewWorkspace = panel.querySelector<HTMLElement>('[data-preview-workspace]')!;
  const rulerSpacer = panel.querySelector<HTMLElement>('[data-ruler-spacer]')!;
  const previewFrame = panel.querySelector<HTMLElement>('[data-preview-frame]')!;
  const workspace = panel.querySelector<HTMLElement>('[data-workspace]')!;
  const canvasStack = panel.querySelector<HTMLElement>('[data-canvas-stack]')!;
  const editCanvas = panel.querySelector<HTMLCanvasElement>('[data-edit-canvas]')!;
  const gridCanvas = panel.querySelector<HTMLCanvasElement>('[data-grid-canvas]')!;
  const previewGridArt = panel.querySelector<HTMLCanvasElement>('[data-preview-grid-art]')!;
  const previewGridCanvas = panel.querySelector<HTMLCanvasElement>('[data-preview-grid]')!;
  const selBox = panel.querySelector<HTMLElement>('[data-sel-box]')!;
  const rulerTop = panel.querySelector<HTMLElement>('[data-ruler-top]')!;
  const rulerLeft = panel.querySelector<HTMLElement>('[data-ruler-left]')!;
  const exportArea = panel.querySelector<HTMLTextAreaElement>('[data-export-area]')!;
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
  colorPickerMount.append(picker);

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

  function layoutCanvases(): void {
    const bodyW = bodyEl.clientWidth || panel.clientWidth;
    const bodyH = bodyEl.clientHeight || Math.min(window.innerHeight * 0.5, 420);
    const colGap = 14;
    const colW = Math.max(
      120,
      Math.floor((bodyW - colGap) / 2),
      colPreview.clientWidth || 0,
      colEdit.clientWidth || 0
    );

    const colHeadH = 22;
    const editAreaW = colW - 4;
    const editAreaH = bodyH - colHeadH;

    let nextCell = Math.floor(
      Math.min(
        (editAreaW - RULER_PX) / GRID_COLS,
        (editAreaH - RULER_PX) / GRID_ROWS
      )
    );

    cellSize = Math.max(12, Math.min(nextCell, 36));
    gridPixelW = GRID_COLS * cellSize;
    gridPixelH = GRID_ROWS * cellSize;

    const dpr = window.devicePixelRatio || 1;
    setupCanvas(editCanvas, gridPixelW, gridPixelH, dpr);
    setupCanvas(gridCanvas, gridPixelW, gridPixelH, dpr);
    setupCanvas(previewGridArt, gridPixelW, gridPixelH, dpr);
    setupCanvas(previewGridCanvas, gridPixelW, gridPixelH, dpr);

    canvasStack.style.width = `${gridPixelW}px`;
    canvasStack.style.height = `${gridPixelH}px`;
    previewFrame.style.width = `${gridPixelW}px`;
    previewFrame.style.height = `${gridPixelH}px`;

    rulerSpacer.style.width = `${gridPixelW}px`;
    rulerSpacer.style.height = `${RULER_PX}px`;

    const workspaceSize = `${RULER_PX + gridPixelW}px`;
    const workspaceH = `${RULER_PX + gridPixelH}px`;
    workspace.style.width = workspaceSize;
    workspace.style.height = workspaceH;
    workspace.style.gridTemplateColumns = `${RULER_PX}px ${gridPixelW}px`;
    workspace.style.gridTemplateRows = `${RULER_PX}px ${gridPixelH}px`;

    previewWorkspace.style.gridTemplateColumns = `${gridPixelW}px`;
    previewWorkspace.style.gridTemplateRows = `${RULER_PX}px ${gridPixelH}px`;
    previewWorkspace.style.width = `${gridPixelW}px`;
    previewWorkspace.style.height = workspaceH;

    buildRulers();
    drawGridLines();
    refreshAll();
    updateSelectionBox();
  }

  function buildRulers(): void {
    rulerTop.innerHTML = '';
    rulerLeft.innerHTML = '';
    rulerTop.style.width = `${gridPixelW}px`;
    rulerLeft.style.height = `${gridPixelH}px`;

    for (let x = 0; x < GRID_COLS; x++) {
      const s = document.createElement('span');
      s.className = 'pixel-editor__ruler-tick';
      s.style.width = `${cellSize}px`;
      s.textContent = String(x);
      rulerTop.append(s);
    }
    for (let y = 0; y < GRID_ROWS; y++) {
      const s = document.createElement('span');
      s.className = 'pixel-editor__ruler-tick';
      s.style.height = `${cellSize}px`;
      s.textContent = String(y);
      rulerLeft.append(s);
    }
  }

  function strokeSquareGrid(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= GRID_COLS; x++) {
      const px = x * cellSize + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, gridPixelH);
      ctx.stroke();
    }
    for (let y = 0; y <= GRID_ROWS; y++) {
      const py = y * cellSize + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(gridPixelW, py);
      ctx.stroke();
    }
  }

  function drawGridLines(): void {
    const editGrid = gridCanvas.getContext('2d');
    if (editGrid) {
      editGrid.clearRect(0, 0, gridPixelW, gridPixelH);
      if (showGrid) strokeSquareGrid(editGrid);
    }
    const previewGrid = previewGridCanvas.getContext('2d');
    if (previewGrid) {
      previewGrid.clearRect(0, 0, gridPixelW, gridPixelH);
      if (showGrid) strokeSquareGrid(previewGrid);
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
      sq.clearRect(0, 0, gridPixelW, gridPixelH);
      drawGridToCanvas(sq, grid, gridPixelW, gridPixelH);
    }
  }

  function refreshAll(): void {
    refreshEditCanvas();
    refreshPreview();
    updateSelectionBox();
  }

  function cellFromEvent(e: PointerEvent): { x: number; y: number } {
    const r = editCanvas.getBoundingClientRect();
    const x = clamp(
      Math.floor(((e.clientX - r.left) / r.width) * GRID_COLS),
      0,
      GRID_COLS - 1
    );
    const y = clamp(
      Math.floor(((e.clientY - r.top) / r.height) * GRID_ROWS),
      0,
      GRID_ROWS - 1
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
  }

  function paintAt(x: number, y: number): void {
    if (lastPaintCell?.x === x && lastPaintCell?.y === y) return;
    lastPaintCell = { x, y };
    grid[y][x] = paintColor;
    refreshAll();
  }

  function finishSelection(x1: number, y1: number): void {
    if (!selectStart) return;
    const rect = normalizeRect(selectStart.x, selectStart.y, x1, y1);
    rect.x = clamp(rect.x, 0, GRID_COLS - 1);
    rect.y = clamp(rect.y, 0, GRID_ROWS - 1);
    rect.w = Math.min(rect.w, GRID_COLS - rect.x);
    rect.h = Math.min(rect.h, GRID_ROWS - rect.y);
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
    const tx = clamp(targetX, 0, GRID_COLS - selection.w);
    const ty = clamp(targetY, 0, GRID_ROWS - selection.h);
    clearRegion(grid, selection);
    pasteRegion(grid, tx, ty, selection.pixels);
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

  panel.addEventListener(
    'touchmove',
    (e) => {
      if (pointerDrawing) e.preventDefault();
    },
    { passive: false }
  );

  editCanvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pointerDrawing = true;
    editCanvas.setPointerCapture(e.pointerId);
    const { x, y } = cellFromEvent(e);
    if (tool === 'paint') {
      lastPaintCell = null;
      paintAt(x, y);
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
    if (!editCanvas.hasPointerCapture(e.pointerId)) return;
    e.preventDefault();
    const { x, y } = cellFromEvent(e);
    if (tool === 'paint') {
      paintAt(x, y);
      return;
    }
    if (tool === 'select' && selectStart) {
      updateSelectionBox(normalizeRect(selectStart.x, selectStart.y, x, y));
      return;
    }
    if (tool === 'move' && moveAnchor && selection) {
      updateSelectionBox({
        x: clamp(x - moveOffset.x, 0, GRID_COLS - selection.w),
        y: clamp(y - moveOffset.y, 0, GRID_ROWS - selection.h),
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

  panel.querySelector('[data-toggle-grid]')?.addEventListener('click', () => {
    showGrid = !showGrid;
    drawGridLines();
    const btn = panel.querySelector('[data-toggle-grid]');
    if (btn) btn.textContent = showGrid ? '网格：开' : '网格';
  });

  select.addEventListener('change', () => {
    currentKey = select.value as PixelArtKey;
    grid = normalizeGrid(getArtGrid(currentKey));
    selection = null;
    selectStart = null;
    refreshAll();
    exportArea.value = '';
  });

  panel.querySelector('[data-clear]')?.addEventListener('click', () => {
    grid = normalizeGrid([]);
    selection = null;
    refreshAll();
  });

  panel.querySelector('[data-apply]')?.addEventListener('click', () => {
    setCustomArtGrid(currentKey, grid);
    onApplied();
    exportArea.value = gridToExportCode(currentKey, grid);
  });

  panel.querySelector('[data-export]')?.addEventListener('click', () => {
    exportArea.value = gridToExportCode(currentKey, grid);
    exportArea.select();
    try {
      void navigator.clipboard.writeText(exportArea.value);
    } catch {
      /* noop */
    }
  });

  panel.querySelector('.pixel-editor__close')?.addEventListener('click', closePixelEditor);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePixelEditor();
  });

  const ro = new ResizeObserver(() => layoutCanvases());
  ro.observe(bodyEl);
  ro.observe(panel);

  overlay.append(panel);
  getOverlayMount().append(overlay);
  requestAnimationFrame(() => {
    layoutCanvases();
    requestAnimationFrame(() => layoutCanvases());
  });
}

export function closePixelEditor(): void {
  document.querySelector('[data-modal="pixel-editor"]')?.remove();
}
