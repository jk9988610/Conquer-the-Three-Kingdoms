import type { PixelArtKey } from '../game/types';
import {
  getCachedAsset,
  getCachedManifest,
  saveCachedAsset,
  saveCachedManifest,
  type CachedArtAsset,
} from './artCache';
import { applyArtCardMeta, parseArtCardMeta, type ArtCardMetaV1 } from './artMeta';
import { loadArtImageFromBlob } from './artImage';
import { PIXEL_ART_KEYS } from './pixelArt';

export const ART_MANIFEST_VERSION = 1 as const;

export interface ArtManifestEntryV1 {
  png: string;
  highlightB64?: string;
  highlightBreathSpeed?: number;
  animations?: Record<string, unknown>;
  meta?: string;
  /** 单张卡图更新时间，用于 IndexedDB 缓存校验 */
  updatedAt?: string;
}

export interface ArtManifestV1 {
  version: typeof ART_MANIFEST_VERSION;
  /** 资源根路径，如 /cards 或 Supabase 公共 URL */
  baseUrl?: string;
  /** 清单整体更新时间 */
  updatedAt?: string;
  entries: Partial<Record<PixelArtKey, ArtManifestEntryV1>>;
}

export interface ArtBootstrapProgress {
  loaded: number;
  total: number;
  artKey?: PixelArtKey;
}

export interface ArtBootstrapOptions {
  manifestUrl?: string;
  onProgress?: (progress: ArtBootstrapProgress) => void;
}

