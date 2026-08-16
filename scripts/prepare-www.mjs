#!/usr/bin/env node
/** 构建 Capacitor webDir（www/），使用相对 base（./） */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'www');

const artManifestUrl =
  process.env.VITE_ART_MANIFEST_URL ||
  'https://yjqkotqmglxjhlrhynsu.supabase.co/storage/v1/object/public/card-art/manifest.json';

execSync('npm run build', {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    CAPACITOR_BUILD: 'true',
    VITE_ART_MANIFEST_URL: artManifestUrl,
  },
});

if (!existsSync(join(www, 'index.html'))) {
  console.error('www/ 构建失败');
  process.exit(1);
}

execSync('node scripts/bundle-card-art-for-www.mjs', {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_ART_MANIFEST_URL: artManifestUrl,
  },
});

console.log('www/ 已就绪（Vite outDir=www，base=./，供 Capacitor / OTA 使用）');
