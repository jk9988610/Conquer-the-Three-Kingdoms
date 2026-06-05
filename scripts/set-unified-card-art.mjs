/**
 * 将所有 BASE_ART 卡牌像素图设为同一套 16×22 网格（中心蓝色方块）。
 * 运行: node scripts/set-unified-card-art.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'src/art/pixelArt.ts');

const BLUE = 'rgba(0,78,255,1.00)';
const ROWS = 22;
const COLS = 16;

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
  for (let y = 7; y <= 10; y++) {
    for (let x = 7; x <= 10; x++) {
      grid[y][x] = BLUE;
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

export type Pixel = string | null;
export type PixelGrid = Pixel[][];

/** 全卡牌统一像素图：16×22，中心 4×4 蓝色块（由 scripts/set-unified-card-art.mjs 生成） */
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
