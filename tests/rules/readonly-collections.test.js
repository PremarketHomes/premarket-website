import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  getTestEnv, getAuthedDb, getUnauthDb, getSuperAdminDb, seedDoc,
  cleanup, teardown,
  assertSucceeds, assertFails,
  doc, getDoc, setDoc, deleteDoc,
} from './helpers.js';

beforeAll(async () => { await getTestEnv(); });
afterAll(async () => { await teardown(); });
beforeEach(async () => { await cleanup(); });

// Collections that allow ANY authenticated user to read, but deny all
// writes: xpNotifications, propertyStats. stripeTransactions looks
// similar but is NOT the same pattern — its read requires an owner/
// superAdmin match, not just isAuth() — grouping it in here against a
// payload with no userId field always failed the moment this suite
// could actually run against a real emulator; see its own dedicated
// block below, which tests the real (more restrictive) rule instead
// of loosening it to match a wrong assumption.
describe.each([
  { name: 'xpNotifications', col: 'xpNotifications' },
  { name: 'propertyStats', col: 'propertyStats' },
])('$name (auth read, no write)', ({ col }) => {
  // --- read ---
  it('allows authenticated read', async () => {
    await seedDoc(`${col}/doc1`, { data: 'test' });
    const db = getAuthedDb('user1');
    await assertSucceeds(getDoc(doc(db, col, 'doc1')));
  });

  it('denies unauthenticated read', async () => {
    await seedDoc(`${col}/doc1`, { data: 'test' });
    const db = getUnauthDb();
    await assertFails(getDoc(doc(db, col, 'doc1')));
  });

  // --- write ---
  it('denies authenticated write', async () => {
    const db = getAuthedDb('user1');
    await assertFails(setDoc(doc(db, col, 'doc1'), { data: 'test' }));
  });

  it('denies unauthenticated write', async () => {
    const db = getUnauthDb();
    await assertFails(setDoc(doc(db, col, 'doc1'), { data: 'test' }));
  });

  // --- delete ---
  it('denies authenticated delete', async () => {
    await seedDoc(`${col}/doc1`, { data: 'test' });
    const db = getAuthedDb('user1');
    await assertFails(deleteDoc(doc(db, col, 'doc1')));
  });

  it('denies unauthenticated delete', async () => {
    await seedDoc(`${col}/doc1`, { data: 'test' });
    const db = getUnauthDb();
    await assertFails(deleteDoc(doc(db, col, 'doc1')));
  });
});

describe('stripeTransactions (own + superAdmin read, no write)', () => {
  // --- read ---
  it('allows the owner to read their own transaction', async () => {
    await seedDoc('stripeTransactions/doc1', { userId: 'user1', data: 'test' });
    const db = getAuthedDb('user1');
    await assertSucceeds(getDoc(doc(db, 'stripeTransactions', 'doc1')));
  });

  it('allows superAdmin to read any transaction', async () => {
    await seedDoc('stripeTransactions/doc1', { userId: 'user1', data: 'test' });
    const db = await getSuperAdminDb();
    await assertSucceeds(getDoc(doc(db, 'stripeTransactions', 'doc1')));
  });

  it('denies a non-owner, non-superAdmin from reading someone else\'s transaction', async () => {
    await seedDoc('stripeTransactions/doc1', { userId: 'user1', data: 'test' });
    const db = getAuthedDb('user2');
    await assertFails(getDoc(doc(db, 'stripeTransactions', 'doc1')));
  });

  it('denies unauthenticated read', async () => {
    await seedDoc('stripeTransactions/doc1', { userId: 'user1', data: 'test' });
    const db = getUnauthDb();
    await assertFails(getDoc(doc(db, 'stripeTransactions', 'doc1')));
  });

  // --- write: always false, even for the owner or superAdmin ---
  it('denies authenticated write, even by the would-be owner', async () => {
    const db = getAuthedDb('user1');
    await assertFails(setDoc(doc(db, 'stripeTransactions', 'doc1'), { userId: 'user1', data: 'test' }));
  });

  it('denies unauthenticated write', async () => {
    const db = getUnauthDb();
    await assertFails(setDoc(doc(db, 'stripeTransactions', 'doc1'), { data: 'test' }));
  });

  it('denies superAdmin write too — this collection is server-managed only', async () => {
    const db = await getSuperAdminDb();
    await assertFails(setDoc(doc(db, 'stripeTransactions', 'doc1'), { data: 'test' }));
  });

  // --- delete ---
  it('denies authenticated delete', async () => {
    await seedDoc('stripeTransactions/doc1', { userId: 'user1', data: 'test' });
    const db = getAuthedDb('user1');
    await assertFails(deleteDoc(doc(db, 'stripeTransactions', 'doc1')));
  });

  it('denies unauthenticated delete', async () => {
    await seedDoc('stripeTransactions/doc1', { userId: 'user1', data: 'test' });
    const db = getUnauthDb();
    await assertFails(deleteDoc(doc(db, 'stripeTransactions', 'doc1')));
  });
});
