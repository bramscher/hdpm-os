import { evolve } from '../../lib/brain/evolve';
evolve({ dryRun: process.argv.includes('--dry') }).then((r) => {
  console.log(JSON.stringify(r, null, 2));
});
