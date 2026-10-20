import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, getDocs } from 'firebase/firestore';

const RULES_PATH = resolve(__dirname, '../../firestore.rules');
const PROJECT_ID = 'premarket-rules-test';

let testEnv;

export async function getTestEnv() {
  if (!testEnv) {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync(RULES_PATH, 'utf8'),
        host: '127.0.0.1',
        port: 8080,
      },
    });
  }
  return testEnv;
}

export function getAuthedDb(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

export function getUnauthDb() {
  return testEnv.unauthenticatedContext().firestore();
}

/**
 * Returns an authenticated Firestore client for a superAdmin user.
 *
 * Seeds the user doc with superAdmin: true with security rules
 * disabled — mirroring how superAdmin is actually ever granted in
 * production (PATCH /api/admin/users, via the Admin SDK, which
 * bypasses client rules entirely). This used to instead create the
 * doc through the normal client rules, relying on exactly the
 * privilege-escalation hole the users.test.js "SECURITY" cases now
 * prove is closed — superAdmin can no longer be set via a client
 * create/update at all, so this helper can't rely on that path either.
 */
export async function getSuperAdminDb(uid = 'superAdmin1') {
  await seedDoc(`users/${uid}`, { superAdmin: true });
  return testEnv.authenticatedContext(uid).firestore();
}

/**
 * Seed a document bypassing security rules (e.g. to set up existing data).
 * Use this only when you can't create through normal rules.
 */
export async function seedDoc(path, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    const segments = path.split('/');
    await setDoc(doc(adminDb, ...segments), data);
  });
}

export async function cleanup() {
  await testEnv.clearFirestore();
}

export async function teardown() {
  if (testEnv) {
    await testEnv.cleanup();
    testEnv = null;
  }
}

export { assertSucceeds, assertFails, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc, getDocs };
