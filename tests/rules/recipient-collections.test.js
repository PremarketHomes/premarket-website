import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  getTestEnv, getAuthedDb, getUnauthDb, getSuperAdminDb, seedDoc,
  cleanup, teardown,
  assertSucceeds, assertFails,
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs,
} from './helpers.js';

beforeAll(async () => { await getTestEnv(); });
afterAll(async () => { await teardown(); });
beforeEach(async () => { await cleanup(); });

// Phase 2 — recipients / recipientLinks / recipientEngagement are all
// server-only by design: every legitimate access path goes through an
// Admin-SDK-backed API route (see src/app/api/admin/recipient-links/*
// and the enhanced /api/property-visit), so there is no demonstrated
// need for ANY direct client access — not even for a superAdmin, unlike
// `offers` which genuinely needs scoped client reads. These tests prove
// that holds even for the most privileged client-side role. Since these
// collections deny client writes entirely, test data is seeded via
// seedDoc (bypasses rules), not via a client setDoc.
describe.each([
  { name: 'recipients', col: 'recipients', seed: { name: 'Luke Wilson', email: 'luke@example.com', agencyOwnerId: 'agent1' } },
  { name: 'recipientLinks', col: 'recipientLinks', seed: { recipientId: 'rec1', propertyId: 'prop1', agencyOwnerId: 'agent1', revoked: false } },
  { name: 'recipientEngagement', col: 'recipientEngagement', seed: { propertyId: 'prop1', recipientId: 'rec1', attributableOpens: 3 } },
])('$name collection (server-only)', ({ col, seed }) => {
  it('denies unauthenticated read', async () => {
    await seedDoc(`${col}/doc1`, seed);
    await assertFails(getDoc(doc(getUnauthDb(), col, 'doc1')));
  });

  it('denies unauthenticated write', async () => {
    const db = getUnauthDb();
    await assertFails(setDoc(doc(db, col, 'doc1'), seed));
  });

  it('denies an authenticated (non-admin) user from reading', async () => {
    await seedDoc(`${col}/doc1`, seed);
    const db = getAuthedDb('someUser');
    await assertFails(getDoc(doc(db, col, 'doc1')));
  });

  it('denies an authenticated (non-admin) user from writing', async () => {
    const db = getAuthedDb('someUser');
    await assertFails(setDoc(doc(db, col, 'doc1'), seed));
  });

  it('denies even a superAdmin from reading directly — access must go through the Admin SDK API routes', async () => {
    await seedDoc(`${col}/doc1`, seed);
    const db = await getSuperAdminDb();
    await assertFails(getDoc(doc(db, col, 'doc1')));
  });

  it('denies even a superAdmin from writing directly', async () => {
    const db = await getSuperAdminDb();
    await assertFails(setDoc(doc(db, col, 'doc1'), seed));
  });

  it('denies unauthenticated enumeration of the whole collection', async () => {
    await seedDoc(`${col}/doc1`, seed);
    await seedDoc(`${col}/doc2`, seed);
    await assertFails(getDocs(collection(getUnauthDb(), col)));
  });

  it('denies update and delete for anyone', async () => {
    await seedDoc(`${col}/doc1`, seed);
    const db = getAuthedDb('someUser');
    await assertFails(updateDoc(doc(db, col, 'doc1'), { changed: true }));
    await assertFails(deleteDoc(doc(db, col, 'doc1')));
  });
});
