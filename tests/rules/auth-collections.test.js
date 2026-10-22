import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  getTestEnv, getAuthedDb, getUnauthDb, getSuperAdminDb, seedDoc,
  cleanup, teardown,
  assertSucceeds, assertFails,
  doc, getDoc, setDoc, updateDoc, deleteDoc,
} from './helpers.js';

beforeAll(async () => { await getTestEnv(); });
afterAll(async () => { await teardown(); });
beforeEach(async () => { await cleanup(); });

// propertyEngagement: any authenticated user, no ownership check at
// all. notifications looks similar at a glance but is NOT actually
// the same pattern — its read/update both require a userId match (or
// superAdmin for read) — grouping it in here against a payload with
// no userId field always failed the moment this suite could actually
// run against a real emulator; see its own dedicated block below,
// which tests the real (more restrictive) rule instead of loosening
// it to match a wrong assumption.
describe.each([
  { name: 'propertyEngagement', col: 'propertyEngagement' },
])('$name (auth read/create/update, no delete)', ({ col }) => {
  // --- read ---
  it('allows authenticated read', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, col, 'doc1'), { data: 'test' });
    await assertSucceeds(getDoc(doc(db, col, 'doc1')));
  });

  it('denies unauthenticated read', async () => {
    const authedDb = getAuthedDb('user1');
    await setDoc(doc(authedDb, col, 'doc1'), { data: 'test' });
    const db = getUnauthDb();
    await assertFails(getDoc(doc(db, col, 'doc1')));
  });

  // --- create ---
  it('allows authenticated create', async () => {
    const db = getAuthedDb('user1');
    await assertSucceeds(setDoc(doc(db, col, 'doc1'), { data: 'test' }));
  });

  it('denies unauthenticated create', async () => {
    const db = getUnauthDb();
    await assertFails(setDoc(doc(db, col, 'doc1'), { data: 'test' }));
  });

  // --- update ---
  it('allows authenticated update', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, col, 'doc1'), { data: 'test' });
    await assertSucceeds(updateDoc(doc(db, col, 'doc1'), { data: 'updated' }));
  });

  it('denies unauthenticated update', async () => {
    const authedDb = getAuthedDb('user1');
    await setDoc(doc(authedDb, col, 'doc1'), { data: 'test' });
    const db = getUnauthDb();
    await assertFails(updateDoc(doc(db, col, 'doc1'), { data: 'hacked' }));
  });

  // --- delete ---
  it('denies authenticated delete', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, col, 'doc1'), { data: 'test' });
    await assertFails(deleteDoc(doc(db, col, 'doc1')));
  });

  it('denies unauthenticated delete', async () => {
    const authedDb = getAuthedDb('user1');
    await setDoc(doc(authedDb, col, 'doc1'), { data: 'test' });
    const db = getUnauthDb();
    await assertFails(deleteDoc(doc(db, col, 'doc1')));
  });
});

// notifications: own notifications only (userId match) for read/update,
// OR superAdmin for read; create is any authenticated user (the server
// creates these for property events, via the Admin SDK, which bypasses
// this entirely — the client rule just needs to not be more permissive
// than that); delete is never allowed.
describe('notifications (own + superAdmin read, own update, no delete)', () => {
  // --- read ---
  it('allows the owner to read their own notification', async () => {
    await seedDoc('notifications/doc1', { userId: 'user1', data: 'test' });
    const db = getAuthedDb('user1');
    await assertSucceeds(getDoc(doc(db, 'notifications', 'doc1')));
  });

  it('allows superAdmin to read any notification', async () => {
    await seedDoc('notifications/doc1', { userId: 'user1', data: 'test' });
    const db = await getSuperAdminDb();
    await assertSucceeds(getDoc(doc(db, 'notifications', 'doc1')));
  });

  it('denies a non-owner, non-superAdmin from reading someone else\'s notification', async () => {
    await seedDoc('notifications/doc1', { userId: 'user1', data: 'test' });
    const db = getAuthedDb('user2');
    await assertFails(getDoc(doc(db, 'notifications', 'doc1')));
  });

  it('denies unauthenticated read', async () => {
    await seedDoc('notifications/doc1', { userId: 'user1', data: 'test' });
    const db = getUnauthDb();
    await assertFails(getDoc(doc(db, 'notifications', 'doc1')));
  });

  // --- create ---
  it('allows any authenticated user to create', async () => {
    const db = getAuthedDb('user1');
    await assertSucceeds(setDoc(doc(db, 'notifications', 'doc1'), { userId: 'user2', data: 'test' }));
  });

  it('denies unauthenticated create', async () => {
    const db = getUnauthDb();
    await assertFails(setDoc(doc(db, 'notifications', 'doc1'), { userId: 'user1', data: 'test' }));
  });

  // --- update ---
  it('allows the owner to update their own notification', async () => {
    await seedDoc('notifications/doc1', { userId: 'user1', data: 'test' });
    const db = getAuthedDb('user1');
    await assertSucceeds(updateDoc(doc(db, 'notifications', 'doc1'), { data: 'updated' }));
  });

  it('denies a non-owner from updating someone else\'s notification', async () => {
    await seedDoc('notifications/doc1', { userId: 'user1', data: 'test' });
    const db = getAuthedDb('user2');
    await assertFails(updateDoc(doc(db, 'notifications', 'doc1'), { data: 'hacked' }));
  });

  it('denies unauthenticated update', async () => {
    await seedDoc('notifications/doc1', { userId: 'user1', data: 'test' });
    const db = getUnauthDb();
    await assertFails(updateDoc(doc(db, 'notifications', 'doc1'), { data: 'hacked' }));
  });

  // --- delete ---
  it('denies delete even for the owner', async () => {
    await seedDoc('notifications/doc1', { userId: 'user1', data: 'test' });
    const db = getAuthedDb('user1');
    await assertFails(deleteDoc(doc(db, 'notifications', 'doc1')));
  });

  it('denies unauthenticated delete', async () => {
    await seedDoc('notifications/doc1', { userId: 'user1', data: 'test' });
    const db = getUnauthDb();
    await assertFails(deleteDoc(doc(db, 'notifications', 'doc1')));
  });
});

