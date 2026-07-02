import {
  ART_SHOP_BUCKET,
  ART_STORE_PREFIX,
  SUPABASE_URL,
  isCloudArtConfigured,
} from './cloudConfig';
import type { PixelV1Image } from './pixelV1';
import { getSupabaseClient } from './supabaseClient';

export interface ArtShopItem {
  id: string;
  title: string;
  text: string;
  image?: PixelV1Image | null;
  publishedAt?: string;
  pngPath?: string;
  previewUrl?: string | null;
}

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

function publicUrl(path: string): string {
  const base = `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/${ART_SHOP_BUCKET}`;
  return `${base}/${path.replace(/^\//, '')}`;
}

export async function listArtShopItems(): Promise<ArtShopItem[]> {
  if (!isCloudArtConfigured()) return [];
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
