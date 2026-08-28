'use client';

import { Button } from '@/components/ui/button';
import { createReferrerBrowserClient } from '@/lib/referrals/supabase-referrer';

export default function SignOutButton() {
  async function signOut() {
    await createReferrerBrowserClient().auth.signOut();
    window.location.href = '/partners/login';
  }
  return (
    <Button variant="ghost" size="sm" onClick={signOut}>
      Sign out
    </Button>
  );
}
