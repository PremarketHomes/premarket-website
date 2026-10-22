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

// campaigns and settings: public read, all writes denied (even superAdmin)
describe.each([
  { name: 'campaigns', col: 'campaigns' },
  { name: 'settings', col: 'settings' },
  { name: 'agencyBrands', col: 'agencyBrands' },
  { name: 'offices', col: 'offices' },
])('$name (public read, no write)', ({ col }) => {
  // --- read ---
  it('allows unauthenticated read', async () => {
    await seedDoc(`${col}/doc1`, { data: 'test' });
    const db = getUnauthDb();
    await assertSucceeds(getDoc(doc(db, col, 'doc1')));
  });

  it('allows authenticated read', async () => {
    await seedDoc(`${col}/doc1`, { data: 'test' });
    const db = getAuthedDb('user1');
    await assertSucceeds(getDoc(doc(db, col, 'doc1')));
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

  it('denies superAdmin write', async () => {
    const db = await getSuperAdminDb();
    await assertFails(setDoc(doc(db, col, 'doc1'), { data: 'test' }));
  });
});

// settings/xeroTokens and settings/invoicing are denylisted out of the
// otherwise-public settings collection above — they hold live Xero OAuth
// tokens and internal billing config respectively, neither of which has
// any legitimate client-read use. Every other settings doc (exercised
// above as 'doc1') must keep working exactly as before.
describe.each([
  { name: 'xeroTokens', id: 'xeroTokens' },
  { name: 'invoicing', id: 'invoicing' },
])('settings/$name (denylisted — no public read, despite settings being public-read generally)', ({ id }) => {
  it('denies unauthenticated read', async () => {
    await seedDoc(`settings/${id}`, { secret: 'test' });
    const db = getUnauthDb();
    await assertFails(getDoc(doc(db, 'settings', id)));
  });

  it('denies authenticated read', async () => {
    await seedDoc(`settings/${id}`, { secret: 'test' });
    const db = getAuthedDb('user1');
    await assertFails(getDoc(doc(db, 'settings', id)));
  });

  it('denies superAdmin read via the client SDK (server code uses the Admin SDK, which bypasses rules entirely)', async () => {
    await seedDoc(`settings/${id}`, { secret: 'test' });
    const db = await getSuperAdminDb();
    await assertFails(getDoc(doc(db, 'settings', id)));
  });

  it('still denies write at every auth level, same as before', async () => {
    await assertFails(setDoc(doc(getUnauthDb(), 'settings', id), { data: 'x' }));
    await assertFails(setDoc(doc(getAuthedDb('user1'), 'settings', id), { data: 'x' }));
    await assertFails(setDoc(doc(await getSuperAdminDb(), 'settings', id), { data: 'x' }));
  });
});

// displays: public read, superAdmin write
describe('displays (public read, superAdmin write)', () => {
  // --- read ---
  it('allows unauthenticated read', async () => {
    const adminDb = await getSuperAdminDb();
    await setDoc(doc(adminDb, 'displays', 'd1'), { name: 'Lobby TV' });
    const db = getUnauthDb();
    await assertSucceeds(getDoc(doc(db, 'displays', 'd1')));
  });

  it('allows authenticated read', async () => {
    const adminDb = await getSuperAdminDb();
    await setDoc(doc(adminDb, 'displays', 'd1'), { name: 'Lobby TV' });
    const db = getAuthedDb('user1');
    await assertSucceeds(getDoc(doc(db, 'displays', 'd1')));
  });

  // --- create ---
  it('allows superAdmin to create', async () => {
    const db = await getSuperAdminDb();
    await assertSucceeds(setDoc(doc(db, 'displays', 'd1'), { name: 'Lobby TV' }));
  });

  it('denies non-superAdmin create', async () => {
    const db = getAuthedDb('user1');
    await assertFails(setDoc(doc(db, 'displays', 'd1'), { name: 'Hacked' }));
  });

  it('denies unauthenticated create', async () => {
    const db = getUnauthDb();
    await assertFails(setDoc(doc(db, 'displays', 'd1'), { name: 'Hacked' }));
  });

  // --- update ---
  it('allows superAdmin to update', async () => {
    const db = await getSuperAdminDb();
    await setDoc(doc(db, 'displays', 'd1'), { name: 'Lobby TV' });
    await assertSucceeds(updateDoc(doc(db, 'displays', 'd1'), { name: 'Updated' }));
  });

  it('denies non-superAdmin update', async () => {
    const adminDb = await getSuperAdminDb();
    await setDoc(doc(adminDb, 'displays', 'd1'), { name: 'Lobby TV' });
    const db = getAuthedDb('user1');
    await assertFails(updateDoc(doc(db, 'displays', 'd1'), { name: 'Hacked' }));
  });

  // --- delete ---
  it('allows superAdmin to delete', async () => {
    const db = await getSuperAdminDb();
    await setDoc(doc(db, 'displays', 'd1'), { name: 'Lobby TV' });
    await assertSucceeds(deleteDoc(doc(db, 'displays', 'd1')));
  });

  it('denies non-superAdmin delete', async () => {
    const adminDb = await getSuperAdminDb();
    await setDoc(doc(adminDb, 'displays', 'd1'), { name: 'Lobby TV' });
    const db = getAuthedDb('user1');
    await assertFails(deleteDoc(doc(db, 'displays', 'd1')));
  });
});
