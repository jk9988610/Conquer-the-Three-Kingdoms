import type { PixelArtKey } from '../game/types';
import type { ArtManifestV1 } from './artManifest';

const DB_NAME = 'tcg-art-cache-v1';
const DB_VERSION = 1;
const STORE_MANIFEST = 'manifest';
const STORE_ASSETS = 'assets';

export interface CachedArtAsset {
  artKey: PixelArtKey;
  updatedAt: string;
  pngBlob: Blob;
  highlightB64?: string;
  highlightBreathSpeed?: number;
}

interface CachedManifestRecord {
  manifest: ArtManifestV1;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('无法打开 IndexedDB'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MANIFEST)) {
        db.createObjectStore(STORE_MANIFEST);
      }
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS, { keyPath: 'artKey' });
      }
    };
  });
}

function idbGet<T>(storeName: string, key: IDBValidKey): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).get(key);
        req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 读取失败'));
      })
  );
}

function idbPut(storeName: string, value: unknown, key?: IDBValidKey): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = key === undefined ? store.put(value) : store.put(value, key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 写入失败'));
      })
  );
}

export async function getCachedManifest(): Promise<ArtManifestV1 | null> {
  const row = await idbGet<CachedManifestRecord>(STORE_MANIFEST, 'current');
  return row?.manifest ?? null;
}

export async function saveCachedManifest(manifest: ArtManifestV1): Promise<void> {
  const record: CachedManifestRecord = { manifest, savedAt: Date.now() };
  await idbPut(STORE_MANIFEST, record, 'current');
}

export async function getCachedAsset(artKey: PixelArtKey): Promise<CachedArtAsset | null> {
  return idbGet<CachedArtAsset>(STORE_ASSETS, artKey);
}

export async function saveCachedAsset(asset: CachedArtAsset): Promise<void> {
  await idbPut(STORE_ASSETS, asset);
}

export async function clearCachedAsset(artKey: PixelArtKey): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_ASSETS, 'readwrite');
        const req = tx.objectStore(STORE_ASSETS).delete(artKey);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 删除失败'));
      })
  );
}
