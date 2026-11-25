import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../../', import.meta.url).pathname;

function sourceFiles(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return rel.startsWith(path.join('src', 'app', 'api')) ? [] : sourceFiles(rel);
    return /\.(js|jsx|mjs|ts|tsx)$/.test(e.name) ? [rel] : [];
  });
}

// Every browser-side reference to the `offers` collection (server routes use the
// Admin SDK and are not subject to the rules). firestore.rules only lets clients
// write the exact fields the writers below send (offerCreateKeys /
// offerUpdateKeys), and tests/rules/offers.test.js replays each writer's payload
// and each reader's query. A new browser-side read or write — or a new field in
// an existing writer — must be added to both, or it fails with permission-denied
// in production (for a writer: a lost buyer registration).
const REVIEWED_CLIENT_ACCESS = {
  // writers
  // Price opinions and registrations are SEPARATE records (utils/opinionRecords.js); the rules refuse any record that
  // would hold a price together with buyer details.
  'src/app/components/PropertyPageClient.js': 4, // opinion create/update, registration create/update (separate records)
  'src/app/tv/[id]/page.js': 2, // TV opinion create, sign-up registration create (separate record)
  'src/app/utils/kioskPersistence.js': 1, // iPad kiosk queue (setDoc merge; opinion and registration on separate ids)
  // readers
  'src/app/buyer-dashboard/hooks/useBuyerData.js': 1, // where userId == own uid (the buyer's own registrations)
  // (the agent dashboard and the Report page no longer read offers in the browser: the dashboard gets counts from
  // /api/offers/opinion-counts and every report viewer gets the server's separated report, opinionPrivacy.js, so raw
  // records, some of which are older records with a buyer's details next to their price, never reach an agent)
  'src/app/dashboard/crm/[id]/page.js': 2, // superAdmin CRM, by email / buyerEmail
  'src/app/dashboard/admin/components/tabs/PropertiesTab.js': 1, // superAdmin counts
};

describe('browser-side access to the offers collection', () => {
  it('matches the readers and writers the Firestore rules and rules tests were built for', () => {
    const ref = /(collection|doc)\(\s*db\s*,\s*['"`]offers['"`]/g;
    const found = {};
    for (const file of sourceFiles('src')) {
      const n = (fs.readFileSync(path.join(root, file), 'utf-8').match(ref) || []).length;
      if (n) found[file] = n;
    }
    expect(found).toEqual(REVIEWED_CLIENT_ACCESS);
  });
});
