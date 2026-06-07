import {
  ART_DISPLAY_COLS,
  ART_DISPLAY_ROWS,
  ART_GRID_COLS,
  ART_GRID_ROWS,
} from './gridConfig';
import {
  downsamplePackedGrid,
  downsamplePackedGridMajority,
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
  {
    id: 'removeBg',
    label: '去背景',
    description: '边缘三层色组 + 连通至边缘判定背景，调节容差与方案',
  },
  { id: 'sharpen', label: '锐化', description: '细节与边缘区域优先强化' },
  { id: 'deblack', label: '去深色点', description: '滑条为颜色深度阈值，扫雷式去除孤立深色噪点' },
  { id: 'vivid', label: '鲜明', description: '细节区域优先提升饱和度' },
  { id: 'soft', label: '柔化', description: '平滑区域优先混合邻色，保留主体边缘' },
  { id: 'contrast', label: '高对比', description: '细节区域优先拉开明暗' },
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

/** 局部细节权重 0–1：邻域色差越大（边缘/纹理）越高 */
function localDetailWeight(grid: PixelGrid, x: number, y: number): number {
  const neighbors = neighborRgba(grid, x, y, 1);
  if (neighbors.length === 0) return 0;
  const avg = averageRgba(neighbors);
  if (!avg) return 0;
  let spread = 0;
  for (const px of neighbors) {
    spread += rgbaDistance(px, avg);
  }
  spread /= neighbors.length;
  return Math.max(0, Math.min(1, spread / 34));
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

      const detail = localDetailWeight(grid, x, y);
      const amount = 0.38 + 0.58 * detail;
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

export function formatRemoveBgSliderValue(sliderValue: number): string {
  if (sliderValue <= 0) return '关';
  return `容差${removeBgSliderToTolerance(sliderValue)}`;
}

/** 去背景方案 */
export type RemoveBgMode = 'edge' | 'gapFill';

/** 兼容历史撤销记录中的旧方案名 */
export type RemoveBgModeInput = RemoveBgMode | 'outer' | 'outerSafe' | 'outerFringe' | 'outerCorner' | 'outerFull';

export interface RemoveBgModeOption {
  id: RemoveBgMode;
  label: string;
  description: string;
}

export const REMOVE_BG_MODES: RemoveBgModeOption[] = [
  {
    id: 'edge',
    label: '边缘连通',
    description: '属于边缘三层色组、且可沿相似色连通至画面边缘的像素视为背景',
  },
  {
    id: 'gapFill',
    label: '缝隙填充',
    description: '边缘连通基础上，填充肢体缝隙内同属边缘色组的小片',
  },
];

export const DEFAULT_REMOVE_BG_MODE: RemoveBgMode = 'edge';

export function normalizeRemoveBgMode(mode: RemoveBgModeInput): RemoveBgMode {
  if (mode === 'gapFill' || mode === 'outerCorner' || mode === 'outerFull') return 'gapFill';
  return 'edge';
}

export function getRemoveBgModeLabel(mode: RemoveBgModeInput): string {
  const id = normalizeRemoveBgMode(mode);
  return REMOVE_BG_MODES.find((m) => m.id === id)?.label ?? id;
}

export interface PixelImportMixOptions {
  removeBgMode?: RemoveBgModeInput;
}

function rgbaDistance(a: Rgba, b: Rgba): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

const NEIGHBOR8_DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

// --- 去背景：边缘三层色组 + 边缘连通泛洪（精简管线）---

const EDGE_SAMPLE_LAYERS = 3;

interface BgColorModel {
  edgePalette: Rgba[];
  interiorPalette: Rgba[];
}

function cloneMask(mask: boolean[][]): boolean[][] {
  return mask.map((row) => [...row]);
}

function countNonBgNeighbors8(mask: boolean[][], x: number, y: number): number {
  let count = 0;
  for (const [dx, dy] of NEIGHBOR8_DIRS) {
    const ny = y + dy;
    const nx = x + dx;
    if (ny < 0 || ny >= mask.length || nx < 0 || nx >= (mask[ny]?.length ?? 0)) continue;
    if (!mask[ny]![nx]) count++;
  }
  return count;
}

function nearestPaletteDistance(px: Rgba, palette: Rgba[]): number {
  if (palette.length === 0) return Number.POSITIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  for (const ref of palette) {
    const d = rgbaDistance(px, ref);
    if (d < min) min = d;
  }
  return min;
}

function sampleColorBuckets(
  grid: PixelGrid,
  coords: Iterable<[number, number]>
): Map<string, { color: Rgba; count: number }> {
  const buckets = new Map<string, { color: Rgba; count: number }>();
  for (const [x, y] of coords) {
    const px = getPixel(grid, x, y);
    if (!px || px.a < 0.08) continue;
    const key = colorBucketKey(px);
    const entry = buckets.get(key);
    if (entry) entry.count++;
    else buckets.set(key, { color: px, count: 1 });
  }
  return buckets;
}

function bucketsToPalette(
  buckets: Map<string, { color: Rgba; count: number }>,
  maxColors: number
): Rgba[] {
  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, maxColors)
    .map((b) => b.color);
}

function* edgeLayerCoords(cols: number, rows: number, layers: number): Generator<[number, number]> {
  for (let layer = 0; layer < layers; layer++) {
    for (let x = 0; x < cols; x++) {
      yield [x, layer];
      yield [x, rows - 1 - layer];
    }
    for (let y = 0; y < rows; y++) {
      yield [layer, y];
      yield [cols - 1 - layer, y];
    }
  }
}

function* centerRegionCoords(cols: number, rows: number): Generator<[number, number]> {
  const x0 = Math.floor(cols * 0.28);
  const x1 = Math.ceil(cols * 0.72);
  const y0 = Math.floor(rows * 0.28);
  const y1 = Math.ceil(rows * 0.72);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      yield [x, y];
    }
  }
}

