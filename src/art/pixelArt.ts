import type { PixelArtKey } from '../game/types';

export type Pixel = string | null;
export type PixelGrid = Pixel[][];

/** 全卡牌统一像素图：16×22，中心 4×4 蓝色块（由 scripts/set-unified-card-art.mjs 生成） */
const UNIFIED_CARD_ART: PixelGrid = [
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, "rgba(0,78,255,1.00)", "rgba(0,78,255,1.00)", "rgba(0,78,255,1.00)", "rgba(0,78,255,1.00)", null, null, null, null, null],
    [null, null, null, null, null, null, null, "rgba(0,78,255,1.00)", "rgba(0,78,255,1.00)", "rgba(0,78,255,1.00)", "rgba(0,78,255,1.00)", null, null, null, null, null],
    [null, null, null, null, null, null, null, "rgba(0,78,255,1.00)", "rgba(0,78,255,1.00)", "rgba(0,78,255,1.00)", "rgba(0,78,255,1.00)", null, null, null, null, null],
    [null, null, null, null, null, null, null, "rgba(0,78,255,1.00)", "rgba(0,78,255,1.00)", "rgba(0,78,255,1.00)", "rgba(0,78,255,1.00)", null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
  ];

function cloneGrid(grid: PixelGrid): PixelGrid {
  return grid.map((row) => [...row]);
}

const BASE_ART: Record<PixelArtKey, PixelGrid> = {
  'generic': cloneGrid(UNIFIED_CARD_ART),
  'lvbu': cloneGrid(UNIFIED_CARD_ART),
  'liu': cloneGrid(UNIFIED_CARD_ART),
  'guan': cloneGrid(UNIFIED_CARD_ART),
  'zhang': cloneGrid(UNIFIED_CARD_ART),
  'heal-potion': cloneGrid(UNIFIED_CARD_ART),
  'fangtian': cloneGrid(UNIFIED_CARD_ART),
  'attack-red': cloneGrid(UNIFIED_CARD_ART),
  'attack-orange': cloneGrid(UNIFIED_CARD_ART),
  'attack-purple': cloneGrid(UNIFIED_CARD_ART),
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

/** 将像素网格铺满画布；支持 #rgb / #rrggbb / #rrggbbaa / rgba() */
export function drawGridToCanvas(
  ctx: CanvasRenderingContext2D,
  grid: PixelGrid,
  width: number,
  height: number
): void {
  const { cols, rows } = gridDimensions(grid);
  const cellW = width / cols;
  const cellH = height / rows;
  ctx.imageSmoothingEnabled = false;

  for (let y = 0; y < grid.length; y++) {
    const row = grid[y];
    for (let x = 0; x < row.length; x++) {
      const c = row[x];
      if (!c) continue;
      const { r, g, b, a } = parsePixelColor(c);
      ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
      const px = Math.round(x * cellW);
      const py = Math.round(y * cellH);
      const px2 = Math.round((x + 1) * cellW);
      const py2 = Math.round((y + 1) * cellH);
      ctx.fillRect(px, py, Math.max(1, px2 - px), Math.max(1, py2 - py));
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
