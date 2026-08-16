import { drawArtImageToCanvas } from './artImage';
import { ART_DISPLAY_COLS, ART_DISPLAY_ROWS } from './gridConfig';
import {
  downsamplePackedGridCached,
  gridDrawLayout,
  gridIndex,
  type GridDrawMode,
  type PackedGrid,
} from './packedGrid';

export const DISPLAY_HIGHLIGHT_CELL_COUNT = ART_DISPLAY_COLS * ART_DISPLAY_ROWS;

/** 已标记高亮（仅作用于有色展示格） */
export const DISPLAY_HIGHLIGHT_MARK = 1;
/** 光晕效果（需已高亮） */
export const DISPLAY_HIGHLIGHT_GLOW = 2;
/** 呼吸灯效果（需已高亮） */
export const DISPLAY_HIGHLIGHT_BREATH = 4;

export type DisplayHighlightGrid = Uint8Array;

export function createEmptyDisplayHighlight(): DisplayHighlightGrid {
  return new Uint8Array(DISPLAY_HIGHLIGHT_CELL_COUNT);
}

export function cloneDisplayHighlight(grid: DisplayHighlightGrid): DisplayHighlightGrid {
  return new Uint8Array(grid);
}

export function displayHighlightIndex(dx: number, dy: number): number {
  return dy * ART_DISPLAY_COLS + dx;
}

export function getDisplayHighlightFlags(
  grid: DisplayHighlightGrid,
  dx: number,
  dy: number
): number {
  if (dx < 0 || dy < 0 || dx >= ART_DISPLAY_COLS || dy >= ART_DISPLAY_ROWS) return 0;
  return grid[displayHighlightIndex(dx, dy)] ?? 0;
}

export function hasDisplayHighlightMark(flags: number): boolean {
  return (flags & DISPLAY_HIGHLIGHT_MARK) !== 0;
}

export function hasDisplayHighlightGlow(flags: number): boolean {
  return (flags & DISPLAY_HIGHLIGHT_GLOW) !== 0;
}

export function hasDisplayHighlightBreath(flags: number): boolean {
  return (flags & DISPLAY_HIGHLIGHT_BREATH) !== 0;
}

export function hasAnyDisplayHighlight(grid: DisplayHighlightGrid): boolean {
  for (let i = 0; i < grid.length; i++) {
    if ((grid[i]! & DISPLAY_HIGHLIGHT_MARK) !== 0) return true;
  }
  return false;
}

export function anyDisplayHighlightBreath(grid: DisplayHighlightGrid): boolean {
  for (let i = 0; i < grid.length; i++) {
    if ((grid[i]! & DISPLAY_HIGHLIGHT_BREATH) !== 0) return true;
  }
  return false;
}

export function breathPulsePhase(nowMs: number, breathSpeed = 50): number {
  const speed = Math.max(1, Math.min(100, breathSpeed));
  const periodMs = 3200 - ((speed - 1) / 99) * 2700;
  return 0.5 + 0.5 * Math.sin((nowMs / periodMs) * Math.PI * 2);
}

function argbToRgbaStyle(v: number): string {
  const a = (v >>> 24) / 255;
  const r = (v >>> 16) & 255;
  const g = (v >>> 8) & 255;
  const b = v & 255;
  return `rgba(${r},${g},${b},${a})`;
}

/** 同色相叠光强度：用 screen 合成，避免向白色插值 */
function cellHighlightOverlayAlpha(flags: number, pulse: number): number {
  let alpha = 0;
  if (hasDisplayHighlightMark(flags)) alpha = Math.max(alpha, 0.1);
  if (hasDisplayHighlightGlow(flags)) alpha = Math.max(alpha, 0.14);
  if (hasDisplayHighlightBreath(flags)) alpha = Math.max(alpha, 0.06 + pulse * 0.16);
  return alpha;
}

