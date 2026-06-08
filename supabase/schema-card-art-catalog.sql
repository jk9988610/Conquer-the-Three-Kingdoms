-- =============================================================================
-- 征战三国 — 可选：正式卡图目录表（日后素材商店 / 审核上架）
-- =============================================================================
-- Card World 用户 UGC 在 art_shop_works + art 桶 art-store/ 前缀。
-- 本表用于「审核通过、进入正式游戏」的卡图索引，可与 manifest.json 双写或替代。
-- 非必须；当前游戏仅 fetch manifest.json 即可运行。
-- =============================================================================

create table if not exists public.card_art_catalog (
  art_key text primary key,
  title text not null default '',
  png_path text not null,
  meta_path text,
  highlight_b64 text,
  highlight_breath_speed int default 50,
  source_shop_id text,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.card_art_catalog is '征战三国正式卡图目录；文件在 Storage bucket card-art';
comment on column public.card_art_catalog.art_key is '与游戏 catalog artKey 一致，如 lvbu';
comment on column public.card_art_catalog.png_path is '桶内路径，如 lvbu.png';
comment on column public.card_art_catalog.source_shop_id is '若从 Card World art_shop_works 晋升，填原 id';

create index if not exists card_art_catalog_published_at_idx
  on public.card_art_catalog (published_at desc);

alter table public.card_art_catalog enable row level security;

drop policy if exists "card_art_catalog_select" on public.card_art_catalog;
create policy "card_art_catalog_select"
  on public.card_art_catalog for select
  using (true);

drop policy if exists "card_art_catalog_insert" on public.card_art_catalog;
create policy "card_art_catalog_insert"
  on public.card_art_catalog for insert
  with check (true);

drop policy if exists "card_art_catalog_update" on public.card_art_catalog;
create policy "card_art_catalog_update"
  on public.card_art_catalog for update
  using (true)
  with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.card_art_catalog to anon, authenticated;
