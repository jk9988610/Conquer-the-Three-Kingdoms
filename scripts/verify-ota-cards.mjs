#!/usr/bin/env node
/**
 * 校验 OTA zip 是否包含 www/cards/*.png（无卡图则 APK 热更后仍显示蓝色色块）
 *
 * 用法: node scripts/verify-ota-cards.mjs <path-to-zip>
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const zipPath = process.argv[2];
if (!zipPath || !existsSync(zipPath)) {
  console.error('用法: node scripts/verify-ota-cards.mjs <zip路径>');
  process.exit(1);
}

const listing = execSync(`unzip -l "${zipPath}"`, { encoding: 'utf8' });
const pngLines = listing
  .split('\n')
  .filter((line) => /cards\/[^/]+\.png$/i.test(line.replace(/^\s+/, '')));

const pngCount = pngLines.length;
const minRequired = Number(process.env.MIN_OTA_CARD_PNGS ?? '1');

if (pngCount < minRequired) {
  console.error(`[OTA 校验失败] ${zipPath} 仅含 ${pngCount} 张 cards/*.png（至少需要 ${minRequired}）`);
  console.error('构建时未捆绑卡图；请确认 Supabase 有卡图或 public/cards/ 含 PNG');
  process.exit(1);
}

let manifestEntries = 0;
try {
  const manifestRaw = execSync(`unzip -p "${zipPath}" cards/manifest.json`, { encoding: 'utf8' });
  const manifest = JSON.parse(manifestRaw);
  manifestEntries = Object.keys(manifest?.entries ?? {}).length;
} catch {
  /* manifest 缺失由 png 计数兜底 */
}

console.log(
  `OTA 卡图校验通过: ${pngCount} 张 PNG，manifest entries=${manifestEntries}（${zipPath}）`
);
