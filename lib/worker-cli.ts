// lib/worker-cli.ts
// Run with: npm run worker   (or: npx tsx lib/worker-cli.ts)
// Useful for cron jobs if you prefer scheduling outside the Next.js app.
import { runAll } from './worker';

runAll()
  .then(() => { console.log('worker: done'); process.exit(0); })
  .catch((e) => { console.error('worker: failed', e); process.exit(1); });
