import type { PixelArtKey } from '../game/types';

export type Pixel = string | null;
export type PixelGrid = Pixel[][];

const R = '#c44';
const D = '#422';
const G = '#6a8';
const B = '#48c';
const Y = '#ec4';
const W = '#fff';
const K = '#222';
const P = '#e8589a';
const H = '#8b5';
const GL = '#5ecf7a';
const DK = '#3a2518';

const BASE_ART: Record<PixelArtKey, PixelGrid> = {
  generic: [
    [null, null, G, G, G, G, null, null],
    [null, G, G, G, G, G, G, null],
    [G, G, W, G, G, W, G, G],
    [G, G, G, G, G, G, G, G],
    [null, G, G, G, G, G, G],
    [null, null, G, G, G, null],
  ],
  lvbu: [
    [null, null, Y, Y, Y, null, null, null],
    [null, Y, R, R, R, Y, null, null],
    [null, R, W, K, W, R, null, null],
    [null, R, R, R, R, R, null, null],
    [D, R, R, R, R, R, D, null],
    [D, D, R, R, R, D, D, null],
    [null, K, K, null, K, K, null, null],
    [null, K, K, null, K, K, null, null],
  ],
  liu: [
    [null, G, G, G, G, null],
    [G, W, G, G, W, G],
    [G, G, G, G, G, G],
    [null, G, H, H, G, null],
    [null, G, G, G, null],
  ],
  guan: [
    [null, G, G, G, null],
    [G, G, W, G, G],
    [G, R, G, R, G],
    [null, G, G, G, null],
    [null, G, B, G, null],
  ],
  zhang: [
    [null, K, K, K, null],
    [K, W, K, W, K],
    [K, K, R, K, K],
    [null, K, K, K, null],
    [K, K, null, K, K],
  ],
  'heal-potion': [
    [null, null, P, P, P, null, null],
    [null, P, W, W, W, P, null],
    [null, P, B, B, B, P, null],
    [null, P, B, B, B, P, null],
    [null, P, P, P, P, P, null],
    [null, null, GL, GL, GL, null, null],
    [null, null, DK, DK, DK, null, null],
  ],
  fangtian: [
    [null, null, Y, null, null],
    [null, Y, Y, Y, null],
    [null, null, K, null, null],
    [null, null, K, null, null],
    [K, K, K, K, K],
    [null, null, K, null, null],
  ],
};

const customOverrides: Partial<Record<PixelArtKey, PixelGrid>> = {};

export const PIXEL_ART_KEYS = Object.keys(BASE_ART) as PixelArtKey[];

export function getArtGrid(key: PixelArtKey): PixelGrid {
  const custom = customOverrides[key];
  if (custom) return custom.map((row) => [...row]);
  return BASE_ART[key] ?? BASE_ART.generic;
}

export function setCustomArtGrid(key: PixelArtKey, grid: PixelGrid): void {
  customOverrides[key] = grid.map((row) => [...row]);
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

/**
 * 将像素网格铺满整个画布（上下左右贴边）。
 * 格元可非正方形，以填满 width×height。
 */
export function drawGridToCanvas(
  ctx: CanvasRenderingContext2D,
  grid: PixelGrid,
  width: number,
  height: number
): void {
  const { cols, rows } = gridDimensions(grid);
  const cellW = width / cols;
  const cellH = height / rows;

  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
    }
  }
}

export interface DrawPixelArtOptions {
  transparent?: boolean;
}

export function drawPixelArt(
  ctx: CanvasRenderingContext2D,
  key: PixelArtKey,
  width: number,
  height: number,
  options: DrawPixelArtOptions = {}
): void {
  const { transparent = false } = options;
  ctx.clearRect(0, 0, width, height);

  if (!transparent) {
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, '#2a3a52');
    bg.addColorStop(1, '#1a2438');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
  }

  drawGridToCanvas(ctx, getArtGrid(key), width, height);
}