/** 未配置 VITE_ART_MANIFEST_URL 时，使用仓库内 public/cards（兼容 GitHub Pages base） */
function defaultManifestUrl(): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}cards/manifest.json`;
}

function isPixelArtKey(key: string): key is PixelArtKey {
  return (PIXEL_ART_KEYS as readonly string[]).includes(key);
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const raw = (baseUrl ?? 'cards').trim() || 'cards';
  return raw.replace(/\/+$/, '');
}

/** 绝对 URL（Supabase）原样拼接；相对路径按 Vite base + 当前站点解析 */
function joinAssetUrl(baseUrl: string, filePath: string): string {
  const file = filePath.replace(/^\/+/, '');
  if (/^https?:\/\//i.test(baseUrl)) {
    return `${baseUrl.replace(/\/+$/, '')}/${file}`;
  }
  const siteBase = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const assetBase = baseUrl.startsWith('/')
    ? baseUrl.replace(/^\//, '')
    : baseUrl.replace(/^\/+/, '');
  return new URL(`${assetBase}/${file}`, new URL(siteBase, window.location.origin)).href;
}

function entryFromMeta(meta: ArtCardMetaV1, png: string): ArtManifestEntryV1 {
  return {
    png,
    highlightB64: meta.highlightB64,
    highlightBreathSpeed: meta.highlightBreathSpeed,
    animations: meta.animations,
  };
}

export function parseArtManifest(raw: unknown): ArtManifestV1 | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Partial<ArtManifestV1>;
  if (obj.version !== ART_MANIFEST_VERSION || !obj.entries || typeof obj.entries !== 'object') {
    return null;
  }
  return {
    version: ART_MANIFEST_VERSION,
    baseUrl: typeof obj.baseUrl === 'string' ? obj.baseUrl : undefined,
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : undefined,
    entries: obj.entries,
  };
}

async function loadMetaFile(url: string): Promise<ArtCardMetaV1 | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return parseArtCardMeta(await res.json());
}

function entryRevision(manifest: ArtManifestV1, entry: ArtManifestEntryV1): string {
  return entry.updatedAt ?? manifest.updatedAt ?? '0';
}

function applyEntryMeta(artKey: PixelArtKey, entry: ArtManifestEntryV1, meta?: ArtCardMetaV1 | null): void {
  if (meta) {
    applyArtCardMeta(meta);
    return;
  }
  applyArtCardMeta({
    version: 1,
    artKey,
    highlightB64: entry.highlightB64,
    highlightBreathSpeed: entry.highlightBreathSpeed,
    animations: entry.animations,
  });
}

async function applyCachedAssetRecord(cached: CachedArtAsset): Promise<void> {
  await loadArtImageFromBlob(cached.artKey, cached.pngBlob);
  applyArtCardMeta({
    version: 1,
    artKey: cached.artKey,
    highlightB64: cached.highlightB64,
    highlightBreathSpeed: cached.highlightBreathSpeed,
  });
}

async function loadArtEntry(
  manifest: ArtManifestV1,
  artKey: PixelArtKey,
  entry: ArtManifestEntryV1,
  baseUrl: string,
  preferNetwork: boolean
): Promise<void> {
  const revision = entryRevision(manifest, entry);
  const cached = await getCachedAsset(artKey);

  if (!preferNetwork && cached && cached.updatedAt === revision) {
    await applyCachedAssetRecord(cached);
    return;
  }

  if (cached && cached.updatedAt === revision) {
    await applyCachedAssetRecord(cached);
    return;
  }

  try {
    const pngUrl = joinAssetUrl(baseUrl, entry.png);
    const res = await fetch(pngUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`PNG ${res.status}`);
    const pngBlob = await res.blob();
    await loadArtImageFromBlob(artKey, pngBlob);

    let meta: ArtCardMetaV1 | null = null;
    if (entry.meta) {
      meta = await loadMetaFile(joinAssetUrl(baseUrl, entry.meta));
    }
    applyEntryMeta(artKey, entry, meta);

    await saveCachedAsset({
      artKey,
      updatedAt: revision,
      pngBlob,
      highlightB64: meta?.highlightB64 ?? entry.highlightB64,
      highlightBreathSpeed: meta?.highlightBreathSpeed ?? entry.highlightBreathSpeed,
    });
  } catch (err) {
    if (cached) {
      console.warn(`[art] 网络加载 ${artKey} 失败，使用本地缓存`, err);
      await applyCachedAssetRecord(cached);
      return;
    }
    throw err;
  }
}

export async function applyArtManifest(
  manifest: ArtManifestV1,
  onProgress?: (progress: ArtBootstrapProgress) => void,
  options: { preferNetwork?: boolean } = {}
): Promise<void> {
  const baseUrl = normalizeBaseUrl(manifest.baseUrl);
  const keys = Object.keys(manifest.entries).filter(isPixelArtKey);
  const total = keys.length;
  let loaded = 0;
  const preferNetwork = options.preferNetwork ?? true;

  const report = (artKey?: PixelArtKey): void => {
    onProgress?.({ loaded, total, artKey });
  };

  report();

  await Promise.all(
    keys.map(async (artKey) => {
      const entry = manifest.entries[artKey];
      if (!entry?.png) return;
      await loadArtEntry(manifest, artKey, entry, baseUrl, preferNetwork);
      loaded += 1;
      report(artKey);
    })
  );
}

export async function bootstrapCardArt(options: ArtBootstrapOptions = {}): Promise<ArtManifestV1 | null> {
  const manifestUrl =
    options.manifestUrl ?? import.meta.env.VITE_ART_MANIFEST_URL ?? defaultManifestUrl();

  let manifest: ArtManifestV1 | null = null;
  let fromNetwork = false;

  try {
    const res = await fetch(manifestUrl, { cache: 'no-cache' });
    if (res.ok) {
      manifest = parseArtManifest(await res.json());
      if (!manifest) throw new Error('卡图清单格式无效');
      fromNetwork = true;
      await saveCachedManifest(manifest);
    } else if (res.status !== 404) {
      throw new Error(`卡图清单加载失败: ${res.status}`);
    }
  } catch (err) {
    console.warn('[art] 远程清单不可用，尝试本地缓存', err);
  }

  if (!manifest) {
    manifest = await getCachedManifest();
  }

  if (!manifest || Object.keys(manifest.entries).length === 0) {
    return null;
  }

  await applyArtManifest(manifest, options.onProgress, { preferNetwork: fromNetwork });
  return manifest;
}

export function manifestEntryFromFiles(
  artKey: PixelArtKey,
  meta: ArtCardMetaV1 | null,
  pngFilename = `${artKey}.png`
): ArtManifestEntryV1 | null {
  if (!meta) return { png: pngFilename };
  return entryFromMeta(meta, pngFilename);
}
