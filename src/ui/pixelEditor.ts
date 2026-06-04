import {
  drawGridToCanvas,
  getArtGrid,
  gridToExportCode,
  setCustomArtGrid,
  type Pixel,
  type PixelGrid,
  PIXEL_ART_KEYS,
} from '../art/pixelArt';
import {
  ART_PREVIEW_HEIGHT,
  ART_PREVIEW_WIDTH,
} from '../tcg/dimensions';
import type { PixelArtKey } from '../game/types';
import { getOverlayMount } from './overlayRoot';

const EDITOR_COLS = 16;
const EDITOR_ROWS = 16;

const PALETTE = [
  '#c44',
  '#422',
  '#6a8',
  '#48c',
  '#ec4',
  '#fff',
  '#222',
  '#e8589a',
  '#8b5',
  '#5ecf7a',
  '#3a2518',
  '#e8c86a',
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
  for (let y = 0; y < EDITOR_ROWS; y++) {
    const src = g[y] ?? [];
    const row: Pixel[] = [];
    for (let x = 0; x < EDITOR_COLS; x++) {
      row.push(src[x] ?? null);
    }
    rows.push(row);
  }
  return rows;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function normalizeRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): { x: number; y: number; w: number; h: number } {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0) + 1;
  const h = Math.abs(y1 - y0) + 1;
  return { x, y, w, h };
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
      if (yy < 0 || yy >= EDITOR_ROWS || xx < 0 || xx >= EDITOR_COLS) continue;
      grid[yy][xx] = pixels[dy][dx];
    }
  }
}

