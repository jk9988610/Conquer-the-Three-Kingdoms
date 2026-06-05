import { ART_GRID_COLS, ART_GRID_ROWS } from './gridConfig';
import type { Pixel, PixelGrid } from './pixelArt';

/** 0 = 透明；否则 0xAARRGGBB */
export type PackedGrid = Uint32Array;

export function packedGridSize(cols = ART_GRID_COLS, rows = ART_GRID_ROWS): number {
  return cols * rows;
}

export function createPackedGrid(cols = ART_GRID_COLS, rows = ART_GRID_ROWS): PackedGrid {
  return new Uint32Array(cols * rows);
}

export function clonePackedGrid(src: PackedGrid): PackedGrid {
  return new Uint32Array(src);
}

export function gridIndex(x: number, y: number, cols = ART_GRID_COLS): number {
  return y * cols + x;
}

export function getPackedPixel(
  grid: PackedGrid,
  x: number,
  y: number,
  cols = ART_GRID_COLS
): number {
  return grid[gridIndex(x, y, cols)] ?? 0;
}

export function setPackedPixel(
  grid: PackedGrid,
  x: number,
  y: number,
  color: number,
  cols = ART_GRID_COLS
): void {
  grid[gridIndex(x, y, cols)] = color >>> 0;
}

export function pixelToArgb(p: Pixel): number {
  if (!p) return 0;
  const rgba = p.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i
  );
  if (rgba) {
    const r = Math.round(Number(rgba[1]));
    const g = Math.round(Number(rgba[2]));
    const b = Math.round(Number(rgba[3]));
    const a = rgba[4] !== undefined ? Math.round(Number(rgba[4]) * 255) : 255;
    if (a < 8) return 0;
    return ((a & 255) << 24) | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
  }
  let hex = p.replace('#', '');
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
    if (a < 8) return 0;
    return ((a & 255) << 24) | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
  }
  return 0xffffffff;
}

export function argbToPixel(v: number): Pixel {
  const a = (v >>> 24) & 255;
  if (a < 8) return null;
  const r = (v >>> 16) & 255;
  const g = (v >>> 8) & 255;
  const b = v & 255;
  if (a >= 254) return `rgba(${r},${g},${b},1.00)`;
  return `rgba(${r},${g},${b},${(a / 255).toFixed(2)})`;
}

export function gridToPacked(
  grid: PixelGrid,
  cols = ART_GRID_COLS,
  rows = ART_GRID_ROWS
): PackedGrid {
  const out = createPackedGrid(cols, rows);
  for (let y = 0; y < Math.min(rows, grid.length); y++) {
    const row = grid[y] ?? [];
    for (let x = 0; x < Math.min(cols, row.length); x++) {
      out[gridIndex(x, y, cols)] = pixelToArgb(row[x] ?? null);
    }
  }
  return out;
}

export function packedToGrid(
  packed: PackedGrid,
  cols = ART_GRID_COLS,
  rows = ART_GRID_ROWS
): PixelGrid {
  const out: PixelGrid = [];
  for (let y = 0; y < rows; y++) {
    const row: Pixel[] = [];
    for (let x = 0; x < cols; x++) {
      row.push(argbToPixel(packed[gridIndex(x, y, cols)] ?? 0));
    }
    out.push(row);
  }
  return out;
}

export function upscalePackedToArtSize(
  src: PackedGrid,
  srcCols: number,
  srcRows: number,
  cols = ART_GRID_COLS,
  rows = ART_GRID_ROWS
): PackedGrid {
  const out = createPackedGrid(cols, rows);
  if (srcCols === cols && srcRows === rows) {
    out.set(src);
    return out;
  }
  for (let y = 0; y < rows; y++) {
    const sy = Math.min(srcRows - 1, Math.floor(((y + 0.5) * srcRows) / rows));
    for (let x = 0; x < cols; x++) {
      const sx = Math.min(srcCols - 1, Math.floor(((x + 0.5) * srcCols) / cols));
      out[gridIndex(x, y, cols)] = src[gridIndex(sx, sy, srcCols)] ?? 0;
    }
  }
  return out;
}

export function compositePackedGrids(
  layers: PackedGrid[],
  visible?: boolean[]
): PackedGrid {
  const out = createPackedGrid();
  for (let i = 0; i < layers.length; i++) {
    if (visible && visible[i] === false) continue;
    const layer = layers[i];
    for (let j = 0; j < out.length; j++) {
      const p = layer[j];
      if (p !== 0) out[j] = p;
    }
  }
  return out;
}

