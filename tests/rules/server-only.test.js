import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  getTestEnv, getAuthedDb, getUnauthDb, getSuperAdminDb, seedDoc,
  cleanup, teardown,
  assertFails,
  doc, getDoc, setDoc, deleteDoc,
} from './helpers.js';

beforeAll(async () => { await getTestEnv(); });
afterAll(async () => { await teardown(); });
beforeEach(async () => { await cleanup(); });

const SERVER_ONLY_COLLECTIONS = [
  'marketScores',
  'marketTrends',
  'propertyScores',
  'propertyViews',
  'agentboxContacts',
  'rexContacts',
  'coreProperties',
  'invoiceRuns',
  'invoiceRunItems',
  'docLinks',
  'docSessions',
  'phiVerifications',
  'integrationCredentials',
];

describe.each(
  SERVER_ONLY_COLLECTIONS.map((col) => ({ name: col, col }))
)('$name (server-only, all access denied)', ({ col }) => {
  // --- read ---
  it('denies authenticated read', async () => {
    await seedDoc(`${col}/doc1`, { data: 'test' });
    const db = getAuthedDb('user1');
    await assertFails(getDoc(doc(db, col, 'doc1')));
  });

  it('denies unauthenticated read', async () => {
    await seedDoc(`${col}/doc1`, { data: 'test' });
    const db = getUnauthDb();
    await assertFails(getDoc(doc(db, col, 'doc1')));
  });

  it('denies superAdmin read', async () => {
    await seedDoc(`${col}/doc1`, { data: 'test' });
    const db = await getSuperAdminDb();
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

  it('denies superAdmin write', async () => {
    const db = await getSuperAdminDb();
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
