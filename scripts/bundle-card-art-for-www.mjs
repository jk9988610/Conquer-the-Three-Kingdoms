#!/usr/bin/env node
/**
 * 构建 APK/OTA 时，将 Supabase 卡图下载到 www/cards/，供 Capacitor 本地加载。
 * 避免 APK 运行时仅依赖外网 fetch（WebView 上易失败 → 蓝色默认色块）。
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wwwCardsDir = join(root, 'www', 'cards');
const publicCardsDir = join(root, 'public', 'cards');

const manifestUrl =
  process.env.VITE_ART_MANIFEST_URL ||
  'https://yjqkotqmglxjhlrhynsu.supabase.co/storage/v1/object/public/card-art/manifest.json';

const PIXEL_ART_KEYS = [
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

const isCI =
  process.env.GITHUB_ACTIONS === 'true' || process.env.REQUIRE_CARD_ART_BUNDLE === '1';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assetBaseFromManifest(manifest) {
  const raw = String(manifest?.baseUrl ?? '').trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(raw)) return raw;
  return manifestUrl.replace(/\/manifest\.json$/i, '');
}

function joinUrl(base, file) {
  return `${base.replace(/\/+$/, '')}/${String(file).replace(/^\/+/, '')}`;
}

async function fetchWithRetry(url, options = {}, retries = 3) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const res = await fetch(url, { ...options, cache: 'no-store' });
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < retries - 1) await sleep(1500 * (attempt + 1));
  }
  throw lastErr ?? new Error('fetch failed');
}

async function downloadTo(url) {
  const res = await fetchWithRetry(url);
  return Buffer.from(await res.arrayBuffer());
}

async function headOk(url) {
  try {
    const res = await fetchWithRetry(url, { method: 'HEAD' }, 2);
    return res.ok;
  } catch {
    return false;
  }
}

function readLocalManifest() {
  for (const dir of [publicCardsDir, wwwCardsDir]) {
    const path = join(dir, 'manifest.json');
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      if (raw?.entries && Object.keys(raw.entries).length > 0) return raw;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function copyLocalPngsToWww() {
  if (!existsSync(publicCardsDir)) return 0;
  mkdirSync(wwwCardsDir, { recursive: true });
  let copied = 0;
  for (const file of readdirSync(publicCardsDir)) {
    if (!/\.png$/i.test(file)) continue;
    const dest = join(wwwCardsDir, file);
    if (!existsSync(dest)) {
      copyFileSync(join(publicCardsDir, file), dest);
      copied += 1;
    }
  }
  return copied;
}

function buildManifestFromLocalPngs(baseUrl = 'cards') {
  if (!existsSync(wwwCardsDir)) return null;
  const files = readdirSync(wwwCardsDir);
  const entries = {};
  const updatedAt = new Date().toISOString();
  for (const file of files) {
    const m = file.match(/^(.+)\.png$/i);
    if (!m) continue;
    const artKey = m[1];
    if (!PIXEL_ART_KEYS.includes(artKey)) continue;
    const entry = { png: file, updatedAt };
    const metaFile = `${artKey}.meta.json`;
    if (files.includes(metaFile)) entry.meta = metaFile;
    entries[artKey] = entry;
  }
  if (Object.keys(entries).length === 0) return null;
  return {
    version: 1,
    baseUrl,
    updatedAt,
    entries,
  };
}

async function fetchRemoteManifest() {
  const res = await fetchWithRetry(manifestUrl);
  return res.json();
}

async function discoverEntriesFromStorage(assetBase) {
  const entries = {};
  const updatedAt = new Date().toISOString();
  for (const artKey of PIXEL_ART_KEYS) {
    const png = `${artKey}.png`;
    const pngUrl = joinUrl(assetBase, png);
    if (!(await headOk(pngUrl))) continue;
    const entry = { png, updatedAt };
    const meta = `${artKey}.meta.json`;
    if (await headOk(joinUrl(assetBase, meta))) entry.meta = meta;
    entries[artKey] = entry;
  }
  return entries;
}

async function downloadEntries(manifest, assetBase) {
  mkdirSync(wwwCardsDir, { recursive: true });
  const entries = manifest.entries ?? {};
  const keys = Object.keys(entries);
  let downloaded = 0;

  for (const artKey of keys) {
    const entry = entries[artKey];
    if (!entry?.png) continue;
    const pngPath = join(wwwCardsDir, entry.png);
    try {
      const pngBytes = await downloadTo(joinUrl(assetBase, entry.png));
      writeFileSync(pngPath, pngBytes);
      downloaded += 1;
      if (entry.meta) {
        try {
          const metaBytes = await downloadTo(joinUrl(assetBase, entry.meta));
          writeFileSync(join(wwwCardsDir, entry.meta), metaBytes);
        } catch (err) {
          console.warn(`[skip] ${artKey} meta: ${err?.message || err}`);
        }
      }
    } catch (err) {
      if (existsSync(pngPath)) {
        console.warn(`[keep] ${artKey} 远程失败，保留已有本地 PNG`);
        downloaded += 1;
      } else {
        console.warn(`[skip] ${artKey} png: ${err?.message || err}`);
      }
    }
  }

  return downloaded;
}

function writeBundledManifest(manifest) {
  const bundled = {
    version: manifest.version ?? 1,
    baseUrl: 'cards',
    updatedAt: manifest.updatedAt ?? new Date().toISOString(),
    entries: manifest.entries ?? {},
  };
  writeFileSync(join(wwwCardsDir, 'manifest.json'), `${JSON.stringify(bundled, null, 2)}\n`);
}

function countWwwPngs() {
  if (!existsSync(wwwCardsDir)) return 0;
  return readdirSync(wwwCardsDir).filter((f) => /\.png$/i.test(f)).length;
}

async function main() {
  const wwwIndex = join(root, 'www', 'index.html');
  if (!existsSync(wwwIndex)) {
    const msg = 'www/ 不存在，请先执行 Vite CAPACITOR_BUILD（prepare-www / cap:sync）';
    if (isCI) {
      console.error(msg);
      process.exit(1);
    }
    console.warn(msg);
    process.exit(0);
  }

  mkdirSync(wwwCardsDir, { recursive: true });
  const localCopied = copyLocalPngsToWww();
  if (localCopied > 0) {
    console.log(`已从 public/cards 复制 ${localCopied} 张 PNG → www/cards/`);
  }

  let manifest = readLocalManifest();
  let assetBase = manifestUrl.replace(/\/manifest\.json$/i, '');

  if (!manifest) {
    try {
      const remote = await fetchRemoteManifest();
      const remoteEntries = remote?.entries ?? {};
      if (Object.keys(remoteEntries).length > 0) {
        manifest = remote;
        assetBase = assetBaseFromManifest(remote);
        console.log(`Supabase 清单: ${Object.keys(remoteEntries).length} 条卡图`);
      } else {
        console.warn('Supabase 清单 entries 为空，尝试按文件名探测 PNG…');
        const discovered = await discoverEntriesFromStorage(assetBase);
        if (Object.keys(discovered).length > 0) {
          manifest = {
            version: 1,
            updatedAt: new Date().toISOString(),
            baseUrl: assetBase,
            entries: discovered,
          };
          console.log(`探测到 ${Object.keys(discovered).length} 张云端 PNG`);
        }
      }
    } catch (err) {
      console.warn('拉取 Supabase 清单失败:', err?.message || err);
    }
  }

  let downloaded = 0;
  if (manifest && Object.keys(manifest.entries ?? {}).length > 0) {
    downloaded = await downloadEntries(manifest, assetBase);
    writeBundledManifest(manifest);
    console.log(
      `已捆绑 ${downloaded}/${Object.keys(manifest.entries).length} 张卡图 → www/cards/（APK/OTA 本地加载）`
    );
  } else {
    const localManifest = buildManifestFromLocalPngs();
    if (localManifest) {
      writeBundledManifest(localManifest);
      downloaded = countWwwPngs();
      console.log(`使用 www/cards 本地 PNG 生成清单（${downloaded} 张）`);
    }
  }

  const pngCount = countWwwPngs();
  if (pngCount === 0) {
    const msg =
      '未捆绑任何卡图 PNG：请在网页「绘制」上传云端，或将 *.png 放入 public/cards/ 后重试';
    if (isCI) {
      console.error(`[CI 失败] ${msg}`);
      console.error('提示：确认 Supabase card-art/manifest.json 有 entries，或仓库 public/cards/ 含 PNG');
      process.exit(1);
    }
    console.warn(msg);
    process.exit(0);
  }

  console.log(`www/cards 合计 ${pngCount} 张 PNG，清单已写入 www/cards/manifest.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
