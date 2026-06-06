import {
  ART_DISPLAY_COLS,
  ART_DISPLAY_ROWS,
  ART_GRID_COLS,
  ART_GRID_ROWS,
} from './gridConfig';
import {
  downsamplePackedGrid,
  gridToPacked,
  packedToGrid,
} from './packedGrid';
import type { Pixel, PixelGrid } from './pixelArt';

export type PixelImportEffect =
  | 'standard'
  | 'sharpen'
  | 'deblack'
  | 'vivid'
  | 'soft'
  | 'contrast'
  | 'warm'
  | 'cool';

export interface PixelImportEffectOption {
  id: PixelImportEffect;
  label: string;
  description: string;
}

export const PIXEL_IMPORT_EFFECTS: PixelImportEffectOption[] = [
  { id: 'standard', label: '标准', description: '保持采样原貌' },
  { id: 'sharpen', label: '锐化', description: '强化边缘与对比' },
  { id: 'deblack', label: '去黑点', description: '去除孤立黑色噪点' },
  { id: 'vivid', label: '鲜明', description: '提升饱和度与层次' },
  { id: 'soft', label: '柔化', description: '轻微混合邻色，更平滑' },
  { id: 'contrast', label: '高对比', description: '拉开明暗层次' },
  { id: 'warm', label: '暖色', description: '偏暖色调' },
  { id: 'cool', label: '冷色', description: '偏冷色调' },
];

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parsePixel(c: Pixel): Rgba | null {
  if (!c) return null;
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
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((ch) => ch + ch)
      .join('');
  }
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }
  return null;
}

function toPixel(rgba: Rgba): Pixel {
  if (rgba.a < 0.04) return null;
  if (rgba.a >= 0.995) return `rgba(${rgba.r},${rgba.g},${rgba.b},1.00)`;
  return `rgba(${rgba.r},${rgba.g},${rgba.b},${rgba.a.toFixed(2)})`;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function cloneGrid(grid: PixelGrid): PixelGrid {
  return grid.map((row) => [...row]);
}

function getPixel(grid: PixelGrid, x: number, y: number): Rgba | null {
  if (y < 0 || y >= grid.length) return null;
  const row = grid[y];
  if (!row || x < 0 || x >= row.length) return null;
  return parsePixel(row[x] ?? null);
}

function neighborRgba(
  grid: PixelGrid,
  x: number,
  y: number,
  radius = 1
): Rgba[] {
  const out: Rgba[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      const px = getPixel(grid, x + dx, y + dy);
      if (px) out.push(px);
    }
  }
  return out;
}

function averageRgba(colors: Rgba[]): Rgba | null {
  if (colors.length === 0) return null;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sa = 0;
  for (const c of colors) {
    sr += c.r;
    sg += c.g;
    sb += c.b;
    sa += c.a;
  }
  const n = colors.length;
  return { r: sr / n, g: sg / n, b: sb / n, a: sa / n };
}

/** 近黑像素：RGB 均很低，专指黑点而非深灰/深色 */
function isBlackPixel(rgba: Rgba): boolean {
  return rgba.a > 0.08 && rgba.r <= 42 && rgba.g <= 42 && rgba.b <= 42;
}

function countBlackInWindow(
  grid: PixelGrid,
  x: number,
  y: number,
  radius: number
): number {
  let count = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = getPixel(grid, x + dx, y + dy);
      if (px && isBlackPixel(px)) count++;
    }
  }
  return count;
}

function sharpenGrid(grid: PixelGrid): PixelGrid {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const out = cloneGrid(grid);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const center = getPixel(grid, x, y);
      if (!center) continue;
      const neighbors = neighborRgba(grid, x, y);
      const avg = averageRgba(neighbors);
      if (!avg) continue;

      const amount = 0.82;
      out[y]![x] = toPixel({
        r: clampByte(center.r + amount * (center.r - avg.r)),
        g: clampByte(center.g + amount * (center.g - avg.g)),
        b: clampByte(center.b + amount * (center.b - avg.b)),
        a: center.a,
      });
    }
  }
  return out;
}

/** 去黑点：邻域内仅有一颗黑色像素时，用周围非黑色像素均值替换 */
function deblackGrid(grid: PixelGrid): PixelGrid {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const out = cloneGrid(grid);
  const radius = 2;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const center = getPixel(grid, x, y);
      if (!center || !isBlackPixel(center)) continue;
      if (countBlackInWindow(grid, x, y, radius) !== 1) continue;

      const neighbors = neighborRgba(grid, x, y, radius).filter((n) => !isBlackPixel(n));
      const avg = averageRgba(neighbors);
      if (!avg) {
        out[y]![x] = null;
        continue;
      }

      out[y]![x] = toPixel({
        r: clampByte(avg.r),
        g: clampByte(avg.g),
        b: clampByte(avg.b),
        a: center.a * 0.35 + avg.a * 0.65,
      });
    }
  }
  return out;
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d + 6) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h /= 6;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const mod = i % 6;
  if (mod === 0) return [v, t, p];
  if (mod === 1) return [q, v, p];
  if (mod === 2) return [p, v, t];
  if (mod === 3) return [p, q, v];
  if (mod === 4) return [t, p, v];
  return [v, p, q];
}

