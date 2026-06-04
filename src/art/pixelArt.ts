import type { PixelArtKey } from '../game/types';

type Pixel = string | null;


function fill(
  ctx: CanvasRenderingContext2D,
  grid: Pixel[][],
  ox: number,
  oy: number,
  cell: number
): void {
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const c = grid[y][x];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
    }
  }
}

/** 在画布内绘制像素画（程序生成，非图片文件） */
export function drawPixelArt(
  ctx: CanvasRenderingContext2D,
  key: PixelArtKey,
  width: number,
  height: number
): void {
  ctx.clearRect(0, 0, width, height);
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, '#2a3a52');
  bg.addColorStop(1, '#1a2438');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  const gridW = 16;
  const gridH = 14;
  const cell = Math.floor(Math.min(width / gridW, height / gridH));
  const ox = Math.floor((width - gridW * cell) / 2);
  const oy = Math.floor((height - gridH * cell) / 2);

  const art = ART[key] ?? ART.generic;
  fill(ctx, art, ox, oy, cell);
}

const R = '#c44';
const D = '#422';
const G = '#6a8';
const B = '#48c';
const Y = '#ec4';
const W = '#ddd';
const K = '#222';
const P = '#a6c';
const H = '#8b5';

const ART: Record<PixelArtKey, Pixel[][]> = {
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
    [null, P, P, null],
    [P, W, W, P],
    [P, B, B, P],
    [P, B, B, P],
    [null, G, G, null],
    [null, G, G, null],
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