export function openPixelEditor(onApplied: () => void): void {
  closePixelEditor();

  let currentKey: PixelArtKey = 'heal-potion';
  let grid = normalizeGrid(getArtGrid(currentKey));
  let paintColor: Pixel = '#fff';
  let tool: Tool = 'paint';
  let showGrid = true;
  let selection: Selection | null = null;
  let selectStart: { x: number; y: number } | null = null;
  let moveAnchor: { x: number; y: number } | null = null;
  let moveOffset = { x: 0, y: 0 };

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
      <button type="button" class="btn" data-toggle-grid>网格</button>
      <button type="button" class="btn" data-clear>清空</button>
      <button type="button" class="btn" data-apply>应用</button>
      <button type="button" class="btn" data-export>导出</button>
    </div>
    <div class="pixel-editor__palette" data-palette></div>
    <div class="pixel-editor__main">
      <div class="pixel-editor__edit-wrap">
        <div class="pixel-editor__ruler-corner"></div>
        <div class="pixel-editor__ruler-top" data-ruler-top></div>
        <div class="pixel-editor__ruler-left" data-ruler-left></div>
        <div class="pixel-editor__canvas-box" data-canvas-box>
          <canvas class="pixel-editor__edit-canvas" data-edit-canvas></canvas>
          <div class="pixel-editor__grid-overlay" data-grid-overlay></div>
          <div class="pixel-editor__sel-box" data-sel-box hidden></div>
        </div>
      </div>
      <div class="pixel-editor__preview-wrap">
        <span class="pixel-editor__preview-label">卡面预览</span>
        <canvas class="pixel-editor__preview" data-preview></canvas>
      </div>
    </div>
    <textarea class="pixel-editor__export" data-export-area readonly rows="6" placeholder="导出代码"></textarea>
  `;

  const select = panel.querySelector<HTMLSelectElement>('[data-select]')!;
  const editCanvas = panel.querySelector<HTMLCanvasElement>('[data-edit-canvas]')!;
  const preview = panel.querySelector<HTMLCanvasElement>('[data-preview]')!;
  const gridOverlay = panel.querySelector<HTMLElement>('[data-grid-overlay]')!;
  const selBox = panel.querySelector<HTMLElement>('[data-sel-box]')!;
  const rulerTop = panel.querySelector<HTMLElement>('[data-ruler-top]')!;
  const rulerLeft = panel.querySelector<HTMLElement>('[data-ruler-left]')!;
  const exportArea = panel.querySelector<HTMLTextAreaElement>('[data-export-area]')!;

  preview.width = ART_PREVIEW_WIDTH;
  preview.height = ART_PREVIEW_HEIGHT;

  const editW = ART_PREVIEW_WIDTH * 2;
  const editH = Math.round(editW / (ART_PREVIEW_WIDTH / ART_PREVIEW_HEIGHT));
  editCanvas.width = editW;
  editCanvas.height = editH;

  for (const k of PIXEL_ART_KEYS) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = k;
    select.append(opt);
  }
  select.value = currentKey;

  const paletteEl = panel.querySelector('[data-palette]')!;
  for (const color of PALETTE) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'pixel-editor__swatch';
    sw.style.background = color;
    if (color === paintColor) sw.classList.add('pixel-editor__swatch--active');
    sw.addEventListener('click', () => {
      paintColor = color;
      paletteEl
        .querySelectorAll('.pixel-editor__swatch')
        .forEach((b) => b.classList.remove('pixel-editor__swatch--active'));
      sw.classList.add('pixel-editor__swatch--active');
    });
    paletteEl.append(sw);
  }

  function buildRulers(): void {
    rulerTop.innerHTML = '';
    rulerLeft.innerHTML = '';
    for (let x = 0; x < EDITOR_COLS; x++) {
      const s = document.createElement('span');
      s.textContent = String(x);
      rulerTop.append(s);
    }
    for (let y = 0; y < EDITOR_ROWS; y++) {
      const s = document.createElement('span');
      s.textContent = String(y);
      rulerLeft.append(s);
    }
  }

  function refreshEditCanvas(): void {
    const ctx = editCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, editW, editH);
    drawGridToCanvas(ctx, grid, editW, editH);
  }

  function refreshPreview(): void {
    const ctx = preview.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, ART_PREVIEW_WIDTH, ART_PREVIEW_HEIGHT);
    drawGridToCanvas(ctx, grid, ART_PREVIEW_WIDTH, ART_PREVIEW_HEIGHT);
  }

  function refreshAll(): void {
    refreshEditCanvas();
    refreshPreview();
    updateSelectionBox();
  }

  function updateGridOverlay(): void {
    gridOverlay.classList.toggle('pixel-editor__grid-overlay--hidden', !showGrid);
    const cellW = 100 / EDITOR_COLS;
    const cellH = 100 / EDITOR_ROWS;
    gridOverlay.style.backgroundImage = `
      linear-gradient(to right, rgba(255,255,255,0.35) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255,255,255,0.35) 1px, transparent 1px)
    `;
    gridOverlay.style.backgroundSize = `${cellW}% ${cellH}%`;
  }

  function cellFromEvent(e: PointerEvent): { x: number; y: number } {
    const r = editCanvas.getBoundingClientRect();
    const x = clamp(
      Math.floor(((e.clientX - r.left) / r.width) * EDITOR_COLS),
      0,
      EDITOR_COLS - 1
    );
    const y = clamp(
      Math.floor(((e.clientY - r.top) / r.height) * EDITOR_ROWS),
      0,
      EDITOR_ROWS - 1
    );
    return { x, y };
  }

  function updateSelectionBox(rect?: { x: number; y: number; w: number; h: number }): void {
    const r = rect ?? (selection ? { x: selection.x, y: selection.y, w: selection.w, h: selection.h } : null);
    if (!r) {
      selBox.hidden = true;
      return;
    }
    selBox.hidden = false;
    const cw = 100 / EDITOR_COLS;
    const ch = 100 / EDITOR_ROWS;
    selBox.style.left = `${r.x * cw}%`;
    selBox.style.top = `${r.y * ch}%`;
    selBox.style.width = `${r.w * cw}%`;
    selBox.style.height = `${r.h * ch}%`;
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
    grid[y][x] = paintColor;
    refreshAll();
  }

  function finishSelection(x1: number, y1: number): void {
    if (!selectStart) return;
    const rect = normalizeRect(selectStart.x, selectStart.y, x1, y1);
    rect.x = clamp(rect.x, 0, EDITOR_COLS - 1);
    rect.y = clamp(rect.y, 0, EDITOR_ROWS - 1);
    rect.w = Math.min(rect.w, EDITOR_COLS - rect.x);
    rect.h = Math.min(rect.h, EDITOR_ROWS - rect.y);
    if (rect.w < 1 || rect.h < 1) {
      selection = null;
      selBox.hidden = true;
      return;
    }
    selection = {
      ...rect,
      pixels: copyRegion(grid, rect as Selection),
    };
    updateSelectionBox(rect);
    selectStart = null;
  }

  function commitMove(targetX: number, targetY: number): void {
    if (!selection) return;
    const tx = clamp(targetX, 0, EDITOR_COLS - selection.w);
    const ty = clamp(targetY, 0, EDITOR_ROWS - selection.h);
    clearRegion(grid, selection);
    pasteRegion(grid, tx, ty, selection.pixels);
    selection = {
      x: tx,
      y: ty,
      w: selection.w,
      h: selection.h,
      pixels: copyRegion(grid, { x: tx, y: ty, w: selection.w, h: selection.h, pixels: [] }),
    };
    refreshAll();
  }

  editCanvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    editCanvas.setPointerCapture(e.pointerId);
    const { x, y } = cellFromEvent(e);

    if (tool === 'paint') {
      paintAt(x, y);
      return;
    }
    if (tool === 'select') {
      selectStart = { x, y };
      updateSelectionBox({ x, y, w: 1, h: 1 });
      return;
    }
    if (tool === 'move') {
      if (!selection) return;
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
    const { x, y } = cellFromEvent(e);

    if (tool === 'paint' && e.buttons === 1) {
      paintAt(x, y);
      return;
    }
    if (tool === 'select' && selectStart) {
      const rect = normalizeRect(selectStart.x, selectStart.y, x, y);
      updateSelectionBox(rect);
      return;
    }
    if (tool === 'move' && moveAnchor && selection) {
      const tx = clamp(x - moveOffset.x, 0, EDITOR_COLS - selection.w);
      const ty = clamp(y - moveOffset.y, 0, EDITOR_ROWS - selection.h);
      updateSelectionBox({
        x: tx,
        y: ty,
        w: selection.w,
        h: selection.h,
      });
    }
  });

  editCanvas.addEventListener('pointerup', (e) => {
    const { x, y } = cellFromEvent(e);
    if (tool === 'select' && selectStart) {
      finishSelection(x, y);
    }
    if (tool === 'move' && moveAnchor && selection) {
      commitMove(x - moveOffset.x, y - moveOffset.y);
      moveAnchor = null;
    }
    try {
      editCanvas.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
  });

  panel.querySelectorAll('[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setTool((btn as HTMLElement).dataset.tool as Tool);
    });
  });

  panel.querySelector('[data-toggle-grid]')?.addEventListener('click', () => {
    showGrid = !showGrid;
    updateGridOverlay();
    const btn = panel.querySelector('[data-toggle-grid]');
    if (btn) btn.textContent = showGrid ? '网格：开' : '网格';
  });

  select.addEventListener('change', () => {
    currentKey = select.value as PixelArtKey;
    grid = normalizeGrid(getArtGrid(currentKey));
    selection = null;
    selectStart = null;
    buildGridUi();
    refreshAll();
    exportArea.value = '';
  });

  function buildGridUi(): void {
    buildRulers();
    updateGridOverlay();
    refreshAll();
  }

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

  buildGridUi();
  overlay.append(panel);
  getOverlayMount().append(overlay);
}

export function closePixelEditor(): void {
  document.querySelector('[data-modal="pixel-editor"]')?.remove();
}
