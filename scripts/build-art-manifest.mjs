#!/usr/bin/env node
/**
 * 扫描 public/cards 下的 *.png + *.meta.json，生成 manifest.json。
 *
 * 用法:
 *   1. 绘制页「导出资源包」→ 得到 lvbu.png + lvbu.meta.json
 *   2. 将文件放入 public/cards/
 *   3. npm run build-art-manifest
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARDS_DIR = path.join(ROOT, 'public/cards');
const MANIFEST_PATH = path.join(CARDS_DIR, 'manifest.json');

const PIXEL_ART_KEYS = new Set([
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
]);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function main() {
  const files = readdirSync(CARDS_DIR);
  const pngKeys = new Map();

  for (const file of files) {
    const m = file.match(/^(.+)\.png$/i);
    if (!m) continue;
    const key = m[1];
    if (!PIXEL_ART_KEYS.has(key)) {
      console.warn(`[skip] 未知 artKey: ${key}.png`);
      continue;
    }
    pngKeys.set(key, file);
  }

  let baseUrl = '/cards';
  try {
    const existing = readJson(MANIFEST_PATH);
    if (typeof existing.baseUrl === 'string' && existing.baseUrl.trim()) {
      baseUrl = existing.baseUrl.trim().replace(/\/+$/, '');
    }
  } catch {
    /* 首次生成 */
  }

  const entries = {};

  for (const [artKey, pngFile] of pngKeys.entries()) {
    const metaFile = `${artKey}.meta.json`;
    const metaPath = path.join(CARDS_DIR, metaFile);
    const entry = { png: pngFile };

    if (files.includes(metaFile)) {
      try {
        const meta = readJson(metaPath);
        if (meta.highlightB64) entry.highlightB64 = meta.highlightB64;
        if (typeof meta.highlightBreathSpeed === 'number') {
          entry.highlightBreathSpeed = meta.highlightBreathSpeed;
        }
        if (meta.animations && typeof meta.animations === 'object') {
          entry.animations = meta.animations;
        }
      } catch (err) {
        console.warn(`[warn] 无法解析 ${metaFile}:`, err.message);
      }
    }

    entries[artKey] = entry;
  }

  const manifest = {
    version: 1,
    baseUrl,
    entries,
  };

  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${MANIFEST_PATH} (${Object.keys(entries).length} entries, baseUrl=${baseUrl})`);
}

main();
