-- =============================================================================
-- 征战三国 — 卡图 CDN 桶 card-art（Supabase SQL Editor）
-- =============================================================================
-- 与 Card-World 共用同一 Supabase 项目（见 Card-World js/cloud-config.js）：
--   - art   桶 + art_shop_works 表  → Card World 用户素材商店（UGC）
--   - audio 桶 + published_works 表 → HarmonyForge 编曲发布
--   - card-art 桶                   → 本游戏正式卡图（PNG + manifest.json）
--
-- 执行顺序：
--   1) 本文件（建桶，若 Dashboard 已建可跳过 INSERT，只跑策略部分）
--   2) schema-card-art-storage-policies.sql
-- =============================================================================

-- 方式 A：纯 SQL 建 Public 桶（与 Dashboard「New bucket」等价）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'card-art',
  'card-art',
  true,
  5242880,
  array['image/png', 'application/json']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on table storage.buckets is 'card-art: 征战三国正式卡图；路径示例 lvbu.png / manifest.json';
