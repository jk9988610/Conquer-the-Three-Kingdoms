import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { CARD_ART_BUCKET, isCloudArtConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from './cloudConfig';

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!isCloudArtConfigured()) {
    throw new Error('Supabase 未配置');
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export function getCardArtBucket(): string {
  return CARD_ART_BUCKET;
}
