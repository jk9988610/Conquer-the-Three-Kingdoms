import type { PixelArtKey } from '../game/types';
import {
  anyDisplayHighlightBreath,
  cloneDisplayHighlight,
  createEmptyDisplayHighlight,
  hasAnyDisplayHighlight,
  paintDisplayHighlightOverlay,
  type DisplayHighlightGrid,
} from './displayHighlight';
import {
  ART_DISPLAY_COLS,
  ART_DISPLAY_ROWS,
  ART_GRID_COLS,
  ART_GRID_ROWS,
} from './gridConfig';
import {
  clonePackedGrid,
  createDefaultCardArtPacked,
  downsamplePackedGrid,
  drawPackedDisplayToCanvas,
  gridDrawLayout,
  gridToPacked,
  packedToGrid,
  type GridDrawMode,
  type PackedGrid,
} from './packedGrid';

export type { GridDrawMode } from './packedGrid';

export {
  ART_DISPLAY_COLS,
  ART_DISPLAY_ROWS,
  ART_GRID_COLS,
  ART_GRID_ROWS,
} from './gridConfig';

export type Pixel = string | null;
export type PixelGrid = Pixel[][];

const PIXEL_ART_KEYS_LIST = [
  'generic',
  'lvbu',
  'liu',
  'guan',
  'zhang',
  'heal-potion',
  'fangtian',
  'attack-red',
  'attack-orange',
  'attack-purple',
] as const satisfies readonly PixelArtKey[];

const customOverrides: Partial<Record<PixelArtKey, PackedGrid>> = {};
const customHighlightOverrides: Partial<Record<PixelArtKey, DisplayHighlightGrid>> = {};
const customHighlightBreathSpeed: Partial<Record<PixelArtKey, number>> = {};
const packedArtCache = new Map<PixelArtKey, PackedGrid>();
let defaultArtPacked: PackedGrid | null = null;

function getDefaultArtPacked(): PackedGrid {
  if (!defaultArtPacked) defaultArtPacked = createDefaultCardArtPacked();
  return defaultArtPacked;
}

function getBaseArtPacked(key: PixelArtKey): PackedGrid {
  let cached = packedArtCache.get(key);
  if (!cached) {
    cached = clonePackedGrid(getDefaultArtPacked());
    packedArtCache.set(key, cached);
  }
  return cached;
}

/** 运行时紧凑网格（4 字节/格） */
export function getArtPacked(key: PixelArtKey): PackedGrid {
  const custom = customOverrides[key];
  if (custom) return custom;
  return getBaseArtPacked(key);
}

export const PIXEL_ART_KEYS = [...PIXEL_ART_KEYS_LIST] as PixelArtKey[];

/** 将任意尺寸网格最近邻缩放到标准 500×700 */
export function upscaleGridToArtSize(grid: PixelGrid): PixelGrid {
  const { cols, rows } = gridDimensions(grid);
  if (cols === ART_GRID_COLS && rows === ART_GRID_ROWS) {
    return grid.map((row) => [...row]);
  }
  const out: PixelGrid = [];
  for (let y = 0; y < ART_GRID_ROWS; y++) {
    const row: Pixel[] = [];
    for (let x = 0; x < ART_GRID_COLS; x++) {
      const sx = Math.min(cols - 1, Math.floor(((x + 0.5) * cols) / ART_GRID_COLS));
      const sy = Math.min(rows - 1, Math.floor(((y + 0.5) * rows) / ART_GRID_ROWS));
      row.push(grid[sy]?.[sx] ?? null);
    }
    out.push(row);
  }
  return out;
}

export function getArtGrid(key: PixelArtKey): PixelGrid {
  return packedToGrid(getArtPacked(key));
}

export function setCustomArtGrid(key: PixelArtKey, grid: PixelGrid): void {
  customOverrides[key] = gridToPacked(upscaleGridToArtSize(grid.map((row) => [...row])));
  packedArtCache.delete(key);
}

export function getArtHighlight(key: PixelArtKey): DisplayHighlightGrid {
  const custom = customHighlightOverrides[key];
  if (custom) return custom;
  return createEmptyDisplayHighlight();
}

export function getArtHighlightBreathSpeed(key: PixelArtKey): number {
  return customHighlightBreathSpeed[key] ?? 50;
}

export function setCustomArtHighlight(
  key: PixelArtKey,
  highlight: DisplayHighlightGrid,
  breathSpeed = 50
): void {
  customHighlightOverrides[key] = cloneDisplayHighlight(highlight);
  customHighlightBreathSpeed[key] = Math.max(1, Math.min(100, Math.round(breathSpeed)));
}

export function gridToExportCode(key: string, grid: PixelGrid): string {
  const lines = grid.map((row) => {
    const cells = row.map((c) => (c === null ? 'null' : JSON.stringify(c)));
    return `    [${cells.join(', ')}],`;
  });
  return `  '${key}': [\n${lines.join('\n')}\n  ],`;
}

export function gridDimensions(grid: PixelGrid): { cols: number; rows: number } {
  const rows = Math.max(1, grid.length);
  const cols = Math.max(1, ...grid.map((r) => r.length));
  return { cols, rows };
}

