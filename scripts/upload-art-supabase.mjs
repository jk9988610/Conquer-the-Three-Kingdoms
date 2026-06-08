#!/usr/bin/env node
/**
 * 将 public/cards 上传到 Supabase Storage，并更新 manifest.json 的 baseUrl。
 *
 * 环境变量:
 *   SUPABASE_URL              项目 URL，如 https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  服务端密钥（仅本地/CI，勿提交仓库）
 *   SUPABASE_ART_BUCKET       桶名，默认 card-art
 *
 * 用法:
 *   npm run build-art-manifest
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run upload-art
 *
 * Supabase 控制台需先创建 public 桶 card-art。
 */
import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARDS_DIR = path.join(ROOT, 'public/cards');
const MANIFEST_PATH = path.join(CARDS_DIR, 'manifest.json');

const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const BUCKET = process.env.SUPABASE_ART_BUCKET?.trim() || 'card-art';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('请设置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const UPLOAD_EXT = new Set(['.png', '.json']);

async function uploadFile(relPath) {
  const abs = path.join(CARDS_DIR, relPath);
  const body = readFileSync(abs);
  const contentType = relPath.endsWith('.png')
    ? 'image/png'
    : 'application/json';
  const { error } = await supabase.storage.from(BUCKET).upload(relPath, body, {
    upsert: true,
    contentType,
  });
  if (error) throw new Error(`${relPath}: ${error.message}`);
  console.log(`uploaded ${relPath}`);
}

async function main() {
  const files = readdirSync(CARDS_DIR).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return UPLOAD_EXT.has(ext);
  });

  for (const file of files) {
    await uploadFile(file);
  }

  const publicBase = `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/${BUCKET}`;
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  manifest.baseUrl = publicBase;
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`manifest baseUrl → ${publicBase}`);
  await uploadFile('manifest.json');
  console.log('完成。将更新后的 manifest.json 提交 GitHub，或在前端设置 VITE_ART_MANIFEST_URL 指向 Supabase URL。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