function paintGlowLayers(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cr: number,
  cg: number,
  cb: number,
  flags: number,
  pulse: number,
  pad: number
): void {
  const glow = hasDisplayHighlightGlow(flags);
  const breath = hasDisplayHighlightBreath(flags);
  if (!glow && !breath) return;

  const baseAlpha = breath ? 0.1 + pulse * 0.22 : 0.22;
  const layers = breath ? 2 + Math.round(pulse * 2) : 3;
  const breathScale = breath ? 0.55 + pulse * 0.45 : 1;
  for (let layer = layers; layer >= 1; layer--) {
    const spread = pad * layer;
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${(baseAlpha / layer) * breathScale})`;
    ctx.fillRect(x - spread, y - spread, w + spread * 2, h + spread * 2);
  }
}

export interface FillDisplayHighlightOptions {
  /** PNG 底图已绘制时跳过像素格铺色，仅叠加光晕/呼吸 */
  skipBasePixels?: boolean;
}

/** 单次绘制展示格：光晕在下、格色（含提亮）在上，避免叠在原图上的「复制层」 */
export function fillDisplayPackedWithHighlight(
  ctx: CanvasRenderingContext2D,
  display: PackedGrid,
  highlightGrid: DisplayHighlightGrid | null | undefined,
  cellPx: number,
  originX: number,
  originY: number,
  breathSpeed = 50,
  nowMs = performance.now(),
  dstCols = ART_DISPLAY_COLS,
  dstRows = ART_DISPLAY_ROWS,
  options: FillDisplayHighlightOptions = {}
): void {
  const { skipBasePixels = false } = options;
  const hasHighlight = highlightGrid && hasAnyDisplayHighlight(highlightGrid);
  const pulse = breathPulsePhase(nowMs, breathSpeed);
  const cell = Math.max(1, cellPx);
  const pad = Math.max(1, cell * 0.22);

  ctx.imageSmoothingEnabled = false;

  if (hasHighlight) {
    for (let dy = 0; dy < dstRows; dy++) {
      for (let dx = 0; dx < dstCols; dx++) {
        const flags = getDisplayHighlightFlags(highlightGrid!, dx, dy);
        if (!hasDisplayHighlightMark(flags)) continue;
        const v = display[gridIndex(dx, dy, dstCols)] ?? 0;
        if (v === 0) continue;
        const x = originX + dx * cell;
        const y = originY + dy * cell;
        const cr = (v >>> 16) & 255;
        const cg = (v >>> 8) & 255;
        const cb = v & 255;
        paintGlowLayers(ctx, x, y, cell, cell, cr, cg, cb, flags, pulse, pad);
      }
    }
  }

  if (!skipBasePixels) {
    for (let dy = 0; dy < dstRows; dy++) {
      for (let dx = 0; dx < dstCols; dx++) {
        const v = display[gridIndex(dx, dy, dstCols)] ?? 0;
        if (v === 0) continue;
        const x = originX + dx * cell;
        const y = originY + dy * cell;
        ctx.fillStyle = argbToRgbaStyle(v);
        ctx.fillRect(x, y, cell, cell);
      }
    }
  }

  if (hasHighlight) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (let dy = 0; dy < dstRows; dy++) {
      for (let dx = 0; dx < dstCols; dx++) {
        const flags = getDisplayHighlightFlags(highlightGrid!, dx, dy);
        if (!hasDisplayHighlightMark(flags)) continue;
        const v = display[gridIndex(dx, dy, dstCols)] ?? 0;
        if (v === 0) continue;
        const x = originX + dx * cell;
        const y = originY + dy * cell;
        const cr = (v >>> 16) & 255;
        const cg = (v >>> 8) & 255;
        const cb = v & 255;
        const alpha = cellHighlightOverlayAlpha(flags, pulse);
        if (alpha <= 0) continue;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`;
        ctx.fillRect(x, y, cell, cell);
      }
    }
    ctx.restore();
  }
}

