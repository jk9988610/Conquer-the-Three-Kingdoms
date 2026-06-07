import { ART_DISPLAY_COLS, ART_DISPLAY_ROWS } from './gridConfig';

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

export function anyDisplayHighlightBreath(grid: DisplayHighlightGrid): boolean {
  for (let i = 0; i < grid.length; i++) {
    if ((grid[i]! & DISPLAY_HIGHLIGHT_BREATH) !== 0) return true;
  }
  return false;
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
