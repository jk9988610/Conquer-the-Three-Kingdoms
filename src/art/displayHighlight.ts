import { ART_DISPLAY_COLS, ART_DISPLAY_ROWS } from './gridConfig';
import { gridIndex, type PackedGrid } from './packedGrid';

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

/** 在 60×84 展示格上绘制高亮/光晕/呼吸叠加（不改底层像素） */
export function paintDisplayHighlightOverlay(
  ctx: CanvasRenderingContext2D,
  displayPacked: PackedGrid,
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
      if ((displayPacked[gridIndex(dx, dy, ART_DISPLAY_COLS)] ?? 0) === 0) continue;

      const x = originX + dx * cell;
      const y = originY + dy * cell;
      const w = cell;
      const h = cell;
      const v = displayPacked[gridIndex(dx, dy, ART_DISPLAY_COLS)] ?? 0;
      const cr = (v >>> 16) & 255;
      const cg = (v >>> 8) & 255;
      const cb = v & 255;

      let outlineAlpha = 0.88;
      if (hasDisplayHighlightBreath(flags)) {
        outlineAlpha = 0.28 + 0.62 * pulse;
      }

      ctx.strokeStyle = `rgba(255, 220, 64, ${outlineAlpha})`;
      ctx.lineWidth = Math.max(1, cell * 0.14);
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      if (hasDisplayHighlightGlow(flags) || hasDisplayHighlightBreath(flags)) {
        const glowAlpha = hasDisplayHighlightBreath(flags)
          ? 0.18 + 0.42 * pulse
          : 0.5;
        const pad = Math.max(1, cell * 0.22);
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${glowAlpha})`;
        ctx.lineWidth = pad;
        ctx.strokeRect(x + pad * 0.5, y + pad * 0.5, w - pad, h - pad);
        ctx.fillStyle = `rgba(255, 255, 255, ${glowAlpha * 0.22})`;
        ctx.fillRect(x, y, w, h);
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
