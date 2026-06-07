import {
  ART_DISPLAY_COLS,
  ART_DISPLAY_ROWS,
  ART_GRID_COLS,
  ART_GRID_ROWS,
} from './gridConfig';
import {
  downsamplePackedGrid,
  downsamplePackedGridBucketMajority,
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
    description: 'Lab 感知容差 + 边缘参考色组，智能混合剥除背景',
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
  return getRemoveBgColorBucketKey(rgba.r, rgba.g, rgba.b);
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

/** 八邻域（不含自身）；若 8 格均不透明则返回，否则返回空 */
function neighbor8OpaqueRgba(grid: PixelGrid, x: number, y: number): Rgba[] {
  const out: Rgba[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const px = getPixel(grid, x + dx, y + dy);
      if (!px || px.a < 0.08) return [];
      out.push(px);
    }
  }
  return out.length === 8 ? out : [];
}

/**
 * 单遍内洞填色：透明格且八邻域均不透明时，用邻域主色组均值填补（与去深色点策略一致）。
 */
function fillEnclosedHolesPass(grid: PixelGrid): PixelGrid {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const out = cloneGrid(grid);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const center = getPixel(grid, x, y);
      if (center && center.a >= 0.08) continue;

      const neighbors = neighbor8OpaqueRgba(grid, x, y);
      if (neighbors.length !== 8) continue;

      const replacement = majorityNeighborAverage(neighbors) ?? averageRgba(neighbors);
      if (!replacement) continue;

      out[y]![x] = toPixel({
        r: clampByte(replacement.r),
        g: clampByte(replacement.g),
        b: clampByte(replacement.b),
        a: 1,
      });
    }
  }
  return out;
}

