import type { ReactNode } from 'react';

export const metadata = { title: 'HDPM — Referral Partners' };

/**
 * Referrer portal chrome (Batch 2). Deliberately minimal and separate from the
 * staff AppShell (which AppShell.tsx skips for /partners non-admin routes).
 */
export default function ReferrerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-sand-50">
      <header className="border-b border-sand-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div>
            <div className="text-sm font-semibold text-charcoal-900">High Desert Property Management</div>
            <div className="text-xs text-charcoal-400">Referral Partner Portal</div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}
