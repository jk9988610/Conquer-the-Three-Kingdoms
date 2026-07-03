import type { PixelV1Image } from './pixelV1';

export interface ArtShopItem {
  id: string;
  title: string;
  text: string;
  image?: PixelV1Image | null;
  publishedAt?: string;
  pngPath?: string;
  previewUrl?: string | null;
}

export type ArtShopListSource = 'cloud' | 'cache' | 'builtin';

export interface ArtShopListResult {
  items: ArtShopItem[];
  source: ArtShopListSource;
  cloudError?: string;
}