/** 卡面/预览：带高亮的展示格绘制（与 packedGrid.drawPackedDisplayToCanvas 布局一致） */
export function drawPackedDisplayWithHighlight(
  ctx: CanvasRenderingContext2D,
  packed: PackedGrid,
  width: number,
  height: number,
  highlightGrid: DisplayHighlightGrid,
  mode: GridDrawMode = 'fit',
  breathSpeed = 50,
  nowMs = performance.now(),
  srcCols = ART_DISPLAY_COLS,
  srcRows = ART_DISPLAY_ROWS,
  dstCols = ART_DISPLAY_COLS,
  dstRows = ART_DISPLAY_ROWS
): void {
  const display = downsamplePackedGridCached(packed, srcCols, srcRows, dstCols, dstRows);

  if (mode === 'fit') {
    const cellPx = Math.min(Math.floor(width / dstCols), Math.floor(height / dstRows));
    if (cellPx >= 1) {
      const drawW = dstCols * cellPx;
      const drawH = dstRows * cellPx;
      const ox = Math.floor((width - drawW) / 2);
      const oy = Math.floor((height - drawH) / 2);
      fillDisplayPackedWithHighlight(
        ctx,
        display,
        highlightGrid,
        cellPx,
        ox,
        oy,
        breathSpeed,
        nowMs,
        dstCols,
        dstRows
      );
      return;
    }
  }

  const { cell, ox, oy } = gridDrawLayout(dstCols, dstRows, width, height, mode);
  const dw = dstCols * cell;
  const dh = dstRows * cell;

  const buffer = document.createElement('canvas');
  buffer.width = dstCols;
  buffer.height = dstRows;
  const bctx = buffer.getContext('2d');
  if (!bctx) return;
  fillDisplayPackedWithHighlight(
    bctx,
    display,
    highlightGrid,
    1,
    0,
    0,
    breathSpeed,
    nowMs,
    dstCols,
    dstRows
  );

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buffer, 0, 0, dstCols, dstRows, ox, oy, dw, dh);
}

/** 卡面 PNG + 渲染层高亮（底图为位图，效果层与 PackedGrid 路径一致） */
export function drawImageDisplayWithHighlight(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  display: PackedGrid,
  width: number,
  height: number,
  highlightGrid: DisplayHighlightGrid,
  mode: GridDrawMode = 'fit',
  breathSpeed = 50,
  nowMs = performance.now(),
  dstCols = ART_DISPLAY_COLS,
  dstRows = ART_DISPLAY_ROWS
): void {
  if (mode === 'fit') {
    const cellPx = Math.min(Math.floor(width / dstCols), Math.floor(height / dstRows));
    if (cellPx >= 1) {
      const drawW = dstCols * cellPx;
      const drawH = dstRows * cellPx;
      const ox = Math.floor((width - drawW) / 2);
      const oy = Math.floor((height - drawH) / 2);
      drawArtImageToCanvas(ctx, image, width, height, 'fit');
      fillDisplayPackedWithHighlight(
        ctx,
        display,
        highlightGrid,
        cellPx,
        ox,
        oy,
        breathSpeed,
        nowMs,
        dstCols,
        dstRows,
        { skipBasePixels: true }
      );
      return;
    }
  }

  const { cell, ox, oy } = gridDrawLayout(dstCols, dstRows, width, height, mode);
  const dw = dstCols * cell;
  const dh = dstRows * cell;

  const buffer = document.createElement('canvas');
  buffer.width = dstCols;
  buffer.height = dstRows;
  const bctx = buffer.getContext('2d');
  if (!bctx) return;

  drawArtImageToCanvas(bctx, image, dstCols, dstRows, 'fit');
  fillDisplayPackedWithHighlight(
    bctx,
    display,
    highlightGrid,
    1,
    0,
    0,
    breathSpeed,
    nowMs,
    dstCols,
    dstRows,
    { skipBasePixels: true }
  );

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buffer, 0, 0, dstCols, dstRows, ox, oy, dw, dh);
}

