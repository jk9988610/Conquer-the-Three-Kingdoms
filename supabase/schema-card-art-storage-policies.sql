-- =============================================================================
-- 征战三国 — card-art 桶 Storage 策略（SQL Editor 执行）
-- =============================================================================
-- 前提：storage.buckets 中已有 id = card-art 且 public = true
-- 上传：本地/CI 使用 service_role（scripts/upload-art-supabase.mjs），可绕过 RLS
-- 读取：游戏前端匿名 GET 公共 URL
-- =============================================================================

-- 公开读取（游戏加载 manifest.json 与 PNG）
drop policy if exists "card_art_public_read" on storage.objects;
create policy "card_art_public_read"
  on storage.objects for select
  using (bucket_id = 'card-art');

-- 可选：允许匿名上传/更新（仅开发期；生产建议删掉，只用 service_role + CI）
drop policy if exists "card_art_anon_insert" on storage.objects;
create policy "card_art_anon_insert"
  on storage.objects for insert
  with check (bucket_id = 'card-art');

drop policy if exists "card_art_anon_update" on storage.objects;
create policy "card_art_anon_update"
  on storage.objects for update
  using (bucket_id = 'card-art');
