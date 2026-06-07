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
  | 'removeBg'
  | 'sharpen'
  | 'deblack'
  | 'vivid'
  | 'soft'
  | 'contrast'
  | 'warm'
  | 'cool'
  | 'brightness';

/** 各效果强度 0–100，可叠加调配 */
export type PixelImportEffectMix = Record<Exclude<PixelImportEffect, 'standard'>, number>;

export interface PixelImportEffectOption {
  id: PixelImportEffect;
  label: string;
  description: string;
}

export const PIXEL_IMPORT_EFFECTS: PixelImportEffectOption[] = [
  { id: 'removeBg', label: '去背景', description: '四角取色 + 边缘泛洪，滑条为颜色容差' },
  { id: 'sharpen', label: '锐化', description: '强化边缘与对比' },
  { id: 'deblack', label: '去深色点', description: '滑条为颜色深度阈值，扫雷式去除孤立深色噪点' },
  { id: 'vivid', label: '鲜明', description: '提升饱和度与层次' },
  { id: 'soft', label: '柔化', description: '轻微混合邻色，更平滑' },
  { id: 'contrast', label: '高对比', description: '拉开明暗层次' },
  { id: 'warm', label: '暖色', description: '偏暖色调' },
  { id: 'cool', label: '冷色', description: '偏冷色调' },
  { id: 'brightness', label: '亮度', description: '整体提亮、色彩更明亮' },
];

const MIX_EFFECT_ORDER: Exclude<PixelImportEffect, 'standard'>[] = [
  'removeBg',
  'deblack',
  'soft',
  'sharpen',
  'contrast',
  'vivid',
  'warm',
  'cool',
  'brightness',
];

export function createDefaultEffectMix(): PixelImportEffectMix {
  return {
    removeBg: 0,
    sharpen: 0,
    deblack: 0,
    vivid: 0,
    soft: 0,
    contrast: 0,
    warm: 0,
    cool: 0,
    brightness: 0,
  };
}

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

/** 深色判定默认阈值（亮度，0–255） */
const DARK_PIXEL_LUMINANCE_DEFAULT = 54;

/** 滑条 1–100 → 亮度阈值（约 16–200，越高越易判定为深色） */
export function deblackSliderToLuminanceThreshold(sliderValue: number): number {
  if (sliderValue <= 0) return 0;
  return Math.max(16, Math.round(16 + (sliderValue / 100) * 184));
}

function pixelLuminance(rgba: Rgba): number {
  return 0.299 * rgba.r + 0.587 * rgba.g + 0.114 * rgba.b;
}

/** 深色像素：亮度低于阈值且有一定不透明度 */
function isDarkPixel(rgba: Rgba, threshold = DARK_PIXEL_LUMINANCE_DEFAULT): boolean {
  return rgba.a > 0.08 && pixelLuminance(rgba) <= threshold;
}

/** 八邻域（扫雷式，不含自身） */
function neighbor8Rgba(grid: PixelGrid, x: number, y: number): Rgba[] {
  return neighborRgba(grid, x, y, 1);
}

function hasDarkNeighbor8(
  grid: PixelGrid,
  x: number,
  y: number,
  threshold = DARK_PIXEL_LUMINANCE_DEFAULT
): boolean {
  for (const px of neighbor8Rgba(grid, x, y)) {
    if (isDarkPixel(px, threshold)) return true;
  }
  return false;
}

function colorBucketKey(rgba: Rgba): string {
  const q = 4;
  return `${rgba.r >> q},${rgba.g >> q},${rgba.b >> q}`;
}

/** 取八邻域中出现次数最多的色相近组，再求该组均值 */
function majorityNeighborAverage(neighbors: Rgba[]): Rgba | null {
  if (neighbors.length === 0) return null;
  const buckets = new Map<string, Rgba[]>();
  for (const px of neighbors) {
    const key = colorBucketKey(px);
    const group = buckets.get(key) ?? [];
    group.push(px);
    buckets.set(key, group);
  }
  let best: Rgba[] | null = null;
  for (const group of buckets.values()) {
    if (!best || group.length > best.length) best = group;
  }
  return averageRgba(best ?? neighbors);
}

function gridsEqual(a: PixelGrid, b: PixelGrid): boolean {
  if (a.length !== b.length) return false;
  for (let y = 0; y < a.length; y++) {
    const rowA = a[y] ?? [];
    const rowB = b[y] ?? [];
    if (rowA.length !== rowB.length) return false;
    for (let x = 0; x < rowA.length; x++) {
      if (rowA[x] !== rowB[x]) return false;
    }
  }
  return true;
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

/**
 * 去黑点（单遍）：扫雷式检查八邻域。
 * 若当前为深色且周围 8 格均无深色，则用邻域主色组的平均值替换。
 */
function deblackPass(grid: PixelGrid, threshold = DARK_PIXEL_LUMINANCE_DEFAULT): PixelGrid {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const out = cloneGrid(grid);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const center = getPixel(grid, x, y);
      if (!center || !isDarkPixel(center, threshold)) continue;
      if (hasDarkNeighbor8(grid, x, y, threshold)) continue;

      const neighbors = neighbor8Rgba(grid, x, y).filter((n) => !isDarkPixel(n, threshold));
      const replacement = majorityNeighborAverage(neighbors) ?? averageRgba(neighbor8Rgba(grid, x, y));
      if (!replacement) {
        out[y]![x] = null;
        continue;
      }

      out[y]![x] = toPixel({
        r: clampByte(replacement.r),
        g: clampByte(replacement.g),
        b: clampByte(replacement.b),
        a: center.a * 0.25 + replacement.a * 0.75,
      });
    }
  }
  return out;
}