export function drawPackedToCanvas(
  ctx: CanvasRenderingContext2D,
  packed: PackedGrid,
  width: number,
  height: number,
  cols = ART_GRID_COLS,
  rows = ART_GRID_ROWS
): void {
  const cell = Math.max(1, Math.floor(Math.min(width / cols, height / rows)));
  const drawW = cols * cell;
  const drawH = rows * cell;
  const ox = Math.floor((width - drawW) / 2);
  const oy = Math.floor((height - drawH) / 2);
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = packed[gridIndex(x, y, cols)] ?? 0;
      if (v === 0) continue;
      const a = (v >>> 24) / 255;
      const r = (v >>> 16) & 255;
      const g = (v >>> 8) & 255;
      const b = v & 255;
      ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
      ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
    }
  }
}

export function encodePackedBase64(packed: PackedGrid): string {
  const bytes = new Uint8Array(packed.buffer, packed.byteOffset, packed.byteLength);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function decodePackedBase64(b64: string, size = packedGridSize()): PackedGrid {
  const bin = atob(b64);
  const byteLen = size * 4;
  const bytes = new Uint8Array(byteLen);
  const n = Math.min(bin.length, byteLen);
  for (let i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
  const out = new Uint32Array(bytes.buffer, 0, size);
  return out;
}

export function argbEquals(a: number, b: number): boolean {
  return (a >>> 0) === (b >>> 0);
}

/** 编辑器画布：格点从 (0,0) 起，每格 cellSize 像素 */
export function drawPackedGridCells(
  ctx: CanvasRenderingContext2D,
  packed: PackedGrid,
  cellSize: number,
  cols = ART_GRID_COLS,
  rows = ART_GRID_ROWS
): void {
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = packed[gridIndex(x, y, cols)] ?? 0;
      if (v === 0) continue;
      const a = (v >>> 24) / 255;
      const r = (v >>> 16) & 255;
      const g = (v >>> 8) & 255;
      const b = v & 255;
      ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }
}

export function floodFillPacked(
  grid: PackedGrid,
  cols: number,
  rows: number,
  x: number,
  y: number,
  fillArgb: number,
  onCellChange?: (index: number, prev: number, next: number) => void
): void {
  const target = getPackedPixel(grid, x, y, cols);
  if (argbEquals(target, fillArgb)) return;

  const stack: [number, number][] = [[x, y]];
  const seen = new Set<number>();

  while (stack.length > 0) {
    const [cx, cy] = stack.pop()!;
    const idx = gridIndex(cx, cy, cols);
    if (seen.has(idx)) continue;
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
    if (!argbEquals(grid[idx] ?? 0, target)) continue;
    seen.add(idx);
    const prev = grid[idx] ?? 0;
    grid[idx] = fillArgb >>> 0;
    onCellChange?.(idx, prev, fillArgb >>> 0);
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
}

export function copyPackedRegion(
  grid: PackedGrid,
  x: number,
  y: number,
  w: number,
  h: number,
  cols = ART_GRID_COLS
): Uint32Array {
  const out = new Uint32Array(w * h);
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      out[dy * w + dx] = getPackedPixel(grid, x + dx, y + dy, cols);
    }
  }
  return out;
}

export function clearPackedRegion(
  grid: PackedGrid,
  x: number,
  y: number,
  w: number,
  h: number,
  cols = ART_GRID_COLS,
  onCellChange?: (index: number, prev: number, next: number) => void
): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const idx = gridIndex(x + dx, y + dy, cols);
      const prev = grid[idx] ?? 0;
      if (prev === 0) continue;
      grid[idx] = 0;
      onCellChange?.(idx, prev, 0);
    }
  }
}

export function pastePackedRegion(
  grid: PackedGrid,
  cols: number,
  rows: number,
  atX: number,
  atY: number,
  w: number,
  h: number,
  pixels: Uint32Array,
  onCellChange?: (index: number, prev: number, next: number) => void
): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const yy = atY + dy;
      const xx = atX + dx;
      if (yy < 0 || yy >= rows || xx < 0 || xx >= cols) continue;
      const idx = gridIndex(xx, yy, cols);
      const next = pixels[dy * w + dx] ?? 0;
      const prev = grid[idx] ?? 0;
      if (prev === next) continue;
      grid[idx] = next;
      onCellChange?.(idx, prev, next);
    }
  }
}

export function collectPackedDiff(
  before: PackedGrid,
  after: PackedGrid
): { i: number; prev: number; next: number }[] {
  const patches: { i: number; prev: number; next: number }[] = [];
  const n = Math.min(before.length, after.length);
  for (let i = 0; i < n; i++) {
    const prev = before[i] ?? 0;
    const next = after[i] ?? 0;
    if (prev !== next) patches.push({ i, prev, next });
  }
  return patches;
}
