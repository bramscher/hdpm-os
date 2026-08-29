import type { ReactNode } from 'react';
import Image from 'next/image';
import { Plus_Jakarta_Sans, Inter } from 'next/font/google';

// hdpm-web brand fonts, scoped to the referrer portal via CSS variables.
const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['700', '800'], variable: '--font-brand-heading', display: 'swap' });
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-brand-body', display: 'swap' });

export const metadata = { title: 'HDPM — Referral Partners' };

/**
 * Referrer portal chrome — styled to match highdesertpm.com (hdpm-web): dark
 * header, green accent, Plus Jakarta Sans / Inter. Separate from the staff
 * AppShell (which AppShell.tsx skips for /partners non-admin routes).
 */
export default function ReferrerLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${jakarta.variable} ${inter.variable} min-h-screen bg-neutral-50 font-brand-body text-brand-ink`}>
      <header className="sticky top-0 z-50 border-b border-white/10 bg-brand-ink text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-3">
            <Image
              src="/partners/hdpm-logo-white.png"
              alt="High Desert Property Management"
              width={200}
              height={48}
              className="h-9 w-auto object-contain"
              priority
            />
          </div>
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-white/60">Referral Partners</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">{children}</main>
      <footer className="mx-auto max-w-3xl px-4 pb-10 pt-6 text-xs text-neutral-400">
        High Desert Property Management — Referral Partner Program
      </footer>
    </div>
  );
}
