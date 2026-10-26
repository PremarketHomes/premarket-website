#!/usr/bin/env node
/**
 * Moves PENDING charges of office agents from `agent:{uid}` to
 * `office:{officeId}` billing. NOT executed as part of any deploy.
 *
 *   node scripts/migrate-pending-charges-to-office.js                      # dry run: prints the plan only
 *   node scripts/migrate-pending-charges-to-office.js --apply \
 *        --admin-uid <your uid> --charge-ids id1,id2,...                   # moves ONLY the listed charges
 *
 * Review the dry-run output first. Pass only the charge IDs that belong on
 * the office invoice — e.g. leave out a campaign an agent created before
 * joining the office. Queued, invoiced, excluded or reversed charges are
 * never moved. Each moved charge keeps its original key/name under
 * `migration.*` for audit. Requires FIREBASE_SERVICE_ACCOUNT or
 * GOOGLE_APPLICATION_CREDENTIALS. Never commit credentials.
 */
const admin = require('firebase-admin');
const { planOfficeChargeMigration, applyOfficeChargeMigration } = require('./lib/officeChargeMigration');

if (!admin.apps.length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  } else {
    admin.initializeApp();
  }
}

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};

(async () => {
  const db = admin.firestore();
  if (!process.argv.includes('--apply')) {
    const plan = await planOfficeChargeMigration(db);
    console.log(JSON.stringify(plan, null, 2));
    console.log(`\nDRY RUN: ${plan.candidates.length} charge(s) could move, ${plan.skipped.length} skipped. Nothing was changed.`);
    return;
  }
  const adminUid = arg('--admin-uid');
  const chargeIds = (arg('--charge-ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const results = await applyOfficeChargeMigration(db, {
    chargeIds,
    adminUid,
    FieldValue: admin.firestore.FieldValue,
    reason: arg('--reason'),
  });
  console.log(JSON.stringify(results, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
