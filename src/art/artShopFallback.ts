import type { ArtShopItem } from './artShopTypes';

export interface BuiltinArtShopManifestV1 {
  version: number;
  updatedAt?: string;
  items: Array<{
    id: string;
    title: string;
    text?: string;
    png: string;
  }>;
}

function builtinManifestUrl(): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}art-shop/manifest.json`;
}

function builtinAssetUrl(png: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}art-shop/${png.replace(/^\//, '')}`;
}

export async function listBuiltinArtShopItems(): Promise<ArtShopItem[]> {
  const url = builtinManifestUrl();
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(`内置卡图清单加载失败（${res.status}）`);
  }
  const manifest = (await res.json()) as BuiltinArtShopManifestV1;
  if (!manifest?.items?.length) return [];

  return manifest.items.map((item) => ({
    id: item.id,
    title: item.title,
    text: item.text ?? '',
    previewUrl: builtinAssetUrl(item.png),
    publishedAt: manifest.updatedAt,
  }));
}
