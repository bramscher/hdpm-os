/**
 * One-off data fix (2026-08-04): the 20260719_staff_seed_contacts migration
 * seeded slack_user_id by person name, but four staff rows are null in live
 * (rows rebuilt during the 07-24 email backfill missed them). Restore the
 * migration's values, only where currently null.
 *
 * Run: npx tsx --env-file=.env.local scripts/restore-staff-slack-ids.ts
 */
import { getSupabaseAdmin } from '../lib/supabase';

const SEED: Record<string, string> = {
  'matt@highdesertpm.com': 'U0BCNSJ71UY',
  'bianca@highdesertpm.com': 'U0BBWDLJXFB',
  'penny@highdesertpm.com': 'U0BBD42CZTR',
  'alberto@highdesertpm.com': 'U0BBY7H7Q84',
};

async function main() {
  const supabase = getSupabaseAdmin();
  for (const [email, slackId] of Object.entries(SEED)) {
    const { data, error } = await supabase
      .from('staff')
      .update({ slack_user_id: slackId })
      .eq('email', email)
      .is('slack_user_id', null)
      .select('email, slack_user_id');
    if (error) console.error(email, 'FAILED:', error.message);
    else console.log(email, data?.length ? `→ ${data[0].slack_user_id}` : 'no change (already set or missing)');
  }
}

main();
