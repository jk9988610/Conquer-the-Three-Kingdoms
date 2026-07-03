import {
  ART_SHOP_BUCKET,
  ART_STORE_PREFIX,
  SUPABASE_URL,
  isCloudArtConfigured,
} from './cloudConfig';
import { listBuiltinArtShopItems } from './artShopFallback';
import type { ArtShopItem, ArtShopListResult } from './artShopTypes';
import type { PixelV1Image } from './pixelV1';
import { getSupabaseClient } from './supabaseClient';

export type { ArtShopItem, ArtShopListResult, ArtShopListSource } from './artShopTypes';

function formatStorageError(err: { message?: string } | null): string {
  const msg = err?.message ?? '未知错误';
  if (msg.includes('Bucket not found')) {
    return 'Storage 桶 art 不存在，请先在 Supabase 创建 Public 桶';
  }
  if (msg.includes('policy') || msg.includes('Permission') || msg.includes('403')) {
    return 'Storage 权限不足，请检查 art 桶策略';
  }
  return msg;
}

function isNetworkFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed')
  );
}

function formatCloudError(err: unknown): string {
  if (isNetworkFetchError(err)) {
    return '无法连接云端（Supabase 未就绪或网络受限），已显示内置卡图';
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function publicUrl(path: string): string {
  const base = `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/${ART_SHOP_BUCKET}`;
  return `${base}/${path.replace(/^\//, '')}`;
}

async function listCloudArtShopItems(): Promise<ArtShopItem[]> {
  const sb = getSupabaseClient();

  const { data: rows, error: dbError } = await sb
    .from('art_shop_works')
    .select('id,title,body,png_path,meta_path,pixel_image,published_at')
    .order('published_at', { ascending: false })
    .limit(100);

  if (!dbError && rows?.length) {
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      text: row.body ?? '',
      image: (row.pixel_image as PixelV1Image | null) ?? null,
      publishedAt: row.published_at ?? undefined,
      pngPath: row.png_path ?? undefined,
      previewUrl: row.png_path ? publicUrl(row.png_path) : null,
    }));
  }

  if (dbError) {
    console.warn('art_shop_works list fallback to storage:', dbError.message);
  }

  const { data: folders, error } = await sb.storage.from(ART_SHOP_BUCKET).list(ART_STORE_PREFIX, {
    limit: 100,
    sortBy: { column: 'created_at', order: 'desc' },
  });
  if (error) throw new Error(formatStorageError(error));

  const items: ArtShopItem[] = [];
  for (const row of folders || []) {
    if (!row?.name || row.name.includes('.')) continue;
    const workId = row.name;
    const metaPath = `${ART_STORE_PREFIX}/${workId}/meta.json`;
    try {
      const { data: blob, error: dlErr } = await sb.storage.from(ART_SHOP_BUCKET).download(metaPath);
      if (dlErr) continue;
      const meta = JSON.parse(await blob.text()) as {
        id?: string;
        title?: string;
        text?: string;
        image?: PixelV1Image;
        publishedAt?: string;
      };
      const pngPath = `${ART_STORE_PREFIX}/${workId}/image.png`;
      items.push({
        id: meta.id || workId,
        title: meta.title || 'Work',
        text: meta.text ?? '',
        image: meta.image ?? null,
        publishedAt: meta.publishedAt,
        pngPath,
        previewUrl: publicUrl(pngPath),
      });
    } catch {
      /* skip */
    }
  }
  items.sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime());
  return items;
}

export async function listArtShopItems(): Promise<ArtShopListResult> {
  if (!isCloudArtConfigured()) {
    const items = await listBuiltinArtShopItems();
    return { items, source: 'builtin' };
  }

  try {
    const items = await listCloudArtShopItems();
    if (items.length > 0) {
      return { items, source: 'cloud' };
    }
    return { items, source: 'cloud' };
  } catch (err) {
    console.warn('Art shop cloud load failed:', err);
    try {
      const items = await listBuiltinArtShopItems();
      return {
        items,
        source: 'builtin',
        cloudError: formatCloudError(err),
      };
    } catch (fallbackErr) {
      const cloudMsg = formatCloudError(err);
      const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      throw new Error(`${cloudMsg}；内置卡图也加载失败：${fallbackMsg}`);
    }
  }
}
