/** 与 Card-World `js/cloud-config.js` 共用同一 Supabase 项目 */
export const SUPABASE_URL = 'https://yjqkotqmglxjhlrhynsu.supabase.co';

export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqcWtvdHFtZ2x4amhscmh5bnN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxOTMzNDQsImV4cCI6MjA5NTc2OTM0NH0.Cm4WjiR4NXS4RrA15frLVMZPbGUyGyjaIYQXSRua8Ew';

export const CARD_ART_BUCKET = 'card-art';

/** Card World 用户美术商店（与 card-art 正式库分离） */
export const ART_SHOP_BUCKET = 'art';
export const ART_STORE_PREFIX = 'art-store';

export function getCardArtPublicBaseUrl(): string {
  return `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/${CARD_ART_BUCKET}`;
}

export function getCardArtManifestUrl(): string {
  return `${getCardArtPublicBaseUrl()}/manifest.json`;
}

export function isCloudArtConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
