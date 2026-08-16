import type { PixelArtKey } from '../game/types';
import {
  ART_MANIFEST_VERSION,
  type ArtManifestEntryV1,
  type ArtManifestV1,
} from './artManifest';
import type { ArtCardMetaV1 } from './artMeta';
import { saveCachedAsset, saveCachedManifest } from './artCache';
import { getCardArtPublicBaseUrl } from './cloudConfig';
import { fetchRemoteManifest } from './artCloudManifest';

function formatStorageError(err: { message?: string } | null): string {
  const msg = err?.message ?? '未知错误';
  if (msg.includes('Bucket not found')) {
    return 'Storage 桶 card-art 不存在，请先在 Supabase 创建 Public 桶';
  }
  if (msg.includes('policy') || msg.includes('Permission') || msg.includes('403')) {
    return 'Storage 权限不足，请执行 supabase/schema-card-art-storage-policies.sql';
  }
  return msg;
}

function createEmptyManifest(): ArtManifestV1 {
  return {
    version: ART_MANIFEST_VERSION,
    updatedAt: new Date().toISOString(),
    baseUrl: getCardArtPublicBaseUrl(),
    entries: {},
  };
}

function metaToManifestEntry(meta: ArtCardMetaV1, updatedAt: string): ArtManifestEntryV1 {
  return {
    png: `${meta.artKey}.png`,
    meta: `${meta.artKey}.meta.json`,
    highlightB64: meta.highlightB64,
    highlightBreathSpeed: meta.highlightBreathSpeed,
    updatedAt,
  };
}

/** 将当前 artKey 的 PNG + meta 上传至 Supabase，并更新 manifest.json */
export async function uploadArtToCloud(
  artKey: PixelArtKey,
  pngBlob: Blob,
  meta: ArtCardMetaV1
): Promise<{ publicPngUrl: string }> {
  const { getCardArtBucket, getSupabaseClient } = await import('./supabaseClient');
  const sb = getSupabaseClient();
  const bucket = getCardArtBucket();
  const now = new Date().toISOString();
  const pngPath = `${artKey}.png`;
  const metaPath = `${artKey}.meta.json`;

  const { error: pngErr } = await sb.storage.from(bucket).upload(pngPath, pngBlob, {
    contentType: 'image/png',
    upsert: true,
  });
  if (pngErr) throw new Error(formatStorageError(pngErr));

  const metaBlob = new Blob([`${JSON.stringify(meta, null, 2)}\n`], {
    type: 'application/json',
  });
  const { error: metaErr } = await sb.storage.from(bucket).upload(metaPath, metaBlob, {
    contentType: 'application/json',
    upsert: true,
  });
  if (metaErr) throw new Error(formatStorageError(metaErr));

  let manifest: ArtManifestV1;
  try {
    manifest = (await fetchRemoteManifest()) ?? createEmptyManifest();
  } catch {
    manifest = createEmptyManifest();
  }

  manifest.updatedAt = now;
  manifest.baseUrl = getCardArtPublicBaseUrl();
  manifest.entries[artKey] = metaToManifestEntry(meta, now);

  const manifestBlob = new Blob([`${JSON.stringify(manifest, null, 2)}\n`], {
    type: 'application/json',
  });
  const { error: manifestErr } = await sb.storage.from(bucket).upload('manifest.json', manifestBlob, {
    contentType: 'application/json',
    upsert: true,
  });
  if (manifestErr) throw new Error(formatStorageError(manifestErr));

  await saveCachedManifest(manifest);
  await saveCachedAsset({
    artKey,
    updatedAt: now,
    pngBlob,
    highlightB64: meta.highlightB64,
    highlightBreathSpeed: meta.highlightBreathSpeed,
  });

  const { data } = sb.storage.from(bucket).getPublicUrl(pngPath);
  return { publicPngUrl: data.publicUrl };
}
