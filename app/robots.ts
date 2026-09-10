import type { MetadataRoute } from 'next';

/**
 * Keep the referral portal out of search engines while it's in pilot/testing
 * (Craig, 2026-08-29). The rest of the app is internal/auth-gated already; this
 * explicitly disallows the public referrer carve-out under /partners.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/partners',
    },
  };
}