// inAppPurchases: owner read/create, no update/delete
describe('inAppPurchases (owner read/create, no update/delete)', () => {
  // --- read ---
  it('allows owner to read', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'inAppPurchases', 'p1'), { userId: 'user1', product: 'premium' });
    await assertSucceeds(getDoc(doc(db, 'inAppPurchases', 'p1')));
  });

  it('denies non-owner read', async () => {
    const ownerDb = getAuthedDb('user1');
    await setDoc(doc(ownerDb, 'inAppPurchases', 'p1'), { userId: 'user1', product: 'premium' });
    const db = getAuthedDb('user2');
    await assertFails(getDoc(doc(db, 'inAppPurchases', 'p1')));
  });

  it('denies unauthenticated read', async () => {
    const ownerDb = getAuthedDb('user1');
    await setDoc(doc(ownerDb, 'inAppPurchases', 'p1'), { userId: 'user1', product: 'premium' });
    const db = getUnauthDb();
    await assertFails(getDoc(doc(db, 'inAppPurchases', 'p1')));
  });

  // --- create ---
  it('allows owner to create', async () => {
    const db = getAuthedDb('user1');
    await assertSucceeds(setDoc(doc(db, 'inAppPurchases', 'p1'), { userId: 'user1', product: 'premium' }));
  });

  it('denies create with mismatched userId', async () => {
    const db = getAuthedDb('user1');
    await assertFails(setDoc(doc(db, 'inAppPurchases', 'p1'), { userId: 'user2', product: 'premium' }));
  });

  it('denies unauthenticated create', async () => {
    const db = getUnauthDb();
    await assertFails(setDoc(doc(db, 'inAppPurchases', 'p1'), { userId: 'user1', product: 'premium' }));
  });

  // --- update ---
  it('denies update (even owner)', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'inAppPurchases', 'p1'), { userId: 'user1', product: 'premium' });
    await assertFails(updateDoc(doc(db, 'inAppPurchases', 'p1'), { product: 'gold' }));
  });

  // --- delete ---
  it('denies delete (even owner)', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'inAppPurchases', 'p1'), { userId: 'user1', product: 'premium' });
    await assertFails(deleteDoc(doc(db, 'inAppPurchases', 'p1')));
  });
});

// priceOpinions: auth read/create, no update/delete
describe('priceOpinions (auth read/create, no update/delete)', () => {
  // --- read ---
  it('allows authenticated read', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'priceOpinions', 'op1'), { propertyId: 'prop1', value: 500000 });
    await assertSucceeds(getDoc(doc(db, 'priceOpinions', 'op1')));
  });

  it('denies unauthenticated read', async () => {
    const authedDb = getAuthedDb('user1');
    await setDoc(doc(authedDb, 'priceOpinions', 'op1'), { propertyId: 'prop1', value: 500000 });
    const db = getUnauthDb();
    await assertFails(getDoc(doc(db, 'priceOpinions', 'op1')));
  });

  // --- create ---
  it('allows authed create with propertyId string', async () => {
    const db = getAuthedDb('user1');
    await assertSucceeds(setDoc(doc(db, 'priceOpinions', 'op1'), { propertyId: 'prop1', value: 500000 }));
  });

  it('denies create without propertyId', async () => {
    const db = getAuthedDb('user1');
    await assertFails(setDoc(doc(db, 'priceOpinions', 'op1'), { value: 500000 }));
  });

  it('denies create with non-string propertyId', async () => {
    const db = getAuthedDb('user1');
    await assertFails(setDoc(doc(db, 'priceOpinions', 'op1'), { propertyId: 123, value: 500000 }));
  });

  it('denies unauthenticated create', async () => {
    const db = getUnauthDb();
    await assertFails(setDoc(doc(db, 'priceOpinions', 'op1'), { propertyId: 'prop1', value: 500000 }));
  });

  // --- update ---
  it('denies authenticated update', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'priceOpinions', 'op1'), { propertyId: 'prop1', value: 500000 });
    await assertFails(updateDoc(doc(db, 'priceOpinions', 'op1'), { value: 600000 }));
  });

  it('denies unauthenticated update', async () => {
    const authedDb = getAuthedDb('user1');
    await setDoc(doc(authedDb, 'priceOpinions', 'op1'), { propertyId: 'prop1', value: 500000 });
    const db = getUnauthDb();
    await assertFails(updateDoc(doc(db, 'priceOpinions', 'op1'), { value: 600000 }));
  });

  // --- delete ---
  it('denies authenticated delete', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'priceOpinions', 'op1'), { propertyId: 'prop1', value: 500000 });
    await assertFails(deleteDoc(doc(db, 'priceOpinions', 'op1')));
  });

  it('denies unauthenticated delete', async () => {
    const authedDb = getAuthedDb('user1');
    await setDoc(doc(authedDb, 'priceOpinions', 'op1'), { propertyId: 'prop1', value: 500000 });
    const db = getUnauthDb();
    await assertFails(deleteDoc(doc(db, 'priceOpinions', 'op1')));
  });
});
