// One-shot CLI for the AppFolio HDMS bill sync (same code path as the
// "Sync AppFolio bills" button): npx tsx scripts/sync-af-bills.ts
import { config } from 'dotenv';
config({ path: '.env.local' });

async function main() {
  const { syncAfBills, getAfBills } = await import('@/lib/af-bills');

  const result = await syncAfBills();
  console.log('Sync result:', result);

  const { summary } = await getAfBills();
  console.log('Snapshot summary:', summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
