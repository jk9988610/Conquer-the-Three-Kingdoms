import {
  type ArtManifestV1,
  parseArtManifest,
} from './artManifest';
import { getCardArtManifestUrl } from './cloudConfig';

/** 从 Supabase 公共 URL 拉取卡图清单（无 @supabase 依赖，可打进主包） */
export async function fetchRemoteManifest(): Promise<ArtManifestV1 | null> {
  const url = getCardArtManifestUrl();
  const res = await fetch(url, { cache: 'default' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`清单加载失败: ${res.status}`);
  const manifest = parseArtManifest(await res.json());
  if (!manifest) throw new Error('清单格式无效');
  return manifest;
}
