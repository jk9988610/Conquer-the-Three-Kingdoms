/**
 * 将所有 BASE_ART 卡牌像素图设为同一套 50×70 网格（中心蓝色方块）。
 * 运行: node scripts/set-unified-card-art.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'src/art/pixelArt.ts');

const BLUE = 'rgba(0,78,255,1.00)';
const ROWS = 70;
const COLS = 50;

const KEYS = [
  'generic',
  'lvbu',
  'liu',
  'guan',
  'zhang',
  'heal-potion',
  'fangtian',
  'attack-red',
  'attack-orange',
  'attack-purple',
];

function buildGrid() {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const x0 = Math.floor((7 * COLS) / 16);
  const y0 = Math.floor((7 * ROWS) / 22);
  const bw = Math.max(1, Math.round((4 * COLS) / 16));
  const bh = Math.max(1, Math.round((4 * ROWS) / 22));
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const gy = y0 + y;
      const gx = x0 + x;
      if (gy < ROWS && gx < COLS) grid[gy][gx] = BLUE;
    }
  }
  return grid;
}

function gridToTs(grid) {
  const lines = grid.map((row) => {
    const cells = row.map((c) => (c === null ? 'null' : JSON.stringify(c)));
    return `    [${cells.join(', ')}],`;
  });
  return `[\n${lines.join('\n')}\n  ]`;
}

const grid = buildGrid();
const gridTs = gridToTs(grid);
const baseEntries = KEYS.map((k) => `  '${k}': cloneGrid(UNIFIED_CARD_ART),`).join('\n');

const tail = readFileSync(TARGET, 'utf8').match(
  /const customOverrides[\s\S]*$/
)?.[0];
if (!tail) {
  throw new Error('Could not find tail section in pixelArt.ts');
}

const head = `import type { PixelArtKey } from '../game/types';
import { ART_GRID_COLS, ART_GRID_ROWS } from './gridConfig';

export { ART_GRID_COLS, ART_GRID_ROWS } from './gridConfig';

export type Pixel = string | null;
export type PixelGrid = Pixel[][];

/** 全卡牌统一像素图：50×70，中心蓝色块（由 scripts/set-unified-card-art.mjs 生成） */
const UNIFIED_CARD_ART: PixelGrid = ${gridTs};

function cloneGrid(grid: PixelGrid): PixelGrid {
  return grid.map((row) => [...row]);
}

const BASE_ART: Record<PixelArtKey, PixelGrid> = {
${baseEntries}
};

`;

writeFileSync(TARGET, head + tail);
console.log(`Updated ${TARGET} — ${KEYS.length} cards use unified ${COLS}×${ROWS} art.`);
