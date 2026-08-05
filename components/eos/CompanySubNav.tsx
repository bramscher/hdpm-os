'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { label: 'Scorecard', href: '/company/scorecard' },
  { label: 'Issues & To-Dos', href: '/company/issues' },
  { label: 'Meetings', href: '/company/meetings' },
];

/** Company section tabs (doc 06 §8 — Scorecard, Issues & To-Dos; Meetings and Org follow). */
export default function CompanySubNav() {
  const pathname = usePathname();
  return (
    <div className="border-b border-gray-200 bg-white">
      <nav className="mx-auto flex max-w-6xl gap-6 px-4">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                '-mb-px border-b-2 py-3 text-sm font-medium transition-colors',
                active
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