/** 多遍自外向内填补封闭透明内洞（如黑名单去除的独立背景色块） */
export function fillEnclosedTransparentHoles(grid: PixelGrid, maxPasses = 12): PixelGrid {
  let result = cloneGrid(grid);
  for (let pass = 0; pass < maxPasses; pass++) {
    const next = fillEnclosedHolesPass(result);
    if (gridsEqual(result, next)) break;
    result = next;
  }
  return result;
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

/** 滑条 1–100 → Lab ΔE76 容差（约 6–42，越大越易判定为背景） */
export function removeBgSliderToTolerance(sliderValue: number): number {
  if (sliderValue <= 0) return 0;
  return Math.max(6, Math.round(6 + (sliderValue / 100) * 36));
}

export function formatRemoveBgSliderValue(sliderValue: number): string {
  if (sliderValue <= 0) return '关';
  return `容差${removeBgSliderToTolerance(sliderValue)}`;
}

/** 去背景方案 */
export type RemoveBgMode = 'hybrid' | 'connected' | 'peel';

/** 兼容历史撤销记录中的旧方案名 */
export type RemoveBgModeInput =
  | RemoveBgMode
  | 'edge'
  | 'gapFill'
  | 'outer'
  | 'outerSafe'
  | 'outerFringe'
  | 'outerCorner'
  | 'outerFull';

export interface RemoveBgModeOption {
  id: RemoveBgMode;
  label: string;
  description: string;
}

export const REMOVE_BG_MODES: RemoveBgModeOption[] = [
  {
    id: 'hybrid',
    label: '智能混合',
    description: '边缘连通泛洪剥除外围背景，再按格距逐层清除主体内缝隙背景',
  },
  {
    id: 'connected',
    label: '边缘连通',
    description: '仅从画面边缘出发泛洪，只去除与边框连通的背景色块，不易误伤贴边主体',
  },
  {
    id: 'peel',
    label: '层层剥离',
    description: '按与画面边缘格距从外向内逐层扫描，清除落在边缘色组区间内的背景色块',
  },
];

export const DEFAULT_REMOVE_BG_MODE: RemoveBgMode = 'hybrid';

export function normalizeRemoveBgMode(mode: RemoveBgModeInput): RemoveBgMode {
  switch (mode) {
    case 'hybrid':
      return 'hybrid';
    case 'connected':
    case 'edge':
    case 'outer':
    case 'outerSafe':
    case 'outerFringe':
    case 'outerCorner':
    case 'outerFull':
      return 'connected';
    case 'peel':
    case 'gapFill':
      return 'peel';
    default:
      return DEFAULT_REMOVE_BG_MODE;
  }
}

export function getRemoveBgModeLabel(mode: RemoveBgModeInput): string {
  const id = normalizeRemoveBgMode(mode);
  return REMOVE_BG_MODES.find((m) => m.id === id)?.label ?? id;
}

/** 按 16 级色桶的去背景色块规则（保护 / 强制去除） */
export interface RemoveBgColorRule {
  key: string;
  r: number;
  g: number;
  b: number;
}

export interface RemoveBgColorRules {
  whitelist: RemoveBgColorRule[];
  blacklist: RemoveBgColorRule[];
}

export function createEmptyRemoveBgColorRules(): RemoveBgColorRules {
  return { whitelist: [], blacklist: [] };
}

export function cloneRemoveBgColorRules(rules: RemoveBgColorRules): RemoveBgColorRules {
  return {
    whitelist: rules.whitelist.map((r) => ({ ...r })),
    blacklist: rules.blacklist.map((r) => ({ ...r })),
  };
}

export interface PixelImportMixOptions {
  removeBgMode?: RemoveBgModeInput;
  removeBgRules?: RemoveBgColorRules;
  /** 去背景后填补被八邻域不透明色块完全包围的透明内洞 */
  removeBgFillEnclosed?: boolean;
}

/** 边缘参考色（供 UI 展示） */
export interface RemoveBgEdgeColor {
  key: string;
  r: number;
  g: number;
  b: number;
  count: number;
}

/** 将 RGB 映射为去背景色桶键（与 colorBucketKey 一致） */
export function getRemoveBgColorBucketKey(r: number, g: number, b: number): string {
  const q = 4;
  return `${r >> q},${g >> q},${b >> q}`;
}

/** 白/黑名单点选时，Lab ΔE76 与此值内视为同色组（覆盖相近色桶） */
export const REMOVE_BG_RULE_MATCH_TOLERANCE = 14;

// --- 去背景：Lab 感知距离 + 边缘参考色组 + 连通/剥离混合 ---

function srgbToLinear(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function rgbaToLab(rgba: Rgba): [number, number, number] {
  const r = srgbToLinear(rgba.r);
  const g = srgbToLinear(rgba.g);
  const b = srgbToLinear(rgba.b);
  const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = r * 0.0193339 + g * 0.119192 + b * 0.9503041;
  const refX = 0.95047;
  const refY = 1;
  const refZ = 1.08883;
  const f = (t: number) => (t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116);
  const fx = f(x / refX);
  const fy = f(y / refY);
  const fz = f(z / refZ);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function rgbaDistance(a: Rgba, b: Rgba): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Lab ΔE76，比 RGB 欧氏距离更符合人眼对背景相近色的感知 */
function perceptualColorDistance(a: Rgba, b: Rgba): number {
  const [L1, a1, b1] = rgbaToLab(a);
  const [L2, a2, b2] = rgbaToLab(b);
  const dL = L1 - L2;
  const da = a1 - a2;
  const db = b1 - b2;
  return Math.sqrt(dL * dL + da * da + db * db);
}

function createEmptyMask(rows: number, cols: number): boolean[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
}

function nearestPaletteDistance(px: Rgba, palette: Rgba[]): number {
  if (palette.length === 0) return Number.POSITIVE_INFINITY;
  let min = Number.POSITIVE_INFINITY;
  for (const ref of palette) {
    const d = perceptualColorDistance(px, ref);
    if (d < min) min = d;
  }
  return min;
}

/** 与画面边缘的格距：0=最外圈，越大越靠内（与是否已剥除、主体遮挡无关） */
function borderDepth(x: number, y: number, cols: number, rows: number): number {
  return Math.min(x, y, cols - 1 - x, rows - 1 - y);
}

function* borderCoords(cols: number, rows: number): Generator<[number, number]> {
  for (let x = 0; x < cols; x++) {
    yield [x, 0];
    if (rows > 1) yield [x, rows - 1];
  }
  for (let y = 1; y < rows - 1; y++) {
    yield [0, y];
    if (cols > 1) yield [cols - 1, y];
  }
}

function bucketCentroid(samples: Rgba[]): Rgba {
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sa = 0;
  for (const px of samples) {
    sr += px.r;
    sg += px.g;
    sb += px.b;
    sa += px.a;
  }
  const n = samples.length;
  return {
    r: Math.round(sr / n),
    g: Math.round(sg / n),
    b: Math.round(sb / n),
    a: sa / n,
  };
}

/**
 * 边缘参考色组：仅统计画面最外一圈像素，按色块数量排序。
 * 每桶取均值作代表色；出现次数 ≥ max(2, 外圈总数×8%) 的色块才入组。
 * 判定：Lab ΔE76 与组内任一参考色 ≤ 容差。
 */
function buildEdgeReferencePalette(grid: PixelGrid): Rgba[] {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  if (cols === 0 || rows === 0) return [];

  const buckets = new Map<string, { samples: Rgba[]; count: number }>();
  let total = 0;
  for (const [x, y] of borderCoords(cols, rows)) {
    const px = getPixel(grid, x, y);
    if (!px || px.a < 0.08) continue;
    total++;
    const key = colorBucketKey(px);
    const entry = buckets.get(key);
    if (entry) {
      entry.samples.push(px);
      entry.count++;
    } else {
      buckets.set(key, { samples: [px], count: 1 });
    }
  }
  if (total === 0) return [];

  const minCount = Math.max(2, Math.ceil(total * 0.08));
  return [...buckets.values()]
    .filter((b) => b.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .map((b) => bucketCentroid(b.samples));
}

/** 获取边缘参考色组（供预览 UI 展示色块） */
export function getRemoveBgEdgePalette(grid: PixelGrid): RemoveBgEdgeColor[] {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  if (cols === 0 || rows === 0) return [];

  const buckets = new Map<string, { samples: Rgba[]; count: number }>();
  for (const [x, y] of borderCoords(cols, rows)) {
    const px = getPixel(grid, x, y);
    if (!px || px.a < 0.08) continue;
    const key = colorBucketKey(px);
    const entry = buckets.get(key);
    if (entry) {
      entry.samples.push(px);
      entry.count++;
    } else {
      buckets.set(key, { samples: [px], count: 1 });
    }
  }

  const total = [...buckets.values()].reduce((sum, b) => sum + b.count, 0);
  if (total === 0) return [];

  const minCount = Math.max(2, Math.ceil(total * 0.08));
  return [...buckets.values()]
    .filter((b) => b.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .map((b) => {
      const c = bucketCentroid(b.samples);
      return {
        key: colorBucketKey(c),
        r: c.r,
        g: c.g,
        b: c.b,
        count: b.count,
      };
    });
}

function ruleToRgba(rule: RemoveBgColorRule): Rgba {
  return { r: rule.r, g: rule.g, b: rule.b, a: 1 };
}

/** 判断像素是否落在某条色块规则的可感知范围内 */
export function matchesRemoveBgColorRule(px: Rgba, rule: RemoveBgColorRule): boolean {
  return perceptualColorDistance(px, ruleToRgba(rule)) <= REMOVE_BG_RULE_MATCH_TOLERANCE;
}

function pixelMatchesRuleList(px: Rgba, rules: RemoveBgColorRule[]): boolean {
  for (const rule of rules) {
    if (matchesRemoveBgColorRule(px, rule)) return true;
  }
  return false;
}

function applyColorRulesToMask(
  grid: PixelGrid,
  mask: boolean[][],
  rules?: RemoveBgColorRules
): boolean[][] {
  if (!rules) return mask;
  if (rules.whitelist.length === 0 && rules.blacklist.length === 0) return mask;

  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const out = mask.map((row) => [...row]);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = getPixel(grid, x, y);
      if (!px || px.a < 0.08) {
        out[y]![x] = false;
        continue;
      }
      if (pixelMatchesRuleList(px, rules.whitelist)) out[y]![x] = false;
      else if (pixelMatchesRuleList(px, rules.blacklist)) out[y]![x] = true;
    }
  }
  return out;
}

/** 合并相近规则，避免重复条目 */
export function normalizeRemoveBgColorRuleList(rules: RemoveBgColorRule[]): RemoveBgColorRule[] {
  const out: RemoveBgColorRule[] = [];
  for (const rule of rules) {
    const px = ruleToRgba(rule);
    const dup = out.findIndex((existing) => matchesRemoveBgColorRule(px, existing));
    if (dup >= 0) out[dup] = rule;
    else out.push(rule);
  }
  return out;
}

function isInEdgeReferenceGroup(px: Rgba, palette: Rgba[], tolerance: number): boolean {
  return nearestPaletteDistance(px, palette) <= tolerance;
}

const FLOOD_NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

/** 从画面边缘出发泛洪，只剥与边框连通的背景色块 */
function floodBackgroundFromBorder(
  grid: PixelGrid,
  edgePalette: Rgba[],
  tolerance: number
): boolean[][] {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const mask = createEmptyMask(rows, cols);
  const visited = createEmptyMask(rows, cols);
  const queue: [number, number][] = [];

  for (const [x, y] of borderCoords(cols, rows)) {
    const px = getPixel(grid, x, y);
    if (!px || px.a < 0.08) continue;
    if (!isInEdgeReferenceGroup(px, edgePalette, tolerance)) continue;
    visited[y]![x] = true;
    mask[y]![x] = true;
    queue.push([x, y]);
  }

  let head = 0;
  while (head < queue.length) {
    const [x, y] = queue[head++]!;
    for (const [dx, dy] of FLOOD_NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (visited[ny]![nx]) continue;
      const px = getPixel(grid, nx, ny);
      if (!px || px.a < 0.08) continue;
      if (!isInEdgeReferenceGroup(px, edgePalette, tolerance)) continue;
      visited[ny]![nx] = true;
      mask[ny]![nx] = true;
      queue.push([nx, ny]);
    }
  }

  return mask;
}

/**
 * 按与画面边缘的格距从外向内逐层扫描：每层只去除落在边缘色组区间内的背景色块。
 * 不依赖与已剥除区域相邻，主体内的缝隙背景会在更深格距层被扫到。
 */
function peelBackgroundLayers(
  grid: PixelGrid,
  edgePalette: Rgba[],
  tolerance: number
): boolean[][] {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const mask = createEmptyMask(rows, cols);
  const maxDepth = Math.min(cols, rows);

  for (let depth = 0; depth < maxDepth; depth++) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (borderDepth(x, y, cols, rows) !== depth) continue;
        const px = getPixel(grid, x, y);
        if (!px || px.a < 0.08) continue;
        if (!isInEdgeReferenceGroup(px, edgePalette, tolerance)) continue;
        mask[y]![x] = true;
      }
    }
  }

  return mask;
}