/** 构建边缘三层色组与主体内侧色组 */
function buildBgColorModel(grid: PixelGrid): BgColorModel | null {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  if (cols === 0 || rows === 0) return null;

  const edgeBuckets = sampleColorBuckets(grid, edgeLayerCoords(cols, rows, EDGE_SAMPLE_LAYERS));
  const edgePalette = bucketsToPalette(edgeBuckets, 16);
  if (edgePalette.length === 0) return null;

  const interiorBuckets = sampleColorBuckets(grid, centerRegionCoords(cols, rows));
  const interiorPalette = bucketsToPalette(interiorBuckets, 12);

  return { edgePalette, interiorPalette };
}

/**
 * 像素是否属于背景色：接近边缘色组，且不比主体内侧色组更接近。
 */
function isBackgroundColor(px: Rgba, model: BgColorModel, tolerance: number): boolean {
  const edgeDist = nearestPaletteDistance(px, model.edgePalette);
  if (edgeDist > tolerance) return false;
  if (model.interiorPalette.length === 0) return true;

  const interiorDist = nearestPaletteDistance(px, model.interiorPalette);
  return edgeDist <= interiorDist;
}

function createEmptyMask(rows: number, cols: number): boolean[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
}

/**
 * 从四边三层、属于边缘色组的像素出发，仅沿相邻色差与色组约束扩展至连通区域。
 */
function floodEdgeConnectedBackground(
  grid: PixelGrid,
  model: BgColorModel,
  tolerance: number
): boolean[][] {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const mask = createEmptyMask(rows, cols);
  const queue: [number, number][] = [];
  const linkTol = tolerance * 0.75;

  function seed(x: number, y: number): void {
    const px = getPixel(grid, x, y);
    if (!px || px.a < 0.08 || mask[y]![x]) return;
    if (!isBackgroundColor(px, model, tolerance)) return;
    mask[y]![x] = true;
    queue.push([x, y]);
  }

  for (const [x, y] of edgeLayerCoords(cols, rows, EDGE_SAMPLE_LAYERS)) {
    seed(x, y);
  }

  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    const cur = getPixel(grid, x, y);
    if (!cur) continue;

    for (const [dx, dy] of NEIGHBOR8_DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (ny < 0 || ny >= rows || nx < 0 || nx >= cols || mask[ny]![nx]) continue;
      const npx = getPixel(grid, nx, ny);
      if (!npx || npx.a < 0.08) continue;
      if (rgbaDistance(npx, cur) > linkTol) continue;
      if (!isBackgroundColor(npx, model, tolerance)) continue;
      mask[ny]![nx] = true;
      queue.push([nx, ny]);
    }
  }

  return mask;
}

/** 填充肢体缝隙：同属边缘色组、被主体紧密包围、且未被边缘连通覆盖 */
function fillEnclosedBackgroundGaps(
  mask: boolean[][],
  grid: PixelGrid,
  model: BgColorModel,
  tolerance: number
): boolean[][] {
  const rows = mask.length;
  const cols = Math.max(0, ...mask.map((r) => r.length));
  const gapTol = tolerance * 0.88;
  let out = cloneMask(mask);

  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    const next = cloneMask(out);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (next[y]![x]) continue;
        const px = getPixel(grid, x, y);
        if (!px || px.a < 0.08) continue;
        if (!isBackgroundColor(px, model, gapTol)) continue;
        if (countNonBgNeighbors8(out, x, y) < 6) continue;
        next[y]![x] = true;
        changed = true;
      }
    }
    out = next;
    if (!changed) break;
  }

  return out;
}

