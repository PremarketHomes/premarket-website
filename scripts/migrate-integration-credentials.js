#!/usr/bin/env node
/**
 * One-time migration for security audit Finding 3: copies any existing
 * Rex/Agentbox credentials off the publicly-readable `users/{uid}`
 * document and into the server-only `integrationCredentials/{uid}`
 * collection, then (only with --clean) removes the old copy.
 *
 * This is NOT required for correctness — src/app/api/services/rexService.js
 * and agentboxService.js already fall back to the legacy location at read
 * time, and any agent who connects/disconnects/syncs self-heals
 * automatically. This script exists to proactively close the exposure
 * for agents who might not touch their integration settings again soon.
 *
 * NOT executed as part of this change. Run manually by someone with a
 * real Firebase Admin service-account credential:
 *
 *   node scripts/migrate-integration-credentials.js                 # dry run, reports only
 *   node scripts/migrate-integration-credentials.js --apply          # copies to the new location
 *   node scripts/migrate-integration-credentials.js --apply --clean  # copies AND strips the old field
 *
 * `--clean` should only be run after separately verifying the copy
 * worked (re-run without --clean first, spot-check a few agents' data in
 * the Firebase Console under integrationCredentials/{uid}).
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_SERVICE_ACCOUNT)
 * to point at a real service-account key. Never commit that key.
 */

const admin = require('firebase-admin');

if (!admin.apps.length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
    });
  } else {
    // Falls back to GOOGLE_APPLICATION_CREDENTIALS if set.
    admin.initializeApp();
  }
}

const db = admin.firestore();

const APPLY = process.argv.includes('--apply');
const CLEAN = process.argv.includes('--clean');

async function main() {
  console.log(`Mode: ${APPLY ? (CLEAN ? 'APPLY + CLEAN' : 'APPLY (copy only)') : 'DRY RUN (no writes)'}`);
  console.log();

  const usersSnap = await db.collection('users').get();
  let candidates = 0;
  let migrated = 0;
  let alreadyMigrated = 0;
  let cleaned = 0;

  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    const integrations = data.integrations;
    if (!integrations || (!integrations.rex && !integrations.agentbox)) continue;

    candidates++;
    const uid = userDoc.id;
    const credDoc = await db.collection('integrationCredentials').doc(uid).get();
    const existing = credDoc.exists ? credDoc.data() : {};

    const toWrite = {};
    if (integrations.rex && !existing.rex) toWrite.rex = integrations.rex;
    if (integrations.agentbox && !existing.agentbox) toWrite.agentbox = integrations.agentbox;

    if (Object.keys(toWrite).length === 0) {
      alreadyMigrated++;
      console.log(`  [already migrated] ${uid}`);
    } else {
      console.log(`  [${APPLY ? 'migrating' : 'would migrate'}] ${uid}: ${Object.keys(toWrite).join(', ')}`);
      if (APPLY) {
        await db.collection('integrationCredentials').doc(uid).set(toWrite, { merge: true });
        migrated++;
      }
    }

    if (CLEAN && APPLY) {
      // Only strip the legacy field once we've confirmed (this run) that
      // the secure copy exists — either just written above, or already there.
      const finalCredDoc = await db.collection('integrationCredentials').doc(uid).get();
      const finalData = finalCredDoc.data() || {};
      const clearPatch = {};
      if (integrations.rex && finalData.rex) clearPatch['integrations.rex'] = admin.firestore.FieldValue.delete();
      if (integrations.agentbox && finalData.agentbox) clearPatch['integrations.agentbox'] = admin.firestore.FieldValue.delete();
      if (Object.keys(clearPatch).length > 0) {
        await db.collection('users').doc(uid).update(clearPatch);
        cleaned++;
        console.log(`  [cleaned legacy field] ${uid}`);
      }
    }
  }

  console.log();
  console.log(`Users with integration data found: ${candidates}`);
  console.log(`Already migrated (untouched):       ${alreadyMigrated}`);
  console.log(`${APPLY ? 'Migrated this run:' : 'Would migrate:'}                 ${migrated}`);
  if (CLEAN) console.log(`Legacy fields cleaned:               ${cleaned}`);
  if (!APPLY) console.log('\nThis was a dry run — no data was written. Re-run with --apply to migrate.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
