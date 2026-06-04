import {
  getArtGrid,
  gridToExportCode,
  setCustomArtGrid,
  type Pixel,
  type PixelGrid,
  PIXEL_ART_KEYS,
} from '../art/pixelArt';
import type { PixelArtKey } from '../game/types';

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

export function openPixelEditor(onApplied: () => void): void {
  closePixelEditor();

  let currentKey: PixelArtKey = 'heal-potion';
  let grid = normalizeGrid(getArtGrid(currentKey));
  let paintColor: Pixel = '#fff';

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
      <button type="button" class="btn" data-clear>清空</button>
      <button type="button" class="btn" data-apply>应用到预览</button>
      <button type="button" class="btn" data-export>导出代码</button>
    </div>
    <div class="pixel-editor__palette" data-palette></div>
    <div class="pixel-editor__main">
      <canvas class="pixel-editor__preview" width="128" height="128"></canvas>
      <div class="pixel-editor__grid" data-grid></div>
    </div>
    <textarea class="pixel-editor__export" data-export-area readonly rows="8" placeholder="导出代码"></textarea>
  `;

  const select = panel.querySelector<HTMLSelectElement>('[data-select]')!;
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
    sw.dataset.color = color;
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

  const gridEl = panel.querySelector<HTMLElement>('[data-grid]')!;
  const preview = panel.querySelector<HTMLCanvasElement>('.pixel-editor__preview')!;
  const exportArea = panel.querySelector<HTMLTextAreaElement>('[data-export-area]')!;

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

  function refreshPreview(): void {
    const ctx = preview.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 128, 128);
    const cell = Math.floor(Math.min(128 / EDITOR_COLS, 128 / EDITOR_ROWS));
    const ox = Math.floor((128 - EDITOR_COLS * cell) / 2);
    const oy = Math.floor((128 - EDITOR_ROWS * cell) / 2);
    for (let y = 0; y < EDITOR_ROWS; y++) {
      for (let x = 0; x < EDITOR_COLS; x++) {
        const c = grid[y][x];
        if (!c) continue;
        ctx.fillStyle = c;
        ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
      }
    }
  }

  function buildGridUi(): void {
    gridEl.innerHTML = '';
    gridEl.style.gridTemplateColumns = `repeat(${EDITOR_COLS}, 1fr)`;
    for (let y = 0; y < EDITOR_ROWS; y++) {
      for (let x = 0; x < EDITOR_COLS; x++) {
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'pixel-editor__cell';
        cell.dataset.x = String(x);
        cell.dataset.y = String(y);
        const paint = () => {
          grid[y][x] = paintColor;
          cell.style.background = paintColor ?? 'transparent';
          refreshPreview();
        };
        cell.style.background = grid[y][x] ?? 'transparent';
        cell.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          paint();
        });
        cell.addEventListener('pointerenter', (e) => {
          if (e.buttons === 1) paint();
        });
        gridEl.append(cell);
      }
    }
  }

  select.addEventListener('change', () => {
    currentKey = select.value as PixelArtKey;
    grid = normalizeGrid(getArtGrid(currentKey));
    buildGridUi();
    refreshPreview();
    exportArea.value = '';
  });

  panel.querySelector('[data-clear]')?.addEventListener('click', () => {
    grid = normalizeGrid([]);
    buildGridUi();
    refreshPreview();
  });

  panel.querySelector('[data-apply]')?.addEventListener('click', () => {
    setCustomArtGrid(currentKey, grid);
    onApplied();
    refreshPreview();
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

  panel.querySelector('.pixel-editor__close')?.addEventListener('click', () => {
    closePixelEditor();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closePixelEditor();
  });

  buildGridUi();
  refreshPreview();
  overlay.append(panel);
  document.body.append(overlay);
}

export function closePixelEditor(): void {
  document.querySelector('[data-modal="pixel-editor"]')?.remove();
}