function buildRemoveBgMask(grid: PixelGrid, tolerance: number, fillGaps: boolean): boolean[][] | null {
  const model = buildBgColorModel(grid);
  if (!model) return null;

  let mask = floodEdgeConnectedBackground(grid, model, tolerance);
  if (fillGaps) {
    mask = fillEnclosedBackgroundGaps(mask, grid, model, tolerance);
  }
  return mask;
}

/** 计算去背景掩码 */
export function computeRemoveBgMask(
  grid: PixelGrid,
  tolerance: number,
  mode: RemoveBgModeInput = DEFAULT_REMOVE_BG_MODE
): boolean[][] | null {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  if (cols === 0 || rows === 0 || tolerance <= 0) return null;

  const normalized = normalizeRemoveBgMode(mode);
  return buildRemoveBgMask(grid, tolerance, normalized === 'gapFill');
}

function applyRemoveBgMask(grid: PixelGrid, mask: boolean[][]): PixelGrid {
  const out = cloneGrid(grid);
  for (let y = 0; y < mask.length; y++) {
    for (let x = 0; x < (mask[y]?.length ?? 0); x++) {
      if (mask[y]![x]) out[y]![x] = null;
    }
  }
  return out;
}

function removeBgGrid(
  grid: PixelGrid,
  tolerance: number,
  maskSource?: PixelGrid,
  mode: RemoveBgModeInput = DEFAULT_REMOVE_BG_MODE
): PixelGrid {
  const source = maskSource ?? grid;
  const mask = computeRemoveBgMask(source, tolerance, mode);
  if (!mask) return cloneGrid(grid);
  return applyRemoveBgMask(grid, mask);
}

export function clonePixelImportMix(mix: PixelImportEffectMix): PixelImportEffectMix {
  return { ...createDefaultEffectMix(), ...mix };
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

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const center = getPixel(grid, x, y);
      if (!center) continue;

      const detail = localDetailWeight(grid, x, y);
      const contrast = 1 + 0.18 * detail;
      const satBoost = 1 + 0.42 * detail;

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

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const center = getPixel(grid, x, y);
      if (!center) continue;
      const avg = averageRgba(neighborRgba(grid, x, y));
      if (!avg) continue;

      const detail = localDetailWeight(grid, x, y);
      const mix = 0.18 + 0.34 * (1 - detail);

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

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const center = getPixel(grid, x, y);
      if (!center) continue;

      const detail = localDetailWeight(grid, x, y);
      const contrast = 1 + 0.32 * detail;

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
export function applyPixelImportMix(
  display: PixelGrid,
  mix: PixelImportEffectMix,
  mattingGrid?: PixelGrid | null,
  options?: PixelImportMixOptions
): PixelGrid {
  const removeBgMode = options?.removeBgMode ?? DEFAULT_REMOVE_BG_MODE;
  let result = cloneGrid(display);
  for (const id of MIX_EFFECT_ORDER) {
    const strength = mix[id] ?? 0;
    if (strength <= 0) continue;
    if (id === 'removeBg') {
      result = removeBgGrid(
        result,
        removeBgSliderToTolerance(strength),
        mattingGrid ?? undefined,
        removeBgMode
      );
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

export function describeEffectMix(
  mix: PixelImportEffectMix,
  options?: PixelImportMixOptions
): string {
  const removeBgMode = options?.removeBgMode ?? DEFAULT_REMOVE_BG_MODE;
  const parts: string[] = [];
  for (const o of PIXEL_IMPORT_EFFECTS) {
    const v = mix[o.id as keyof PixelImportEffectMix] ?? 0;
    if (v <= 0) continue;
    if (o.id === 'removeBg') {
      parts.push(
        `${o.label} ${getRemoveBgModeLabel(removeBgMode)} 容差${removeBgSliderToTolerance(v)}`
      );
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

/** 逻辑网格 → 展示网格（块内多数色，专供去背景算掩码，减少取样条纹） */
export function logicalGridToDisplayGridMatting(grid: PixelGrid): PixelGrid {
  const packed = gridToPacked(grid, ART_GRID_COLS, ART_GRID_ROWS);
  const displayPacked = downsamplePackedGridMajority(
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
  mix: PixelImportEffectMix,
  options?: PixelImportMixOptions
): PixelGrid {
  const display = logicalGridToDisplayGrid(grid);
  const matting =
    (mix.removeBg ?? 0) > 0 ? logicalGridToDisplayGridMatting(grid) : null;
  return applyPixelImportMix(display, mix, matting, options);
}

/** 导入落盘：展示级混合效果 → 展开为 500×700 逻辑网格 */
export function applyPixelImportMixForEditor(
  grid: PixelGrid,
  mix: PixelImportEffectMix,
  options?: PixelImportMixOptions
): PixelGrid {
  const processed = applyPixelImportMixOnDisplay(grid, mix, options);
  return displayGridToLogicalGrid(processed);
}