function unionMasks(a: boolean[][], b: boolean[][]): boolean[][] {
  const rows = a.length;
  const out = createEmptyMask(rows, a[0]?.length ?? 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < (out[y]?.length ?? 0); x++) {
      out[y]![x] = !!(a[y]?.[x] || b[y]?.[x]);
    }
  }
  return out;
}

function computeRemoveBgMaskForMode(
  grid: PixelGrid,
  edgePalette: Rgba[],
  tolerance: number,
  mode: RemoveBgMode
): boolean[][] {
  switch (mode) {
    case 'connected':
      return floodBackgroundFromBorder(grid, edgePalette, tolerance);
    case 'peel':
      return peelBackgroundLayers(grid, edgePalette, tolerance);
    case 'hybrid':
      return unionMasks(
        floodBackgroundFromBorder(grid, edgePalette, tolerance),
        peelBackgroundLayers(grid, edgePalette, tolerance)
      );
  }
}

function computeRemoveBgAlgorithmMask(
  grid: PixelGrid,
  tolerance: number,
  mode: RemoveBgModeInput = DEFAULT_REMOVE_BG_MODE
): boolean[][] | null {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  if (cols === 0 || rows === 0 || tolerance <= 0) return null;

  const edgePalette = buildEdgeReferencePalette(grid);
  if (edgePalette.length === 0) return null;

  return computeRemoveBgMaskForMode(grid, edgePalette, tolerance, normalizeRemoveBgMode(mode));
}

