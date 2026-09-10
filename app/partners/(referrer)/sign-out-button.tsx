'use client';

import BrandButton from '@/components/referrals/BrandButton';
import { createReferrerBrowserClient } from '@/lib/referrals/supabase-referrer-browser';

export default function SignOutButton() {
  async function signOut() {
    await createReferrerBrowserClient().auth.signOut();
    window.location.href = '/partners/login';
  }
  return (
    <BrandButton variant="ghost" size="sm" onClick={signOut}>
      Sign out
    </BrandButton>
  );
}
