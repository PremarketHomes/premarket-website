/**
 * Plan / apply logic for scrubbing the full user-document copies that older
 * code embedded in `notifications.user`. Kept free of any Firebase import
 * (the Firestore handle is passed in) so it is unit-tested against an
 * in-memory fake and run for real only by scripts/scrub-notification-user-copies.js.
 *
 * Keeps ONLY the small allowlist of contact fields (mirrors
 * src/app/utils/notificationUser.js — a unit test asserts they match) and
 * drops everything else, including credentials, tokens and billing ids.
 * Re-running is a no-op for notifications already scrubbed. Never prints
 * field values — only field names and counts.
 */
const KEEP_FIELDS = ['uid', 'firstName', 'lastName', 'email', 'phone', 'companyName', 'avatar', 'logoUrl'];

const scrubUser = (user) => {
  const out = {};
  for (const f of KEEP_FIELDS) if (user[f] !== undefined) out[f] = user[f];
  return out;
};

async function planNotificationScrub(db) {
  const snap = await db.collection('notifications').get();
  const toScrub = [];
  const removedFieldCounts = {};
  for (const doc of snap.docs) {
    const user = doc.data().user;
    if (!user || typeof user !== 'object') continue;
    const removed = Object.keys(user).filter((k) => !KEEP_FIELDS.includes(k));
    if (removed.length === 0) continue;
    toScrub.push(doc.id);
    for (const k of removed) removedFieldCounts[k] = (removedFieldCounts[k] || 0) + 1;
  }
  return { total: snap.size, toScrub, removedFieldCounts };
}

async function applyNotificationScrub(db, { notificationIds }) {
  let scrubbed = 0;
  for (let i = 0; i < notificationIds.length; i += 400) {
    const batch = db.batch();
    for (const id of notificationIds.slice(i, i + 400)) {
      const ref = db.collection('notifications').doc(id);
      const snap = await ref.get();
      const user = snap.exists ? snap.data().user : null;
      if (!user || typeof user !== 'object') continue;
      batch.update(ref, { user: scrubUser(user) });
      scrubbed += 1;
    }
    await batch.commit();
  }
  return { scrubbed };
}

module.exports = { KEEP_FIELDS, scrubUser, planNotificationScrub, applyNotificationScrub };
