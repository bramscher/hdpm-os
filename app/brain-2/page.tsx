import { PageContainer } from '@/components/ui/page-header';
import BrainMap from '@/components/brain/BrainMap';

export const metadata = {
  title: 'Brain 2 · HDPM OS',
};

/**
 * /brain-2 — the original galaxy view of the brain map: policies and
 * processes at the core, SOPs, then Oregon law and company memory, with
 * routines and integrations on the outer rings. Kept as a fallback now that
 * /brain shows the anatomical layout. Same nightly snapshot.
 */
export default function Brain2Page() {
  return (
    <PageContainer width="full" className="py-4">
      <h1 className="sr-only">Brain 2</h1>
      <BrainMap />
    </PageContainer>
  );
}
