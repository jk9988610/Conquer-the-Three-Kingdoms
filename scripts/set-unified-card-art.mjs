/**
 * 将所有 BASE_ART 卡牌像素图设为同一套网格（中心蓝色方块）。
 * 运行: node scripts/set-unified-card-art.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'src/art/pixelArt.ts');
const GRID_CONFIG = path.join(ROOT, 'src/art/gridConfig.ts');

const BLUE = 'rgba(0,78,255,1.00)';

const configSrc = readFileSync(GRID_CONFIG, 'utf8');
const colsMatch = configSrc.match(/ART_GRID_COLS\s*=\s*(\d+)/);
const rowsMatch = configSrc.match(/ART_GRID_ROWS\s*=\s*(\d+)/);
const COLS = colsMatch ? Number(colsMatch[1]) : 200;
const ROWS = rowsMatch ? Number(rowsMatch[1]) : 280;

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

const gridTs = gridToTs(buildGrid());
let content = readFileSync(TARGET, 'utf8');
content = content.replace(
  /\/\*\* 全卡牌统一像素图：[\s\S]*?\*\/\nconst UNIFIED_CARD_ART: PixelGrid = \[[\s\S]*?\n  \];/,
  `/** 全卡牌统一像素图：${COLS}×${ROWS}，中心蓝色块（由 scripts/set-unified-card-art.mjs 生成） */\nconst UNIFIED_CARD_ART: PixelGrid = ${gridTs};`
);
content = content.replace(
  /将任意尺寸网格最近邻缩放到标准 \d+×\d+/,
  `将任意尺寸网格最近邻缩放到标准 ${COLS}×${ROWS}`
);

writeFileSync(TARGET, content);
console.log(`Updated ${TARGET} — unified ${COLS}×${ROWS} art.`);
