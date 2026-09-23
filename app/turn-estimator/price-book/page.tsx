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
      <a href="/maintenance/invoices?tab=estimates" className="mb-5 inline-block text-sm text-green-800 underline">← Estimates</a>
      <h1 className="text-display text-charcoal-900">Price Book</h1>
      <p className="mb-6 mt-1 text-sm text-charcoal-500">
        Choose labor rates, materials and services for estimates. Updating a price applies to future estimates; previously issued estimates keep their saved prices.
        {isAdmin ? '' : ' Sign in as an admin to make changes.'}
      </p>
      <PriceBookAdmin initialItems={items} isAdmin={isAdmin} />
    </div>
  );
}