/** 逻辑网格（500×700）上的最终去背景掩码：展示格算法 + 映射 + 感知色规则 */
export function computeRemoveBgLogicalMask(
  grid: PixelGrid,
  toleranceSlider: number,
  options?: PixelImportMixOptions
): boolean[][] | null {
  const tolerance =
    toleranceSlider > 0 ? removeBgSliderToTolerance(toleranceSlider) : 0;
  const hasBlacklist = (options?.removeBgRules?.blacklist.length ?? 0) > 0;
  const hasWhitelist = (options?.removeBgRules?.whitelist.length ?? 0) > 0;
  if (tolerance <= 0 && !hasBlacklist && !hasWhitelist) return null;

  const matting = logicalGridToDisplayGridMatting(grid);
  const displayMask = computeRemoveBgAlgorithmMask(
    matting,
    tolerance,
    options?.removeBgMode ?? DEFAULT_REMOVE_BG_MODE
  );

  const logicalRaw = displayMask
    ? displayMaskToLogicalMask(displayMask)
    : createEmptyMask(ART_GRID_ROWS, ART_GRID_COLS);

  const logicalMask = applyColorRulesToMask(grid, logicalRaw, options?.removeBgRules);

  const anyMarked = logicalMask.some((row) => row.some(Boolean));
  return anyMarked ? logicalMask : null;
}

