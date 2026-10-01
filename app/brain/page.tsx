import { PageContainer } from '@/components/ui/page-header';
import BrainMap from '@/components/brain/BrainMap';

export const metadata = {
  title: 'Brain map · HDPM OS',
};

/**
 * /brain — a 3D map of what Dez knows: policies and processes at the core,
 * SOPs, then Oregon law and company memory, with routines and integrations
 * on the outer rings. Built nightly by /api/brain/cron/snapshot.
 */
export default function BrainPage() {
  return (
    <PageContainer width="full" className="py-4">
      <h1 className="sr-only">Brain map</h1>
      <BrainMap />
    </PageContainer>
  );
}
