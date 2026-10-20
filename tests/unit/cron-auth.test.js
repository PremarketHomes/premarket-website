import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

function read(relPath) {
  return fs.readFileSync(new URL(relPath, import.meta.url), 'utf-8');
}

// Every CRON_SECRET-gated route used to inline
// `if (authHeader !== \`Bearer ${process.env.CRON_SECRET}\`)`, which
// fails OPEN if CRON_SECRET is ever unset (an attacker sending the
// literal header "Bearer undefined" would pass). middleware/auth.js
// already had a correct verifyCron() that fails closed — this test
// guards against any of these routes drifting back to the broken
// inline pattern, or a newly-added cron route copying it instead of
// reusing verifyCron.
const CRON_SECRET_ROUTES = [
  '../../src/app/api/cron/compute-contacts/route.js',
  '../../src/app/api/cron/sync-agentbox/route.js',
  '../../src/app/api/cron/market-report/route.js',
  '../../src/app/api/cron/compute-trends/route.js',
  '../../src/app/api/cron/invoice-dry-run/route.js',
  '../../src/app/api/cron/property-followup/route.js',
  '../../src/app/api/cron/compute-scores/route.js',
  '../../src/app/api/cron/cleanup-stale/route.js',
  '../../src/app/api/cron/reconcile-property-charges/route.js',
  '../../src/app/api/cron/sync-xero-invoices/route.js',
  '../../src/app/api/cron/compress-images/route.js',
  '../../src/app/api/images/backfill-compress/route.js',
  '../../src/app/api/newsletter/send/route.js',
];

describe.each(CRON_SECRET_ROUTES.map((path) => ({ path, name: path.split('/').slice(-2).join('/') })))(
  '$name uses the fail-closed verifyCron helper',
  ({ path }) => {
    const source = read(path);

    it('imports verifyCron from middleware/auth', () => {
      expect(source).toMatch(/import \{ verifyCron \} from ['"].*middleware\/auth['"]/);
    });

    it('never reverts to the broken inline CRON_SECRET comparison', () => {
      expect(source).not.toMatch(/authHeader !== `Bearer \$\{process\.env\.CRON_SECRET\}`/);
    });

    it('calls verifyCron(request) and checks .authenticated before proceeding', () => {
      expect(source).toContain('verifyCron(request)');
      expect(source).toMatch(/if \(!auth\.authenticated\)/);
    });
  }
);

describe('a spot-check of a non-invoicing cron route\'s actual runtime behaviour', () => {
  it('cleanup-stale GET fails closed with no CRON_SECRET configured', async () => {
    const original = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const { GET } = await import('../../src/app/api/cron/cleanup-stale/route.js');
      const req = new Request('http://localhost/x', { headers: { authorization: 'Bearer undefined' } });
      const res = await GET(req);
      expect(res.status).toBe(401);
    } finally {
      process.env.CRON_SECRET = original;
    }
  });
});