/** 逻辑掩码聚合到 60×84 展示格（块内任一格去除则展示格标记） */
export function logicalMaskToDisplayMask(logicalMask: boolean[][]): boolean[][] {
  const displayMask = createEmptyMask(ART_DISPLAY_ROWS, ART_DISPLAY_COLS);
  for (let y = 0; y < ART_GRID_ROWS; y++) {
    const dy = Math.min(
      ART_DISPLAY_ROWS - 1,
      Math.floor((y * ART_DISPLAY_ROWS) / ART_GRID_ROWS)
    );
    for (let x = 0; x < ART_GRID_COLS; x++) {
      const dx = Math.min(
        ART_DISPLAY_COLS - 1,
        Math.floor((x * ART_DISPLAY_COLS) / ART_GRID_COLS)
      );
      if (logicalMask[y]?.[x]) displayMask[dy]![dx] = true;
    }
  }
  return displayMask;
}

/** 从逻辑网格导出 60×84 预览掩码（与落盘一致） */
export function computeRemoveBgDisplayMaskFromLogical(
  logicalGrid: PixelGrid,
  toleranceSlider: number,
  options?: PixelImportMixOptions
): boolean[][] | null {
  const logicalMask = computeRemoveBgLogicalMask(logicalGrid, toleranceSlider, options);
  return logicalMask ? logicalMaskToDisplayMask(logicalMask) : null;
}

/** 计算去背景掩码（60×84 展示格，仅展示格内规则；预览请用 computeRemoveBgDisplayMaskFromLogical） */
export function computeRemoveBgMask(
  grid: PixelGrid,
  tolerance: number,
  mode: RemoveBgModeInput = DEFAULT_REMOVE_BG_MODE,
  rules?: RemoveBgColorRules
): boolean[][] | null {
  const rows = grid.length;
  const cols = Math.max(0, ...grid.map((r) => r.length));
  const hasBlacklist = (rules?.blacklist.length ?? 0) > 0;
  if (cols === 0 || rows === 0 || (tolerance <= 0 && !hasBlacklist)) return null;

  const edgePalette = buildEdgeReferencePalette(grid);
  if (edgePalette.length === 0 && !hasBlacklist) return null;

  const mask =
    edgePalette.length > 0
      ? computeRemoveBgMaskForMode(grid, edgePalette, tolerance, normalizeRemoveBgMode(mode))
      : createEmptyMask(rows, cols);

  return applyColorRulesToMask(grid, mask, rules);
}

