import type { PixelArtKey } from '../game/types';
import { applyArtCardMeta, parseArtCardMeta, type ArtCardMetaV1 } from './artMeta';
import { loadArtImageFromUrl } from './artImage';
import { PIXEL_ART_KEYS } from './pixelArt';

export const ART_MANIFEST_VERSION = 1 as const;

export interface ArtManifestEntryV1 {
  png: string;
  highlightB64?: string;
  highlightBreathSpeed?: number;
  animations?: Record<string, unknown>;
  meta?: string;
}

export interface ArtManifestV1 {
  version: typeof ART_MANIFEST_VERSION;
  /** 资源根路径，如 /cards 或 Supabase 公共 URL */
  baseUrl?: string;
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

const DEFAULT_MANIFEST_URL = '/cards/manifest.json';

function isPixelArtKey(key: string): key is PixelArtKey {
  return (PIXEL_ART_KEYS as readonly string[]).includes(key);
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const raw = (baseUrl ?? '/cards').trim() || '/cards';
  return raw.replace(/\/+$/, '');
}

function joinAssetUrl(baseUrl: string, path: string): string {
  const p = path.replace(/^\/+/, '');
  return `${baseUrl}/${p}`;
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
    entries: obj.entries,
  };
}

async function loadMetaFile(url: string): Promise<ArtCardMetaV1 | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  return parseArtCardMeta(await res.json());
}

export async function applyArtManifest(
  manifest: ArtManifestV1,
  onProgress?: (progress: ArtBootstrapProgress) => void
): Promise<void> {
  const baseUrl = normalizeBaseUrl(manifest.baseUrl);
  const keys = Object.keys(manifest.entries).filter(isPixelArtKey);
  const total = keys.length;
  let loaded = 0;

  const report = (artKey?: PixelArtKey): void => {
    onProgress?.({ loaded, total, artKey });
  };

  report();

  await Promise.all(
    keys.map(async (artKey) => {
      const entry = manifest.entries[artKey];
      if (!entry?.png) return;

      const pngUrl = joinAssetUrl(baseUrl, entry.png);
      await loadArtImageFromUrl(artKey, pngUrl);

      if (entry.meta) {
        const meta = await loadMetaFile(joinAssetUrl(baseUrl, entry.meta));
        if (meta) applyArtCardMeta(meta);
      } else {
        applyArtCardMeta({
          version: 1,
          artKey,
          highlightB64: entry.highlightB64,
          highlightBreathSpeed: entry.highlightBreathSpeed,
          animations: entry.animations,
        });
      }

      loaded += 1;
      report(artKey);
    })
  );
}

export async function bootstrapCardArt(options: ArtBootstrapOptions = {}): Promise<ArtManifestV1 | null> {
  const manifestUrl = options.manifestUrl ?? import.meta.env.VITE_ART_MANIFEST_URL ?? DEFAULT_MANIFEST_URL;

  try {
    const res = await fetch(manifestUrl, { cache: 'no-cache' });
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`卡图清单加载失败: ${res.status}`);
    }
    const manifest = parseArtManifest(await res.json());
    if (!manifest) throw new Error('卡图清单格式无效');
    await applyArtManifest(manifest, options.onProgress);
    return manifest;
  } catch (err) {
    console.warn('[art] 未加载远程卡图，使用默认占位', err);
    return null;
  }
}

export function manifestEntryFromFiles(
  artKey: PixelArtKey,
  meta: ArtCardMetaV1 | null,
  pngFilename = `${artKey}.png`
): ArtManifestEntryV1 | null {
  if (!meta) return { png: pngFilename };
  return entryFromMeta(meta, pngFilename);
}
