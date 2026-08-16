import type { PixelArtKey } from '../game/types';
import type { ArtManifestEntryV1, ArtManifestV1 } from './artManifest';

function entryRevision(manifest: ArtManifestV1, entry: ArtManifestEntryV1): string {
  return entry.updatedAt ?? manifest.updatedAt ?? '0';
}

/** 比对清单条目是否一致（用于 updatedAt 相同但需防漏检） */
export function artManifestEntriesEqual(a: ArtManifestV1, b: ArtManifestV1): boolean {
  const aKeys = Object.keys(a.entries).sort();
  const bKeys = Object.keys(b.entries).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    const ak = aKeys[i] as PixelArtKey;
    const ae = a.entries[ak];
    const be = b.entries[ak];
    if (!ae?.png || !be?.png) return ae?.png === be?.png;
    if (ae.png !== be.png) return false;
    if (entryRevision(a, ae) !== entryRevision(b, be)) return false;
  }
  return true;
}

export function artManifestRevision(manifest: ArtManifestV1): string {
  return manifest.updatedAt ?? '0';
}

/** 远程清单是否与本地缓存等价（无需重新拉取卡图） */
export function artManifestMatchesCached(remote: ArtManifestV1, cached: ArtManifestV1): boolean {
  const remoteRev = artManifestRevision(remote);
  const cachedRev = artManifestRevision(cached);
  if (remoteRev && cachedRev && remoteRev === cachedRev) {
    return artManifestEntriesEqual(cached, remote);
  }
  return artManifestEntriesEqual(cached, remote);
}
