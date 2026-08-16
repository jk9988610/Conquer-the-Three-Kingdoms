#!/usr/bin/env node
/**
 * 构建 APK/OTA 时，将 Supabase 卡图下载到 www/cards/，供 Capacitor 本地加载。
 * 避免 APK 运行时仅依赖外网 fetch（WebView 上易失败 → 蓝色默认色块）。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cardsDir = join(root, 'www', 'cards');

const manifestUrl =
  process.env.VITE_ART_MANIFEST_URL ||
  'https://yjqkotqmglxjhlrhynsu.supabase.co/storage/v1/object/public/card-art/manifest.json';

function assetBaseFromManifest(manifest) {
  const raw = String(manifest?.baseUrl ?? '').trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(raw)) return raw;
  return manifestUrl.replace(/\/manifest\.json$/i, '');
}

function joinUrl(base, file) {
  return `${base.replace(/\/+$/, '')}/${String(file).replace(/^\/+/, '')}`;
}

async function downloadTo(fileName, url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const wwwIndex = join(root, 'www', 'index.html');
  const { existsSync } = await import('node:fs');
  if (!existsSync(wwwIndex)) {
    console.warn('www/ 不存在，跳过卡图捆绑（请先 Vite CAPACITOR_BUILD）');
    process.exit(0);
  }

  let manifest;
  try {
    const res = await fetch(manifestUrl, { cache: 'no-store' });
    if (!res.ok) {
      console.warn(`无法拉取卡图清单 HTTP ${res.status}，APK 将尝试运行时从网络加载`);
      process.exit(0);
    }
    manifest = await res.json();
  } catch (err) {
    console.warn('拉取卡图清单失败，APK 将尝试运行时从网络加载:', err?.message || err);
    process.exit(0);
  }

  const entries = manifest?.entries ?? {};
  const keys = Object.keys(entries);
  if (keys.length === 0) {
    console.warn('Supabase 卡图清单为空：请先在网页「绘制」上传云端，再重新 cap:sync');
    process.exit(0);
  }

  mkdirSync(cardsDir, { recursive: true });
  const assetBase = assetBaseFromManifest(manifest);
  let downloaded = 0;

  for (const artKey of keys) {
    const entry = entries[artKey];
    if (!entry?.png) continue;
    try {
      const pngBytes = await downloadTo(entry.png, joinUrl(assetBase, entry.png));
      writeFileSync(join(cardsDir, entry.png), pngBytes);
      downloaded += 1;
      if (entry.meta) {
        try {
          const metaBytes = await downloadTo(entry.meta, joinUrl(assetBase, entry.meta));
          writeFileSync(join(cardsDir, entry.meta), metaBytes);
        } catch (err) {
          console.warn(`[skip] ${artKey} meta: ${err?.message || err}`);
        }
      }
    } catch (err) {
      console.warn(`[skip] ${artKey} png: ${err?.message || err}`);
    }
  }

  const bundled = {
    version: manifest.version ?? 1,
    baseUrl: 'cards',
    updatedAt: manifest.updatedAt,
    entries: manifest.entries,
  };
  writeFileSync(join(cardsDir, 'manifest.json'), `${JSON.stringify(bundled, null, 2)}\n`);

  console.log(`已捆绑 ${downloaded}/${keys.length} 张卡图 → www/cards/（APK 本地加载）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