/** 滑条 1–100 → RGB 欧氏容差（约 10–82，越大越易判定为背景） */
export function removeBgSliderToTolerance(sliderValue: number): number {
  if (sliderValue <= 0) return 0;
  return Math.max(10, Math.round(10 + (sliderValue / 100) * 72));
}

function rgbaDistance(a: Rgba, b: Rgba): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** 四角 3×3 采样，取出现最多的色相近组作为背景参考色 */
function estimateCornerBackgroundColor(grid: PixelGrid): Rgba | null {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  if (cols === 0 || rows === 0) return null;

  const buckets = new Map<string, { color: Rgba; count: number }>();
  const corners: [number, number][] = [
    [0, 0],
    [cols - 1, 0],
    [0, rows - 1],
    [cols - 1, rows - 1],
  ];

  for (const [cx, cy] of corners) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = getPixel(grid, cx + dx, cy + dy);
        if (!px || px.a < 0.08) continue;
        const key = colorBucketKey(px);
        const entry = buckets.get(key);
        if (entry) entry.count++;
        else buckets.set(key, { color: px, count: 1 });
      }
    }
  }

  let best: { color: Rgba; count: number } | null = null;
  for (const entry of buckets.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best?.color ?? null;
}

/**
 * 去背景：从四边泛洪，邻格颜色接近则视为背景。
 * 支持纯色底与轻微渐变（与父格比较 + 与角点参考色比较）。
 */
function removeBgGrid(grid: PixelGrid, tolerance: number): PixelGrid {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  if (cols === 0 || rows === 0 || tolerance <= 0) return cloneGrid(grid);

  const bgEst = estimateCornerBackgroundColor(grid);
  if (!bgEst) return cloneGrid(grid);
  const bgRef: Rgba = bgEst;

  const isBg: boolean[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => false)
  );
  const queue: [number, number][] = [];
  const linkTol = tolerance * 0.72;

  function trySeed(x: number, y: number): void {
    const px = getPixel(grid, x, y);
    if (!px || px.a < 0.08 || isBg[y]![x]!) return;
    if (rgbaDistance(px, bgRef) > tolerance) return;
    isBg[y]![x] = true;
    queue.push([x, y]);
  }

  for (let x = 0; x < cols; x++) {
    trySeed(x, 0);
    trySeed(x, rows - 1);
  }
  for (let y = 0; y < rows; y++) {
    trySeed(0, y);
    trySeed(cols - 1, y);
  }

  const dirs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    const cur = getPixel(grid, x, y);
    if (!cur) continue;

    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (ny < 0 || ny >= rows || nx < 0 || nx >= cols || isBg[ny]![nx]!) continue;
      const npx = getPixel(grid, nx, ny);
      if (!npx || npx.a < 0.08) continue;
      if (rgbaDistance(npx, cur) <= linkTol || rgbaDistance(npx, bgRef) <= tolerance) {
        isBg[ny]![nx] = true;
        queue.push([nx, ny]);
      }
    }
  }

  const out = cloneGrid(grid);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (isBg[y]![x]) out[y]![x] = null;
    }
  }
  return out;
}

