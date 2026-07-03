import { getCachedManifest } from './artCache';
import { fetchRemoteManifest } from './artCloudUpload';
import type { ArtManifestV1 } from './artManifest';
import { getCardArtPublicBaseUrl, isCloudArtConfigured } from './cloudConfig';
import { listBuiltinArtShopItems } from './artShopFallback';
import type { ArtShopItem, ArtShopListResult } from './artShopTypes';

export type { ArtShopItem, ArtShopListResult, ArtShopListSource } from './artShopTypes';

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
    return '无法连接云端卡图库（与「上传云端」同一地址）';
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function previewUrlForEntry(manifest: ArtManifestV1, png: string): string {
  const base = (manifest.baseUrl ?? getCardArtPublicBaseUrl()).replace(/\/+$/, '');
  const file = png.replace(/^\//, '');
  if (/^https?:\/\//i.test(base)) {
    return `${base}/${file}`;
  }
  const siteBase = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const assetBase = base.startsWith('/') ? base.replace(/^\//, '') : base.replace(/^\/+/, '');
  return new URL(`${assetBase}/${file}`, new URL(siteBase, window.location.origin)).href;
}

function manifestToArtShopItems(manifest: ArtManifestV1): ArtShopItem[] {
  const items: ArtShopItem[] = [];
  for (const [artKey, entry] of Object.entries(manifest.entries)) {
    if (!entry?.png) continue;
    items.push({
      id: artKey,
      title: artKey,
      text: entry.updatedAt
        ? `更新于 ${new Date(entry.updatedAt).toLocaleString()}`
        : '',
      previewUrl: previewUrlForEntry(manifest, entry.png),
      publishedAt: entry.updatedAt ?? manifest.updatedAt,
      pngPath: entry.png,
    });
  }
  items.sort(
    (a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime()
  );
  return items;
}

/** 与「上传云端」同源：读取 Supabase card-art/manifest.json */
export async function listArtShopItems(): Promise<ArtShopListResult> {
  let cloudError: string | undefined;

  if (isCloudArtConfigured() && navigator.onLine) {
    try {
      const manifest = await fetchRemoteManifest();
      const items = manifest ? manifestToArtShopItems(manifest) : [];
      return { items, source: 'cloud' };
    } catch (err) {
      cloudError = formatCloudError(err);
      console.warn('card-art manifest fetch failed:', err);
    }
  }

  try {
    const cached = await getCachedManifest();
    if (cached && Object.keys(cached.entries).length > 0) {
      return {
        items: manifestToArtShopItems(cached),
        source: 'cache',
        cloudError,
      };
    }
  } catch (err) {
    console.warn('cached card-art manifest read failed:', err);
  }

  try {
    const items = await listBuiltinArtShopItems();
    return { items, source: 'builtin', cloudError };
  } catch (fallbackErr) {
    const cloudMsg = cloudError ?? '云端卡图库不可用';
    const fallbackMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
    throw new Error(`${cloudMsg}；内置卡图也加载失败：${fallbackMsg}`);
  }
}
