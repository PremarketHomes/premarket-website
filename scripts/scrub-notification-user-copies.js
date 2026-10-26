#!/usr/bin/env node
/**
 * Removes credentials, tokens and billing ids from the full user-document
 * copies embedded in `notifications.user`. NOT executed as part of any deploy.
 *
 *   node scripts/scrub-notification-user-copies.js           # dry run: field names + counts only
 *   node scripts/scrub-notification-user-copies.js --apply   # rewrites `user` to the contact allowlist
 *
 * Only `notifications.user` is modified; nothing is deleted. Prints no
 * field values. Requires Application Default Credentials (or
 * FIREBASE_SERVICE_ACCOUNT) and GOOGLE_CLOUD_PROJECT. Never commit credentials.
 */
const admin = require('firebase-admin');
const { planNotificationScrub, applyNotificationScrub } = require('./lib/notificationUserScrub');

if (!admin.apps.length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  } else {
    admin.initializeApp();
  }
}

(async () => {
  const db = admin.firestore();
  const plan = await planNotificationScrub(db);
  console.log(`${plan.toScrub.length} of ${plan.total} notification(s) contain extra user fields.`);
  console.log('Fields that would be removed (name: notification count):', JSON.stringify(plan.removedFieldCounts));
  if (!process.argv.includes('--apply')) {
    console.log('\nDRY RUN: nothing was changed.');
    return;
  }
  const result = await applyNotificationScrub(db, { notificationIds: plan.toScrub });
  console.log(`Scrubbed ${result.scrubbed} notification(s).`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
