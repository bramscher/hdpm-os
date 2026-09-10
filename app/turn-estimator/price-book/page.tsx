import { auth } from '@/lib/auth';
import { listPriceBookItems } from '@/lib/turn-estimator/price-book';
import PriceBookAdmin from '@/components/turn-estimator/PriceBookAdmin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'HDPM-OS — Price Book' };

/**
 * /turn-estimator/price-book — the price-book admin (Turn Estimator Slice 0).
 * Anyone at the company can view; only admins can create / reprice / retire
 * (enforced again in the API). Repricing is version-on-change: a new effective
 * row, never an overwrite, so issued estimates keep their original prices.
 */
export default async function PriceBookPage() {
  const session = await auth();
  const isAdmin = session?.user?.isAdmin === true;
  const items = await listPriceBookItems();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-display text-charcoal-900">Price Book</h1>
      <p className="mb-6 mt-1 text-sm text-charcoal-500">
        Effective-dated pricing for turn estimates. Repricing creates a new effective row — it never
        changes a price on an estimate that was already issued.
        {isAdmin ? '' : ' Sign in as an admin to make changes.'}
      </p>
      <PriceBookAdmin initialItems={items} isAdmin={isAdmin} />
    </div>
  );
}
