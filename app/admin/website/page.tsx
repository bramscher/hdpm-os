import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { requireRole } from '@/lib/require-role';
import { webAdminUrl } from '@/lib/hdpm-web-admin';
import { PageContainer, PageHeader } from '@/components/ui/page-header';

export const metadata = { title: 'Website · HDPM OS' };

// The website admin signs in with the same Microsoft account, so each link is one click.
const LINKS = [
  { label: 'Blog posts', path: '/admin/collections/posts', hint: 'Write, edit and schedule articles.' },
  { label: 'Pages', path: '/admin/collections/pages', hint: 'Site pages and legal pages.' },
  { label: 'Job postings', path: '/admin/collections/jobs', hint: 'Edit role descriptions and photos.' },
  { label: 'Market areas', path: '/admin/collections/market-areas', hint: 'City and neighborhood pages.' },
  { label: 'Team members', path: '/admin/collections/team-members', hint: 'About page staff profiles.' },
  { label: 'Testimonials', path: '/admin/collections/testimonials', hint: 'Owner and resident reviews.' },
  { label: 'Media library', path: '/admin/collections/media', hint: 'Images used across the site.' },
  { label: 'CRM', path: '/admin/crm', hint: 'Website leads, inbox and reporting.' },
  { label: 'Campaigns', path: '/admin/campaigns', hint: 'Landing pages and campaign tracking.' },
  { label: 'Automations', path: '/admin/automations', hint: 'Blog, SEO and listing agents.' },
];

export default async function WebsitePage() {
  const guard = await requireRole('admin');
  if (!guard.ok) redirect('/');
  const base = webAdminUrl();
  return (
    <PageContainer>
      <PageHeader
        title="Website"
        description={
          <>
            Shortcuts into the highdesertpm.com admin. Applications and job availability are managed right here in{' '}
            <Link className="underline" href="/admin/hiring">Hiring</Link>.
          </>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LINKS.map((link) => (
          <a
            key={link.path}
            href={`${base}${link.path}`}
            target="_blank"
            rel="noreferrer"
            className="group rounded-xl border border-sand-200 bg-white p-4 transition-colors hover:border-charcoal-300"
          >
            <p className="flex items-center justify-between font-medium text-charcoal-900">
              {link.label}
              <ExternalLink className="h-4 w-4 text-charcoal-300 group-hover:text-charcoal-600" />
            </p>
            <p className="mt-1 text-sm text-charcoal-500">{link.hint}</p>
          </a>
        ))}
      </div>
    </PageContainer>
  );
}