/** 从展示格取色块规则（用于预览点选） */
export function pickRemoveBgColorRuleFromGrid(
  grid: PixelGrid,
  x: number,
  y: number
): RemoveBgColorRule | null {
  const px = getPixel(grid, x, y);
  if (!px || px.a < 0.08) return null;
  return {
    key: colorBucketKey(px),
    r: px.r,
    g: px.g,
    b: px.b,
  };
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

/** 将 60×84 展示掩码映射到 500×700 逻辑格（与 displayGridToLogicalGrid 块划分一致） */
function displayMaskToLogicalMask(displayMask: boolean[][]): boolean[][] {
  const mask = createEmptyMask(ART_GRID_ROWS, ART_GRID_COLS);
  for (let y = 0; y < ART_GRID_ROWS; y++) {
    const dy = Math.min(
      ART_DISPLAY_ROWS - 1,
      Math.floor((y * ART_DISPLAY_ROWS) / ART_GRID_ROWS)
    );
    for (let x = 0; x < ART_GRID_COLS; x++) {
      const dx = Math.min(
        ART_DISPLAY_COLS - 1,
        Math.floor((x * ART_DISPLAY_COLS) / ART_GRID_COLS)
      );
      if (displayMask[dy]?.[dx]) mask[y]![x] = true;
    }
  }
  return mask;
}

/**
 * 在 500×700 原像素画上仅打透明洞：掩码在 60×84 色桶下采样格上计算，落盘不重写保留色。
 */
function applyRemoveBgToLogicalGrid(
  grid: PixelGrid,
  toleranceSlider: number,
  options?: PixelImportMixOptions
): PixelGrid {
  const logicalMask = computeRemoveBgLogicalMask(grid, toleranceSlider, options);
  if (!logicalMask) return cloneGrid(grid);

  let out = cloneGrid(grid);
  for (let y = 0; y < logicalMask.length; y++) {
    for (let x = 0; x < (logicalMask[y]?.length ?? 0); x++) {
      if (logicalMask[y]![x]) out[y]![x] = null;
    }
  }
  if (options?.removeBgFillEnclosed) {
    out = fillEnclosedTransparentHoles(out);
  }
  return out;
}

function hasNonRemoveBgEffects(mix: PixelImportEffectMix): boolean {
  return MIX_EFFECT_ORDER.some((id) => id !== 'removeBg' && (mix[id] ?? 0) > 0);
}

function mixWithoutRemoveBg(mix: PixelImportEffectMix): PixelImportEffectMix {
  return { ...mix, removeBg: 0 };
}

function shouldApplyRemoveBg(mix: PixelImportEffectMix, options?: PixelImportMixOptions): boolean {
  return (mix.removeBg ?? 0) > 0 || (options?.removeBgRules?.blacklist.length ?? 0) > 0;
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
      const mattingSource = mattingGrid ?? result;
      result = removeBgGrid(
        result,
        removeBgSliderToTolerance(strength),
        mattingSource,
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
      const hasRemove =
        v > 0 || (options?.removeBgRules?.blacklist.length ?? 0) > 0;
      const hasFill = !!options?.removeBgFillEnclosed;
      if (!hasRemove && !hasFill) continue;
      if (hasRemove) {
        let part = `${o.label} ${getRemoveBgModeLabel(removeBgMode)} 容差${removeBgSliderToTolerance(v)}`;
        if (hasFill) part += ' 内洞填色';
        parts.push(part);
      } else if (hasFill) {
        parts.push('内洞填色');
      }
      continue;
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

/** 逻辑网格 → 展示网格（色桶多数票 + 桶内均值，专供去背景算掩码） */
export function logicalGridToDisplayGridMatting(grid: PixelGrid): PixelGrid {
  const packed = gridToPacked(grid, ART_GRID_COLS, ART_GRID_ROWS);
  const displayPacked = downsamplePackedGridBucketMajority(
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

/**
 * 在 60×84 展示网格上预览效果。
 * 去背景：先在 500×700 原网格打透明洞，再中心下采样预览，保留主体色块原色。
 */
export function applyPixelImportMixOnDisplay(
  grid: PixelGrid,
  mix: PixelImportEffectMix,
  options?: PixelImportMixOptions
): PixelGrid {
  let logical = grid;
  const removeBgStrength = mix.removeBg ?? 0;
  if (shouldApplyRemoveBg(mix, options)) {
    logical = applyRemoveBgToLogicalGrid(grid, removeBgStrength, options);
  }

  const display = logicalGridToDisplayGrid(logical);
  if (!hasNonRemoveBgEffects(mix)) {
    return display;
  }
  return applyPixelImportMix(display, mixWithoutRemoveBg(mix), null, options);
}

/**
 * 导入落盘：去背景仅写透明格不重采样颜色；其余效果仍在展示格处理后展开。
 */
export function applyPixelImportMixForEditor(
  grid: PixelGrid,
  mix: PixelImportEffectMix,
  options?: PixelImportMixOptions
): PixelGrid {
  let logical = grid;
  const removeBgStrength = mix.removeBg ?? 0;
  if (shouldApplyRemoveBg(mix, options)) {
    logical = applyRemoveBgToLogicalGrid(grid, removeBgStrength, options);
  }

  if (!hasNonRemoveBgEffects(mix)) {
    return logical;
  }

  const display = logicalGridToDisplayGrid(logical);
  const processed = applyPixelImportMix(display, mixWithoutRemoveBg(mix), null, options);
  return displayGridToLogicalGrid(processed);
}
