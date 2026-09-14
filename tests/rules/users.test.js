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

describe('users collection', () => {
  // --- read ---
  it('allows unauthenticated read', async () => {
    const ownerDb = getAuthedDb('user1');
    await setDoc(doc(ownerDb, 'users', 'user1'), { name: 'Alice' });
    const db = getUnauthDb();
    await assertSucceeds(getDoc(doc(db, 'users', 'user1')));
  });

  it('allows authenticated read of own doc', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { name: 'Alice' });
    await assertSucceeds(getDoc(doc(db, 'users', 'user1')));
  });

  it('allows authenticated read of another user', async () => {
    const ownerDb = getAuthedDb('user1');
    await setDoc(doc(ownerDb, 'users', 'user1'), { name: 'Alice' });
    const db = getAuthedDb('user2');
    await assertSucceeds(getDoc(doc(db, 'users', 'user1')));
  });

  // --- create ---
  it('allows create of own user doc', async () => {
    const db = getAuthedDb('user1');
    await assertSucceeds(setDoc(doc(db, 'users', 'user1'), { name: 'Alice' }));
  });

  it('denies create of another user doc', async () => {
    const db = getAuthedDb('user2');
    await assertFails(setDoc(doc(db, 'users', 'user1'), { name: 'Alice' }));
  });

  it('denies unauthenticated create', async () => {
    const db = getUnauthDb();
    await assertFails(setDoc(doc(db, 'users', 'user1'), { name: 'Alice' }));
  });

  // --- update ---
  it('allows update of own user doc', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { name: 'Alice' });
    await assertSucceeds(updateDoc(doc(db, 'users', 'user1'), { name: 'Bob' }));
  });

  it('denies update of another user doc', async () => {
    const ownerDb = getAuthedDb('user1');
    await setDoc(doc(ownerDb, 'users', 'user1'), { name: 'Alice' });
    const db = getAuthedDb('user2');
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { name: 'Hacker' }));
  });

  it('denies unauthenticated update', async () => {
    const ownerDb = getAuthedDb('user1');
    await setDoc(doc(ownerDb, 'users', 'user1'), { name: 'Alice' });
    const db = getUnauthDb();
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { name: 'Hacker' }));
  });

  // --- agencyBrandId (agency branding) ---
  // Only the server (Admin SDK, via /api/branding/confirm) may set this —
  // never the client, even the account owner — so an agent can't
  // self-assign another agency's brand (logo/colours) onto their own
  // public campaigns.
  it('denies the owner setting their own agencyBrandId directly', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { name: 'Alice' });
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { agencyBrandId: 'harcourts-property-hub' }));
  });

  it('denies changing agencyBrandId even alongside an otherwise-valid field', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { name: 'Alice' });
    await assertFails(updateDoc(doc(db, 'users', 'user1'), { name: 'Bob', agencyBrandId: 'someone-elses-brand' }));
  });

  it('still allows updating unrelated fields when agencyBrandId is untouched', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { name: 'Alice', agencyBrandId: 'existing-brand' });
    await assertSucceeds(updateDoc(doc(db, 'users', 'user1'), { name: 'Bob' }));
  });

  // --- delete ---
  it('denies delete even for own user doc', async () => {
    const db = getAuthedDb('user1');
    await setDoc(doc(db, 'users', 'user1'), { name: 'Alice' });
    await assertFails(deleteDoc(doc(db, 'users', 'user1')));
  });

  it('denies unauthenticated delete', async () => {
    const ownerDb = getAuthedDb('user1');
    await setDoc(doc(ownerDb, 'users', 'user1'), { name: 'Alice' });
    const db = getUnauthDb();
    await assertFails(deleteDoc(doc(db, 'users', 'user1')));
  });
});

describe('users/{userId}/adminNotes subcollection', () => {
  // --- read ---
  it('allows superAdmin to read admin notes', async () => {
    const db = await getSuperAdminDb();
    await setDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' });
    await assertSucceeds(getDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1')));
  });

  it('denies non-superAdmin read of admin notes', async () => {
    const adminDb = await getSuperAdminDb();
    await setDoc(doc(adminDb, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' });
    const db = getAuthedDb('user1');
    await assertFails(getDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1')));
  });

  it('denies unauthenticated read of admin notes', async () => {
    const adminDb = await getSuperAdminDb();
    await setDoc(doc(adminDb, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' });
    const db = getUnauthDb();
    await assertFails(getDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1')));
  });

  // --- create ---
  it('allows superAdmin to create admin notes', async () => {
    const db = await getSuperAdminDb();
    await assertSucceeds(setDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' }));
  });

  it('denies non-superAdmin create of admin notes', async () => {
    const db = getAuthedDb('user1');
    await assertFails(setDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' }));
  });

  it('denies unauthenticated create of admin notes', async () => {
    const db = getUnauthDb();
    await assertFails(setDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' }));
  });

  // --- update ---
  it('allows superAdmin to update admin notes', async () => {
    const db = await getSuperAdminDb();
    await setDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' });
    await assertSucceeds(updateDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1'), { text: 'updated' }));
  });

  it('denies non-superAdmin update of admin notes', async () => {
    const adminDb = await getSuperAdminDb();
    await setDoc(doc(adminDb, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' });
    const db = getAuthedDb('user1');
    await assertFails(updateDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1'), { text: 'hacked' }));
  });

  // --- delete ---
  it('allows superAdmin to delete admin notes', async () => {
    const db = await getSuperAdminDb();
    await setDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' });
    await assertSucceeds(deleteDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1')));
  });

  it('denies non-superAdmin delete of admin notes', async () => {
    const adminDb = await getSuperAdminDb();
    await setDoc(doc(adminDb, 'users', 'user1', 'adminNotes', 'note1'), { text: 'note' });
    const db = getAuthedDb('user1');
    await assertFails(deleteDoc(doc(db, 'users', 'user1', 'adminNotes', 'note1')));
  });
});

describe('users/{userId}/purchases subcollection', () => {
  it('allows owner to read own purchases', async () => {
    await seedDoc('users/user1/purchases/p1', { item: 'plan' });
    const db = getAuthedDb('user1');
    await assertSucceeds(getDoc(doc(db, 'users', 'user1', 'purchases', 'p1')));
  });

  it('denies other user from reading purchases', async () => {
    await seedDoc('users/user1/purchases/p1', { item: 'plan' });
    const db = getAuthedDb('user2');
    await assertFails(getDoc(doc(db, 'users', 'user1', 'purchases', 'p1')));
  });

  it('denies unauthenticated read of purchases', async () => {
    await seedDoc('users/user1/purchases/p1', { item: 'plan' });
    const db = getUnauthDb();
    await assertFails(getDoc(doc(db, 'users', 'user1', 'purchases', 'p1')));
  });

  it('denies write to purchases (even owner)', async () => {
    const db = getAuthedDb('user1');
    await assertFails(setDoc(doc(db, 'users', 'user1', 'purchases', 'p1'), { item: 'plan' }));
  });

  it('denies unauthenticated write to purchases', async () => {
    const db = getUnauthDb();
    await assertFails(setDoc(doc(db, 'users', 'user1', 'purchases', 'p1'), { item: 'plan' }));
  });
});
