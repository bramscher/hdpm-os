import { PageContainer } from '@/components/ui/page-header';
import AnatomyMap from '@/components/brain/anatomy/AnatomyMap';

export const metadata = {
  title: 'Brain map · HDPM OS',
};

/**
 * /brain — the brain map laid out as a brain: one lobe per layer, the left
 * half for what HDPM taught it and the right for what Dez has learned.
 * Built nightly by /api/brain/cron/snapshot; the original galaxy view is
 * at /brain-2.
 */
export default function BrainPage() {
  return (
    <PageContainer width="full" className="py-4">
      <h1 className="sr-only">Brain map</h1>
      <AnatomyMap />
    </PageContainer>
  );
}
