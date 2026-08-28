/**
 * Referral document storage (Batch 2) — private W-9 PDFs.
 *
 * The `referral-docs` bucket is private; access is service-role only (referrers
 * never touch storage directly). Files live under `<partnerId>/…` so each
 * referrer's docs are namespaced.
 */

import { getSupabaseAdmin } from '@/lib/supabase';

const BUCKET = 'referral-docs';

/** Upload a W-9 PDF; returns the storage path. */
export async function uploadW9(
  partnerId: string,
  bytes: Buffer,
  contentType: string
): Promise<string> {
  const supabase = getSupabaseAdmin();
  const ext = contentType.includes('pdf') ? 'pdf' : 'bin';
  const path = `${partnerId}/w9-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`uploadW9: ${error.message}`);
  return path;
}

/** Short-lived signed URL for an admin to view a stored doc. */
export async function signedDocUrl(path: string, expiresInSec = 300): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSec);
  if (error) throw new Error(`signedDocUrl: ${error.message}`);
  return data.signedUrl;
}
