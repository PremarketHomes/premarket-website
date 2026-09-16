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

describe('offers collection', () => {
  // --- read: PII lockdown (see docs/security-finding-offers-public-read-pii.md) ---
  it('denies unauthenticated read (buyer PII: buyerName/buyerEmail/buyerPhone live on this doc)', async () => {
    const db = getUnauthDb();
    await setDoc(doc(db, 'offers', 'offer1'), {
      propertyId: 'prop1', amount: 500000, buyerName: 'Luke Wilson', buyerEmail: 'luke@example.com',
    });
    await assertFails(getDoc(doc(db, 'offers', 'offer1')));
  });

  it('denies an unrelated authenticated user from reading someone else\'s offer', async () => {
    const unauthDb = getUnauthDb();
    await setDoc(doc(unauthDb, 'offers', 'offer1'), { propertyId: 'prop1', amount: 500000, userId: 'user1' });
    const db = getAuthedDb('user2');
    await assertFails(getDoc(doc(db, 'offers', 'offer1')));
  });

  it('allows a buyer to read their own offer (userId match)', async () => {
    const unauthDb = getUnauthDb();
    await setDoc(doc(unauthDb, 'offers', 'offer1'), { propertyId: 'prop1', amount: 500000, userId: 'user1' });
    const db = getAuthedDb('user1');
    await assertSucceeds(getDoc(doc(db, 'offers', 'offer1')));
  });

  it('allows the agent who owns the referenced property to read an offer on it', async () => {
    await seedDoc('properties/prop1', { userId: 'agent1' });
    const unauthDb = getUnauthDb();
    await setDoc(doc(unauthDb, 'offers', 'offer1'), { propertyId: 'prop1', amount: 500000 });
    const db = getAuthedDb('agent1');
    await assertSucceeds(getDoc(doc(db, 'offers', 'offer1')));
  });

  it('denies an agent who owns a different property from reading this offer', async () => {
    await seedDoc('properties/prop1', { userId: 'agent1' });
    const unauthDb = getUnauthDb();
    await setDoc(doc(unauthDb, 'offers', 'offer1'), { propertyId: 'prop1', amount: 500000 });
    const db = getAuthedDb('agent2');
    await assertFails(getDoc(doc(db, 'offers', 'offer1')));
  });

  it('allows a superAdmin to read any offer, regardless of property ownership', async () => {
    await seedDoc('properties/prop1', { userId: 'agent1' });
    const unauthDb = getUnauthDb();
    await setDoc(doc(unauthDb, 'offers', 'offer1'), { propertyId: 'prop1', amount: 500000 });
    const db = await getSuperAdminDb();
    await assertSucceeds(getDoc(doc(db, 'offers', 'offer1')));
  });

  it('denies read when the referenced property has been deleted (no property doc to check ownership against)', async () => {
    const unauthDb = getUnauthDb();
    await setDoc(doc(unauthDb, 'offers', 'offer1'), { propertyId: 'does-not-exist', amount: 500000 });
    const db = getAuthedDb('agent1');
    await assertFails(getDoc(doc(db, 'offers', 'offer1')));
  });

  it('denies an unauthenticated visitor from listing/enumerating the whole offers collection', async () => {
    await seedDoc('properties/prop1', { userId: 'agent1' });
    const unauthDb = getUnauthDb();
    await setDoc(doc(unauthDb, 'offers', 'offer1'), { propertyId: 'prop1', amount: 500000, buyerEmail: 'a@example.com' });
    await setDoc(doc(unauthDb, 'offers', 'offer2'), { propertyId: 'prop1', amount: 600000, buyerEmail: 'b@example.com' });
    await assertFails(getDocs(collection(getUnauthDb(), 'offers')));
  });

  // --- create ---
  it('allows anonymous create with propertyId string', async () => {
    const db = getUnauthDb();
    await assertSucceeds(setDoc(doc(db, 'offers', 'offer1'), { propertyId: 'prop1', amount: 500000 }));
  });

  it('allows authenticated create with propertyId string', async () => {
    const db = getAuthedDb('user1');
    await assertSucceeds(setDoc(doc(db, 'offers', 'offer1'), { propertyId: 'prop1', amount: 500000 }));
  });

  it('denies create without propertyId', async () => {
    const db = getUnauthDb();
    await assertFails(setDoc(doc(db, 'offers', 'offer1'), { amount: 500000 }));
  });

  it('denies create with non-string propertyId', async () => {
    const db = getUnauthDb();
    await assertFails(setDoc(doc(db, 'offers', 'offer1'), { propertyId: 123, amount: 500000 }));
  });

  // --- update ---
  it('allows update when propertyId stays the same (no userId)', async () => {
    const db = getUnauthDb();
    await setDoc(doc(db, 'offers', 'offer1'), { propertyId: 'prop1', amount: 500000 });
    await assertSucceeds(updateDoc(doc(db, 'offers', 'offer1'), { propertyId: 'prop1', amount: 600000 }));
  });

  it('denies update that changes propertyId', async () => {
    const db = getUnauthDb();
    await setDoc(doc(db, 'offers', 'offer1'), { propertyId: 'prop1', amount: 500000 });
    await assertFails(updateDoc(doc(db, 'offers', 'offer1'), { propertyId: 'prop2', amount: 600000 }));
  });

  it('allows authed update setting userId to own uid', async () => {
    const unauthDb = getUnauthDb();
    await setDoc(doc(unauthDb, 'offers', 'offer1'), { propertyId: 'prop1', amount: 500000 });
    const db = getAuthedDb('user1');
    await assertSucceeds(updateDoc(doc(db, 'offers', 'offer1'), { propertyId: 'prop1', userId: 'user1' }));
  });

  it('denies authed update setting userId to different uid', async () => {
    const unauthDb = getUnauthDb();
    await setDoc(doc(unauthDb, 'offers', 'offer1'), { propertyId: 'prop1', amount: 500000 });
    const db = getAuthedDb('user1');
    await assertFails(updateDoc(doc(db, 'offers', 'offer1'), { propertyId: 'prop1', userId: 'user2' }));
  });

  it('denies unauthenticated update that sets userId', async () => {
    const db = getUnauthDb();
    await setDoc(doc(db, 'offers', 'offer1'), { propertyId: 'prop1', amount: 500000 });
    await assertFails(updateDoc(doc(db, 'offers', 'offer1'), { propertyId: 'prop1', userId: 'user1' }));
  });

  // --- delete ---
  it('denies authenticated delete', async () => {
    const unauthDb = getUnauthDb();
    await setDoc(doc(unauthDb, 'offers', 'offer1'), { propertyId: 'prop1', amount: 500000 });
    const db = getAuthedDb('user1');
    await assertFails(deleteDoc(doc(db, 'offers', 'offer1')));
  });

  it('denies unauthenticated delete', async () => {
    const db = getUnauthDb();
    await setDoc(doc(db, 'offers', 'offer1'), { propertyId: 'prop1', amount: 500000 });
    await assertFails(deleteDoc(doc(db, 'offers', 'offer1')));
  });
});
