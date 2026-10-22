#!/usr/bin/env node
/**
 * One-time cleanup for the retired SMS Shortcuts feature: strips the
 * personal mobile numbers (and related SMS bookkeeping fields) that were
 * stored directly on the publicly-readable `users/{uid}` and
 * `agents/{agentId}` documents.
 *
 * This is a SECURITY fix, not a data migration — SMS Shortcuts has been
 * removed entirely and nobody was using it, so there is nowhere to move
 * this data TO. The fields are simply no longer needed and, while they
 * remain, stay publicly readable via the Firebase client SDK (Firestore
 * rules cannot restrict individual fields on an otherwise-public
 * document — see firestore.rules' comments on the `users`/`agents`
 * matches). Clearing them is what actually closes the exposure; removing
 * the application code alone does not, since it doesn't touch data
 * already written.
 *
 * NOT executed as part of this change. Run manually by someone with a
 * real Firebase Admin service-account credential, AFTER this branch's
 * code changes are approved and deployed (so the fields can never be
 * re-written in the meantime):
 *
 *   node scripts/cleanup-sms-fields.js            # dry run, reports only
 *   node scripts/cleanup-sms-fields.js --apply    # actually clears the fields
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS (or FIREBASE_SERVICE_ACCOUNT)
 * to point at a real service-account key. Never commit that key.
 *
 * Deliberately does NOT touch `smsMessages` or `smsConversations` —
 * those collections were never publicly readable (default-deny in
 * firestore.rules), so they're leftover operational data, not a
 * security exposure. Safe to delete separately if desired; not required
 * to close the PII leak this script addresses.
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
const { FieldValue } = admin.firestore;

const APPLY = process.argv.includes('--apply');

// Every field the (now-removed) SMS feature ever wrote onto `users`.
const USER_SMS_FIELDS = ['smsPhone', 'smsEnabled', 'smsWindowStart', 'smsRequestCount', 'smsLastRequestAt'];
// Every field it ever wrote onto `agents` (team member sub-profiles).
const AGENT_SMS_FIELDS = ['smsPhone', 'smsEnabled'];

async function cleanCollection(collectionName, fields) {
  const snap = await db.collection(collectionName).get();
  let candidates = 0;
  let cleaned = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const present = fields.filter((f) => f in data);
    if (present.length === 0) continue;

    candidates++;
    console.log(`  [${collectionName}] ${APPLY ? 'clearing' : 'would clear'} ${doc.id}: ${present.join(', ')}`);

    if (APPLY) {
      const patch = {};
      for (const f of present) patch[f] = FieldValue.delete();
      await doc.ref.update(patch);
      cleaned++;
    }
  }

  return { candidates, cleaned };
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (writes will happen)' : 'DRY RUN (no writes)'}`);
  console.log();

  const usersResult = await cleanCollection('users', USER_SMS_FIELDS);
  const agentsResult = await cleanCollection('agents', AGENT_SMS_FIELDS);

  console.log();
  console.log(`users docs with SMS fields found:  ${usersResult.candidates}`);
  console.log(`agents docs with SMS fields found: ${agentsResult.candidates}`);
  if (APPLY) {
    console.log(`users docs cleaned:                ${usersResult.cleaned}`);
    console.log(`agents docs cleaned:               ${agentsResult.cleaned}`);
  } else {
    console.log('\nThis was a dry run — no data was written. Re-run with --apply to clean.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Cleanup failed:', err);
    process.exit(1);
  });
