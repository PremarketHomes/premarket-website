import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestEnv, getAuthedDb, getUnauthDb, getSuperAdminDb, cleanup, teardown, assertFails, doc, getDoc, setDoc } from './helpers.js';

beforeAll(async () => { await getTestEnv(); });
afterAll(async () => { await teardown(); });
beforeEach(async () => { await cleanup(); });

// HPHNOVEMBER redemptions and promo billing exclusions are server-only: no browser can read, create, change or delete
// them (the default-deny rule), so redemption status and billing exclusion can't be manipulated from the client.
describe('promotion records are server-only', () => {
  const id = 'HPHNOVEMBER_agent1';
  for (const [who, getDb] of [['signed-out', () => getUnauthDb()], ['the agent themself', () => getAuthedDb('agent1')], ['a superAdmin', () => getSuperAdminDb()]]) {
    it(`denies ${who} reading or writing promoRedemptions`, async () => {
      const db = await getDb();
      await assertFails(getDoc(doc(db, 'promoRedemptions', id)));
      await assertFails(setDoc(doc(db, 'promoRedemptions', id), { code: 'HPHNOVEMBER', agentUid: 'agent1', propertyId: 'p1' }));
    });
    it(`denies ${who} writing an excluded promo billing record`, async () => {
      const db = await getDb();
      await assertFails(setDoc(doc(db, 'propertyCharges', 'p1'), { status: 'excluded', promoCode: 'HPHNOVEMBER' }));
    });
  }
});
