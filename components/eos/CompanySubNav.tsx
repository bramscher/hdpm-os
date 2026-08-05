'use client';

import { TabNav } from '@/components/ui/tabs';

const TABS = [
  { label: 'Scorecard', href: '/company/scorecard' },
  { label: 'Issues & To-Dos', href: '/company/issues' },
  { label: 'Meetings', href: '/company/meetings' },
  { label: 'Rocks', href: '/company/rocks' },
  { label: 'Org', href: '/company/org' },
];

/** Company section tabs (doc 06 §8) — the app-standard TabNav underline pattern. */
export default function CompanySubNav() {
  return <TabNav tabs={TABS} />;
}
