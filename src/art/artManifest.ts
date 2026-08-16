import type { PixelArtKey } from '../game/types';
import {
  getCachedAsset,
  getCachedManifestRecord,
  saveCachedAsset,
  saveCachedManifest,
  clearCachedManifest,
  touchCachedAsset,
  type CachedArtAsset,
} from './artCache';
import { artManifestMatchesCached } from './artManifestCompare';
import { getCardArtManifestUrl, getCardArtPublicBaseUrl, isCloudArtConfigured } from './cloudConfig';
import { isNativeShell } from '../ota/native-bridge';
import { applyArtCardMeta, parseArtCardMeta, type ArtCardMetaV1 } from './artMeta';
import { loadArtImageFromBlob, loadArtImageFromUrl } from './artImage';
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
  /** 启动时优先加载的 artKey；其余在 requestIdleCallback 后台加载 */
  priorityArtKeys?: PixelArtKey[];
}

/** 未配置 VITE_ART_MANIFEST_URL 时，使用仓库内 public/cards（兼容 GitHub Pages base） */
function defaultManifestUrl(): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}cards/manifest.json`;
}

/** APK / 本地构建未注入 env 时，回退到 Supabase 公共清单 */
function resolveManifestUrl(explicit?: string): string {
  if (explicit) return explicit;
  // APK 优先读构建时打入 www/cards/ 的本地清单（不依赖运行时外网）
  if (isNativeShell()) return defaultManifestUrl();
  const fromEnv = import.meta.env.VITE_ART_MANIFEST_URL;
  if (fromEnv) return fromEnv;
  if (isCloudArtConfigured()) return getCardArtManifestUrl();
  return defaultManifestUrl();
}

export function getResolvedArtManifestUrl(explicit?: string): string {
  return resolveManifestUrl(explicit);
}

function manifestHasEntries(manifest: ArtManifestV1 | null): manifest is ArtManifestV1 {
  return Boolean(manifest && Object.keys(manifest.entries).length > 0);
}

function isPixelArtKey(key: string): key is PixelArtKey {
  return (PIXEL_ART_KEYS as readonly string[]).includes(key);
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const raw = (baseUrl ?? 'cards').trim() || 'cards';
  return raw.replace(/\/+$/, '');
}

/** 清单里 baseUrl 为相对路径时：APK 用本地 www/cards/，网页用 Supabase */
function resolveArtAssetBaseUrl(manifest: ArtManifestV1): string {
  const raw = normalizeBaseUrl(manifest.baseUrl);
  if (/^https?:\/\//i.test(raw)) return raw;
  if (isNativeShell()) return raw;
  if (isCloudArtConfigured()) return getCardArtPublicBaseUrl();
  return raw;
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
  await touchCachedAsset(cached.artKey);
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
    let pngBlob: Blob | null = null;

    try {
      const res = await fetch(pngUrl, { cache: 'default', mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error(`PNG ${res.status}`);
      pngBlob = await res.blob();
      await loadArtImageFromBlob(artKey, pngBlob);
    } catch (fetchErr) {
      if (isNativeShell()) {
        await loadArtImageFromUrl(artKey, pngUrl);
        const retry = await fetch(pngUrl, { cache: 'default', mode: 'cors', credentials: 'omit' });
        if (retry.ok) pngBlob = await retry.blob();
      } else {
        throw fetchErr;
      }
    }

    if (!pngBlob) {
      throw new Error('PNG 未加载');
    }

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
  options: { preferNetwork?: boolean; keys?: PixelArtKey[] } = {}
): Promise<void> {
  const baseUrl = resolveArtAssetBaseUrl(manifest);
  const allKeys = Object.keys(manifest.entries).filter(isPixelArtKey);
  const keys =
    options.keys && options.keys.length > 0
      ? options.keys.filter((k) => manifest.entries[k]?.png)
      : allKeys;
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

async function loadManifestForBootstrap(manifestUrl: string): Promise<{
  manifest: ArtManifestV1 | null;
  fromNetwork: boolean;
}> {
  const cachedRecord = await getCachedManifestRecord();
  let cached = cachedRecord?.manifest ?? null;
  if (cached && Object.keys(cached.entries).length === 0) {
    cached = null;
    await clearCachedManifest();
  }

  try {
    const res = await fetch(manifestUrl, { cache: 'no-store' });
    if (res.status === 404) {
      return { manifest: cached, fromNetwork: false };
    }
    if (!res.ok) {
      throw new Error(`卡图清单加载失败: ${res.status}`);
    }

    const remote = parseArtManifest(await res.json());
    if (!remote) throw new Error('卡图清单格式无效');

    if (Object.keys(remote.entries).length === 0) {
      console.warn('[art] 远程清单无卡图条目', manifestUrl);
      return { manifest: cached, fromNetwork: false };
    }

    if (cached && artManifestMatchesCached(remote, cached)) {
      return { manifest: cached, fromNetwork: false };
    }

    await saveCachedManifest(remote);
    return { manifest: remote, fromNetwork: true };
  } catch (err) {
    console.warn('[art] 远程清单不可用，尝试本地缓存', err);
    return { manifest: cached, fromNetwork: false };
  }
}

function scheduleIdleTask(task: () => void): void {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => task(), { timeout: 8000 });
  } else {
    window.setTimeout(task, 120);
  }
}

export async function bootstrapCardArt(options: ArtBootstrapOptions = {}): Promise<ArtManifestV1 | null> {
  const primaryUrl = resolveManifestUrl(options.manifestUrl);
  let { manifest, fromNetwork } = await loadManifestForBootstrap(primaryUrl);

  const cloudUrl = isCloudArtConfigured() ? getCardArtManifestUrl() : null;
  if (!manifestHasEntries(manifest) && cloudUrl && cloudUrl !== primaryUrl) {
    console.info('[art] 本地清单为空，尝试 Supabase 卡图清单');
    const retry = await loadManifestForBootstrap(cloudUrl);
    manifest = retry.manifest;
    fromNetwork = retry.fromNetwork;
  }

  if (!manifestHasEntries(manifest)) {
    console.warn('[art] 无可用卡图清单', { primaryUrl, cloudUrl });
    return null;
  }

  const allKeys = Object.keys(manifest.entries).filter(isPixelArtKey);
  const priority = (options.priorityArtKeys ?? []).filter((k) => allKeys.includes(k));
  const deferred = priority.length > 0 ? allKeys.filter((k) => !priority.includes(k)) : [];
  const blockingKeys = priority.length > 0 ? priority : allKeys;

  await applyArtManifest(manifest, options.onProgress, {
    preferNetwork: fromNetwork,
    keys: blockingKeys,
  });

  if (deferred.length > 0) {
    scheduleIdleTask(() => {
      void applyArtManifest(manifest, options.onProgress, {
        preferNetwork: fromNetwork,
        keys: deferred,
      });
    });
  }

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