/** 仅叠加渲染层高亮（透明底，用于分层 canvas 的顶层） */
export function drawDisplayHighlightOverlay(
  ctx: CanvasRenderingContext2D,
  display: PackedGrid,
  width: number,
  height: number,
  highlightGrid: DisplayHighlightGrid,
  mode: GridDrawMode = 'fit',
  breathSpeed = 50,
  nowMs = performance.now(),
  dstCols = ART_DISPLAY_COLS,
  dstRows = ART_DISPLAY_ROWS
): void {
  if (!hasAnyDisplayHighlight(highlightGrid)) return;

  if (mode === 'fit') {
    const cellPx = Math.min(Math.floor(width / dstCols), Math.floor(height / dstRows));
    if (cellPx >= 1) {
      const drawW = dstCols * cellPx;
      const drawH = dstRows * cellPx;
      const ox = Math.floor((width - drawW) / 2);
      const oy = Math.floor((height - drawH) / 2);
      fillDisplayPackedWithHighlight(
        ctx,
        display,
        highlightGrid,
        cellPx,
        ox,
        oy,
        breathSpeed,
        nowMs,
        dstCols,
        dstRows,
        { skipBasePixels: true }
      );
      return;
    }
  }

  const { cell, ox, oy } = gridDrawLayout(dstCols, dstRows, width, height, mode);
  const dw = dstCols * cell;
  const dh = dstRows * cell;

  const buffer = document.createElement('canvas');
  buffer.width = dstCols;
  buffer.height = dstRows;
  const bctx = buffer.getContext('2d');
  if (!bctx) return;
  fillDisplayPackedWithHighlight(
    bctx,
    display,
    highlightGrid,
    1,
    0,
    0,
    breathSpeed,
    nowMs,
    dstCols,
    dstRows,
    { skipBasePixels: true }
  );

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(buffer, 0, 0, dstCols, dstRows, ox, oy, dw, dh);
}

/**
 * 编辑器叠加层：仅显示「已标记」提示（淡色描边/角标），不绘制提亮或光晕成品效果。
 */
export function paintDisplayHighlightMarks(
  ctx: CanvasRenderingContext2D,
  highlightGrid: DisplayHighlightGrid,
  cellPx: number,
  originX: number,
  originY: number,
  breathSpeed = 50,
  nowMs = performance.now()
): void {
  if (!hasAnyDisplayHighlight(highlightGrid)) return;

  const pulse = breathPulsePhase(nowMs, breathSpeed);
  const cell = Math.max(1, cellPx);

  for (let dy = 0; dy < ART_DISPLAY_ROWS; dy++) {
    for (let dx = 0; dx < ART_DISPLAY_COLS; dx++) {
      const flags = getDisplayHighlightFlags(highlightGrid, dx, dy);
      if (!hasDisplayHighlightMark(flags)) continue;

      const x = originX + dx * cell;
      const y = originY + dy * cell;
      let alpha = 0.55;
      if (hasDisplayHighlightBreath(flags)) alpha = 0.28 + 0.42 * pulse;

      ctx.strokeStyle = `rgba(80, 200, 255, ${alpha})`;
      ctx.lineWidth = Math.max(1, cell * 0.1);
      ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);

      if (hasDisplayHighlightGlow(flags)) {
        const inset = Math.max(1, cell * 0.2);
        ctx.strokeStyle = `rgba(255, 170, 64, ${alpha * 0.9})`;
        ctx.lineWidth = Math.max(1, cell * 0.06);
        ctx.strokeRect(x + inset, y + inset, cell - inset * 2, cell - inset * 2);
      }
    }
  }
}

export interface HighlightBreathTarget {
  hasBreath: () => boolean;
  redraw: () => void;
}

const breathTargets = new Set<HighlightBreathTarget>();
let breathRafId = 0;

function stopGlobalBreathAnimation(): void {
  if (breathRafId) {
    cancelAnimationFrame(breathRafId);
    breathRafId = 0;
  }
}

function tickGlobalBreathAnimation(): void {
  let any = false;
  for (const target of breathTargets) {
    if (!target.hasBreath()) continue;
    any = true;
    target.redraw();
  }
  if (!any) {
    stopGlobalBreathAnimation();
    return;
  }
  breathRafId = requestAnimationFrame(tickGlobalBreathAnimation);
}

export function registerHighlightBreathTarget(target: HighlightBreathTarget): () => void {
  breathTargets.add(target);
  if (!breathRafId) {
    breathRafId = requestAnimationFrame(tickGlobalBreathAnimation);
  }
  return () => {
    breathTargets.delete(target);
    if (breathTargets.size === 0) stopGlobalBreathAnimation();
  };
}

export function encodeDisplayHighlightBase64(grid: DisplayHighlightGrid): string {
  let binary = '';
  for (let i = 0; i < grid.length; i++) {
    binary += String.fromCharCode(grid[i]!);
  }
  return btoa(binary);
}

export function decodeDisplayHighlightBase64(b64: string): DisplayHighlightGrid {
  const binary = atob(b64);
  const out = createEmptyDisplayHighlight();
  const n = Math.min(out.length, binary.length);
  for (let i = 0; i < n; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