function vividGrid(grid: PixelGrid): PixelGrid {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const out = cloneGrid(grid);
  const satBoost = 1.42;
  const contrast = 1.18;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const center = getPixel(grid, x, y);
      if (!center) continue;

      let r = clampByte((center.r - 128) * contrast + 128);
      let g = clampByte((center.g - 128) * contrast + 128);
      let b = clampByte((center.b - 128) * contrast + 128);

      const [h, s, v] = rgbToHsv(r, g, b);
      const ns = Math.min(1, s * satBoost);
      const [nr, ng, nb] = hsvToRgb(h, ns, v).map((n) => clampByte(n * 255));

      out[y]![x] = toPixel({ r: nr, g: ng, b: nb, a: center.a });
    }
  }
  return out;
}

function softGrid(grid: PixelGrid): PixelGrid {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const out = cloneGrid(grid);
  const mix = 0.38;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const center = getPixel(grid, x, y);
      if (!center) continue;
      const avg = averageRgba(neighborRgba(grid, x, y));
      if (!avg) continue;

      out[y]![x] = toPixel({
        r: clampByte(center.r * (1 - mix) + avg.r * mix),
        g: clampByte(center.g * (1 - mix) + avg.g * mix),
        b: clampByte(center.b * (1 - mix) + avg.b * mix),
        a: center.a,
      });
    }
  }
  return out;
}

function contrastGrid(grid: PixelGrid): PixelGrid {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const out = cloneGrid(grid);
  const contrast = 1.32;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const center = getPixel(grid, x, y);
      if (!center) continue;

      out[y]![x] = toPixel({
        r: clampByte((center.r - 128) * contrast + 128),
        g: clampByte((center.g - 128) * contrast + 128),
        b: clampByte((center.b - 128) * contrast + 128),
        a: center.a,
      });
    }
  }
  return out;
}

function warmGrid(grid: PixelGrid): PixelGrid {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const out = cloneGrid(grid);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const center = getPixel(grid, x, y);
      if (!center) continue;

      out[y]![x] = toPixel({
        r: clampByte(center.r * 1.1 + 8),
        g: clampByte(center.g * 1.03 + 2),
        b: clampByte(center.b * 0.9),
        a: center.a,
      });
    }
  }
  return out;
}

function coolGrid(grid: PixelGrid): PixelGrid {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const out = cloneGrid(grid);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const center = getPixel(grid, x, y);
      if (!center) continue;

      out[y]![x] = toPixel({
        r: clampByte(center.r * 0.9),
        g: clampByte(center.g * 1.02 + 2),
        b: clampByte(center.b * 1.1 + 8),
        a: center.a,
      });
    }
  }
  return out;
}

export function applyPixelImportEffect(grid: PixelGrid, effect: PixelImportEffect): PixelGrid {
  switch (effect) {
    case 'sharpen':
      return sharpenGrid(grid);
    case 'deblack':
      return deblackGrid(grid);
    case 'vivid':
      return vividGrid(grid);
    case 'soft':
      return softGrid(grid);
    case 'contrast':
      return contrastGrid(grid);
    case 'warm':
      return warmGrid(grid);
    case 'cool':
      return coolGrid(grid);
    case 'standard':
    default:
      return cloneGrid(grid);
  }
}

/** 逻辑网格 → 卡面展示网格（75×105） */
export function logicalGridToDisplayGrid(grid: PixelGrid): PixelGrid {
  const packed = gridToPacked(grid, ART_GRID_COLS, ART_GRID_ROWS);
  const displayPacked = downsamplePackedGrid(
    packed,
    ART_GRID_COLS,
    ART_GRID_ROWS,
    ART_DISPLAY_COLS,
    ART_DISPLAY_ROWS
  );
  return packedToGrid(displayPacked, ART_DISPLAY_COLS, ART_DISPLAY_ROWS);
}

/** 展示网格 → 逻辑网格（每块填色，与编辑器 flatten 一致） */
export function displayGridToLogicalGrid(display: PixelGrid): PixelGrid {
  const out: PixelGrid = [];
  for (let y = 0; y < ART_GRID_ROWS; y++) {
    const row: Pixel[] = [];
    const dy = Math.min(
      ART_DISPLAY_ROWS - 1,
      Math.floor((y * ART_DISPLAY_ROWS) / ART_GRID_ROWS)
    );
    for (let x = 0; x < ART_GRID_COLS; x++) {
      const dx = Math.min(
        ART_DISPLAY_COLS - 1,
        Math.floor((x * ART_DISPLAY_COLS) / ART_GRID_COLS)
      );
      row.push(display[dy]?.[dx] ?? null);
    }
    out.push(row);
  }
  return out;
}

/** 在 75×105 展示网格上处理效果，供预览与落盘 */
export function applyPixelImportEffectOnDisplay(
  grid: PixelGrid,
  effect: PixelImportEffect
): PixelGrid {
  const display = logicalGridToDisplayGrid(grid);
  return applyPixelImportEffect(display, effect);
}

/** 导入落盘：展示级效果 → 展开为 500×700 逻辑网格 */
export function applyPixelImportEffectForEditor(
  grid: PixelGrid,
  effect: PixelImportEffect
): PixelGrid {
  const processed = applyPixelImportEffectOnDisplay(grid, effect);
  return displayGridToLogicalGrid(processed);
}