/** 自下而上合成多层；上层 null 表示透明，不遮挡下层色块 */
export function compositePixelGrids(
  layers: PixelGrid[],
  visible?: boolean[]
): PixelGrid {
  if (layers.length === 0) return [];
  const { cols, rows } = gridDimensions(layers[0]);
  const out: PixelGrid = [];
  for (let y = 0; y < rows; y++) {
    const row: Pixel[] = [];
    for (let x = 0; x < cols; x++) row.push(null);
    out.push(row);
  }
  for (let i = 0; i < layers.length; i++) {
    if (visible && visible[i] === false) continue;
    const layer = layers[i];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const p = layer[y]?.[x] ?? null;
        if (p != null) out[y][x] = p;
      }
    }
  }
  return out;
}

function parsePixelColor(c: string): { r: number; g: number; b: number; a: number } {
  const rgba = c.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] !== undefined ? Number(rgba[4]) : 1,
    };
  }
  let hex = c.replace('#', '');
  if (hex.length === 8) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: parseInt(hex.slice(6, 8), 16) / 255,
    };
  }
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: 1,
  };
}

/**
 * 画布 CSS 像素尺寸（与展示区域一致，避免再经 CSS 缩放发糊）。
 */
export function gridCanvasPixelSize(
  grid: PixelGrid,
  displayWidth: number,
  displayHeight: number,
  mode: GridDrawMode = 'fit'
): { width: number; height: number; cell: number } {
  const { cols, rows } = gridDimensions(grid);
  const width = Math.max(1, Math.floor(displayWidth));
  const height = Math.max(1, Math.floor(displayHeight));
  const { cell } = gridDrawLayout(cols, rows, width, height, mode);
  return { width, height, cell };
}

/** 配置画布物理像素 = CSS 尺寸 × DPR，绘制坐标系为 CSS 像素 */
export function prepareSharpCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
): {
  ctx: CanvasRenderingContext2D;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
} | null {
  const w = Math.max(1, Math.floor(cssWidth));
  const h = Math.max(1, Math.floor(cssHeight));
  const ratio = Math.max(1, dpr);
  canvas.width = Math.max(1, Math.round(w * ratio));
  canvas.height = Math.max(1, Math.round(h * ratio));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.imageSmoothingEnabled = false;
  return { ctx, cssWidth: w, cssHeight: h, dpr: ratio };
}

/** 将像素网格铺满画布；每格等宽等高整数像素，支持 #rgb / #rrggbb / rgba() */
export function drawGridToCanvas(
  ctx: CanvasRenderingContext2D,
  grid: PixelGrid,
  width: number,
  height: number,
  mode: GridDrawMode = 'fit'
): void {
  const { cols, rows } = gridDimensions(grid);
  const { cell, ox, oy } = gridDrawLayout(cols, rows, width, height, mode);
  ctx.imageSmoothingEnabled = false;

  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (!c) continue;
      const { r, g, b, a } = parsePixelColor(c);
      ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
      ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
    }
  }
}

export interface DrawPixelArtOptions {
  transparent?: boolean;
  mode?: GridDrawMode;
  highlight?: DisplayHighlightGrid;
  highlightBreathSpeed?: number;
}

export function drawPixelArt(
  ctx: CanvasRenderingContext2D,
  key: PixelArtKey,
  width: number,
  height: number,
  options: DrawPixelArtOptions = {}
): void {
  const { transparent = false, mode = 'fit' } = options;
  ctx.clearRect(0, 0, width, height);

  if (!transparent) {
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#2a3a52');
    bg.addColorStop(1, '#1a2438');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
  }

  const packed = getArtPacked(key);
  drawPackedDisplayToCanvas(ctx, packed, width, height, mode);

  const highlight = options.highlight ?? getArtHighlight(key);
  if (!hasAnyDisplayHighlight(highlight)) return;

  const layout = gridDrawLayout(
    ART_DISPLAY_COLS,
    ART_DISPLAY_ROWS,
    width,
    height,
    mode
  );
  const cellPx = Math.max(1, Math.floor(layout.cell));
  const display = downsamplePackedGrid(
    packed,
    ART_GRID_COLS,
    ART_GRID_ROWS,
    ART_DISPLAY_COLS,
    ART_DISPLAY_ROWS
  );
  paintDisplayHighlightOverlay(
    ctx,
    display,
    highlight,
    cellPx,
    layout.ox,
    layout.oy,
    options.highlightBreathSpeed ?? getArtHighlightBreathSpeed(key)
  );
}

export function artHasHighlightBreath(key: PixelArtKey): boolean {
  return anyDisplayHighlightBreath(getArtHighlight(key));
}

/** 编辑器预览：与卡面相同的 60×84 展示网格 */
export function drawPackedPreview(
  ctx: CanvasRenderingContext2D,
  packed: PackedGrid,
  width: number,
  height: number,
  cols = ART_GRID_COLS,
  rows = ART_GRID_ROWS
): void {
  drawPackedDisplayToCanvas(ctx, packed, width, height, 'fit', cols, rows);
}
