#!/usr/bin/env node
/**
 * 构建 OTA 网页包 + 清单（部署到 GitHub Pages /updates/）
 * Vite 项目：zip 内容为 www/（= CAPACITOR_BUILD 的 dist），无需 node_modules
 */

import { execSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const updatesDir = join(root, 'updates');
const appId = 'com.tcg.threekingdoms';
const pagesBase = 'https://jk9988610.github.io/Conquer-the-Three-Kingdoms/updates';

const runNo = process.env.GITHUB_RUN_NUMBER || '0';
const version = process.env.OTA_VERSION || `1.0.${runNo}`;
const zipName = `www-${version}`;

const artManifestUrl =
  process.env.VITE_ART_MANIFEST_URL ||
  'https://yjqkotqmglxjhlrhynsu.supabase.co/storage/v1/object/public/card-art/manifest.json';

mkdirSync(updatesDir, { recursive: true });

const siteBuildTs = join(root, 'src/site-build.ts');
writeFileSync(
  siteBuildTs,
  `/** OTA 网页构建版本 — 由 scripts/build-ota.mjs 生成 */\nexport const SITE_OTA_VERSION = '${version}';\n`
);

execSync('node scripts/prepare-www.mjs', {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    VITE_ART_MANIFEST_URL: artManifestUrl,
  },
});

const metaRaw = execSync(
  `npx @capgo/cli bundle zip ${appId} --path www --json --bundle ${version} -n ${zipName}`,
  { cwd: root, encoding: 'utf8' }
);

const meta = JSON.parse(metaRaw);
const checksum = meta.checksum;
const builtPath = join(root, zipName);
const destZip = join(updatesDir, `${zipName}.zip`);

if (!checksum || !existsSync(builtPath)) {
  console.error('OTA 打包失败', meta);
  process.exit(1);
}

if (existsSync(destZip)) rmSync(destZip);
renameSync(builtPath, destZip);

const wwwJson = {
  version,
  url: `${pagesBase}/${zipName}.zip`,
  checksum,
};
writeFileSync(join(updatesDir, 'www.json'), JSON.stringify(wwwJson, null, 2) + '\n');

const apkPath = join(updatesDir, 'apk.json');
let apk = {
  versionCode: 1,
  apkUrl: '',
  message: '征战三国壳层有更新，是否下载新 APK 安装？',
};
if (existsSync(apkPath)) {
  try {
    apk = { ...apk, ...JSON.parse(readFileSync(apkPath, 'utf8')) };
  } catch {
    /* keep */
  }
}
writeFileSync(apkPath, JSON.stringify(apk, null, 2) + '\n');

const distUpdates = join(root, 'dist', 'updates');
mkdirSync(distUpdates, { recursive: true });
writeFileSync(join(distUpdates, 'www.json'), JSON.stringify(wwwJson, null, 2) + '\n');
if (existsSync(destZip)) {
  cpSync(destZip, join(distUpdates, `${zipName}.zip`));
}
writeFileSync(join(distUpdates, 'apk.json'), JSON.stringify(apk, null, 2) + '\n');

console.log(`OTA 已生成 v${version}`);
console.log(JSON.stringify(wwwJson, null, 2));
