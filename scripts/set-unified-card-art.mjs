/**
 * 默认卡图由 createDefaultCardArtPacked() 在运行时生成（见 packedGrid.ts）。
 * 本脚本仅校验 gridConfig 尺寸并提示，不再向 pixelArt.ts 写入巨型 JSON。
 * 运行: node scripts/set-unified-card-art.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GRID_CONFIG = path.join(ROOT, 'src/art/gridConfig.ts');

const configSrc = readFileSync(GRID_CONFIG, 'utf8');
const colsMatch = configSrc.match(/ART_GRID_COLS\s*=\s*(\d+)/);
const rowsMatch = configSrc.match(/ART_GRID_ROWS\s*=\s*(\d+)/);
const COLS = colsMatch ? Number(colsMatch[1]) : 500;
const ROWS = rowsMatch ? Number(rowsMatch[1]) : 700;

console.log(
  `Default card art is procedural (${COLS}×${ROWS}) via createDefaultCardArtPacked() in src/art/packedGrid.ts — no JSON embed needed.`
);