/** 去深色点：多遍二次处理，清除连锁孤立深色噪点 */
function deblackGrid(grid: PixelGrid, threshold = DARK_PIXEL_LUMINANCE_DEFAULT): PixelGrid {
  let result = cloneGrid(grid);
  const maxPasses = 4;
  for (let pass = 0; pass < maxPasses; pass++) {
    const next = deblackPass(result, threshold);
    if (gridsEqual(result, next)) break;
    result = next;
  }
  return result;
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

function brightnessGrid(grid: PixelGrid, strength: number): PixelGrid {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const out = cloneGrid(grid);
  const t = Math.max(0, Math.min(1, strength));
  const gain = 1 + t * 1.15;
  const lift = t * 42;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const center = getPixel(grid, x, y);
      if (!center) continue;

      out[y]![x] = toPixel({
        r: clampByte(center.r * gain + lift),
        g: clampByte(center.g * gain + lift),
        b: clampByte(center.b * gain + lift),
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

function lerpRgba(a: Rgba, b: Rgba, t: number): Rgba {
  const u = Math.max(0, Math.min(1, t));
  return {
    r: clampByte(a.r + (b.r - a.r) * u),
    g: clampByte(a.g + (b.g - a.g) * u),
    b: clampByte(a.b + (b.b - a.b) * u),
    a: a.a + (b.a - a.a) * u,
  };
}

function lerpGrids(base: PixelGrid, target: PixelGrid, t: number): PixelGrid {
  const rows = Math.max(base.length, target.length);
  const cols = Math.max(
    0,
    ...base.map((r) => r.length),
    ...target.map((r) => r.length)
  );
  const out: PixelGrid = [];
  const u = Math.max(0, Math.min(1, t));

  for (let y = 0; y < rows; y++) {
    const row: Pixel[] = [];
    for (let x = 0; x < cols; x++) {
      const a = getPixel(base, x, y);
      const b = getPixel(target, x, y);
      if (!a && !b) {
        row.push(null);
        continue;
      }
      if (!a) {
        row.push(u >= 1 ? (target[y]?.[x] ?? null) : null);
        continue;
      }
      if (!b) {
        row.push(u <= 0 ? (base[y]?.[x] ?? null) : null);
        continue;
      }
      row.push(toPixel(lerpRgba(a, b, u)));
    }
    out.push(row);
  }
  return out;
}

export function applyPixelImportEffect(grid: PixelGrid, effect: PixelImportEffect): PixelGrid {
  switch (effect) {
    case 'removeBg':
      return removeBgGrid(grid, removeBgSliderToTolerance(50));
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
    case 'brightness':
      return brightnessGrid(grid, 1);
    case 'standard':
    default:
      return cloneGrid(grid);
  }
}

/** 按滑条强度叠加多种效果（0=原图，可自由组合；去深色点为深度阈值） */
export function applyPixelImportMix(display: PixelGrid, mix: PixelImportEffectMix): PixelGrid {
  let result = cloneGrid(display);
  for (const id of MIX_EFFECT_ORDER) {
    const strength = mix[id] ?? 0;
    if (strength <= 0) continue;
    if (id === 'removeBg') {
      result = removeBgGrid(result, removeBgSliderToTolerance(strength));
      continue;
    }
    if (id === 'deblack') {
      result = deblackGrid(result, deblackSliderToLuminanceThreshold(strength));
      continue;
    }
    const t = strength / 100;
    const next =
      id === 'brightness'
        ? brightnessGrid(result, t)
        : applyPixelImportEffect(result, id);
    result = lerpGrids(result, next, t);
  }
  return result;
}

export function describeEffectMix(mix: PixelImportEffectMix): string {
  const parts: string[] = [];
  for (const o of PIXEL_IMPORT_EFFECTS) {
    const v = mix[o.id as keyof PixelImportEffectMix] ?? 0;
    if (v <= 0) continue;
    if (o.id === 'removeBg') {
      parts.push(`${o.label} 容差${removeBgSliderToTolerance(v)}`);
    } else if (o.id === 'deblack') {
      parts.push(`${o.label} 深度${deblackSliderToLuminanceThreshold(v)}`);
    } else {
      parts.push(`${o.label} ${v}%`);
    }
  }
  return parts.length === 0 ? '原图' : parts.join(' · ');
}

const THRESHOLD_SLIDER_EFFECTS = new Set<Exclude<PixelImportEffect, 'standard'>>([
  'removeBg',
  'deblack',
]);

export function isThresholdImportEffect(
  id: Exclude<PixelImportEffect, 'standard'>
): boolean {
  return THRESHOLD_SLIDER_EFFECTS.has(id);
}

export function formatImportEffectSliderValue(
  effect: Exclude<PixelImportEffect, 'standard'>,
  sliderValue: number
): string {
  if (sliderValue <= 0 && isThresholdImportEffect(effect)) return '关';
  switch (effect) {
    case 'removeBg':
      return `容差${removeBgSliderToTolerance(sliderValue)}`;
    case 'deblack':
      return `深度${deblackSliderToLuminanceThreshold(sliderValue)}`;
    default:
      return String(sliderValue);
  }
}

/** @deprecated 使用 formatImportEffectSliderValue */
export function formatDeblackSliderValue(sliderValue: number): string {
  return formatImportEffectSliderValue('deblack', sliderValue);
}

/** 逻辑网格 → 卡面展示网格（60×84） */
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

/** 在 60×84 展示网格上按混合参数处理，供预览与落盘 */
export function applyPixelImportMixOnDisplay(
  grid: PixelGrid,
  mix: PixelImportEffectMix
): PixelGrid {
  const display = logicalGridToDisplayGrid(grid);
  return applyPixelImportMix(display, mix);
}

/** 导入落盘：展示级混合效果 → 展开为 500×700 逻辑网格 */
export function applyPixelImportMixForEditor(
  grid: PixelGrid,
  mix: PixelImportEffectMix
): PixelGrid {
  const processed = applyPixelImportMixOnDisplay(grid, mix);
  return displayGridToLogicalGrid(processed);
}
