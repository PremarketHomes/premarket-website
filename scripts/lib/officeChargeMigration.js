/**
 * Plan / apply logic for moving PENDING charges from an office agent's own
 * `agent:{uid}` billing key onto their office's `office:{officeId}` key.
 *
 * Kept free of any Firebase import (the Firestore handle and FieldValue are
 * passed in) so it is unit-tested against an in-memory fake and run for real
 * only by scripts/migrate-pending-charges-to-office.js.
 *
 * Safety rules, enforced in code:
 *   - Only charges that are `pending` with no run are ever moved. Queued,
 *     invoiced, excluded and reversed charges are never touched.
 *   - Only charges still keyed `agent:{uid}` are moved, and only onto the
 *     office the agent CURRENTLY belongs to (active office, re-checked inside
 *     the transaction at apply time).
 *   - apply needs an explicit list of charge IDs (taken from a reviewed plan);
 *     there is no "migrate everything" mode.
 *   - Nothing is deleted or overwritten blind: the charge keeps its original
 *     key/type/name under `migration.from*`, plus who/when/why.
 *   - Re-running is a no-op for charges already moved.
 */

async function loadActiveOffice(db, officeId) {
  if (!officeId) return null;
  const doc = await db.collection('officeAdminInfo').doc(officeId).get();
  if (!doc.exists || doc.data().status !== 'active') return null;
  return { officeId, officeName: doc.data().name || '' };
}

const toIso = (v) => {
  const d = v?.toDate?.() || (v?._seconds ? new Date(v._seconds * 1000) : v ? new Date(v) : null);
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
};

async function planOfficeChargeMigration(db) {
  const snap = await db.collection('propertyCharges').where('status', '==', 'pending').get();
  const candidates = [];
  const skipped = [];
  const userCache = new Map();

  for (const doc of snap.docs) {
    const charge = doc.data();
    if (charge.billingEntityType !== 'independent' || !String(charge.billingEntityKey || '').startsWith('agent:')) {
      skipped.push({ chargeId: doc.id, reason: 'already-office-or-unknown-key' });
      continue;
    }
    if (charge.runId) {
      skipped.push({ chargeId: doc.id, reason: 'attached-to-a-run' });
      continue;
    }
    if (!userCache.has(charge.agentUserId)) {
      const u = await db.collection('users').doc(charge.agentUserId).get();
      userCache.set(charge.agentUserId, u.exists ? u.data() : null);
    }
    const user = userCache.get(charge.agentUserId);
    const office = await loadActiveOffice(db, user?.officeId);
    if (!office) {
      skipped.push({ chargeId: doc.id, reason: 'agent-not-in-an-active-office' });
      continue;
    }
    candidates.push({
      chargeId: doc.id,
      propertyAddress: charge.propertyAddress,
      agentUserId: charge.agentUserId,
      agentName: charge.agentName,
      chargeCreatedAt: toIso(charge.createdAt),
      agentInvitedAt: toIso(user.invitedAt),
      agentActivatedAt: toIso(user.activatedAt),
      amountInc: charge.totalInc,
      fromKey: charge.billingEntityKey,
      toKey: `office:${office.officeId}`,
      officeName: office.officeName,
    });
  }
  return { candidates, skipped };
}

async function applyOfficeChargeMigration(db, { chargeIds, adminUid, FieldValue, reason }) {
  if (!Array.isArray(chargeIds) || chargeIds.length === 0) throw new Error('chargeIds (from a reviewed plan) are required');
  if (!adminUid) throw new Error('adminUid is required for the audit trail');

  const results = [];
  for (const chargeId of [...new Set(chargeIds)]) {
    const ref = db.collection('propertyCharges').doc(chargeId);
    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { chargeId, moved: false, reason: 'not-found' };
      const charge = snap.data();
      if (charge.billingEntityType === 'office') return { chargeId, moved: false, reason: 'already-office-keyed' };
      if (charge.status !== 'pending' || charge.runId) return { chargeId, moved: false, reason: `not-movable (status ${charge.status})` };
      if (!String(charge.billingEntityKey || '').startsWith('agent:')) return { chargeId, moved: false, reason: 'unexpected-key' };

      const userSnap = await tx.get(db.collection('users').doc(charge.agentUserId));
      const officeId = userSnap.exists ? userSnap.data().officeId : null;
      const officeSnap = officeId ? await tx.get(db.collection('officeAdminInfo').doc(officeId)) : null;
      if (!officeSnap || !officeSnap.exists || officeSnap.data().status !== 'active') {
        return { chargeId, moved: false, reason: 'agent-not-in-an-active-office' };
      }

      const officeName = officeSnap.data().name || '';
      tx.update(ref, {
        billingEntityType: 'office',
        billingEntityKey: `office:${officeId}`,
        billingEntityName: officeName || 'Office',
        officeId,
        officeName,
        migration: {
          fromKey: charge.billingEntityKey,
          fromType: charge.billingEntityType,
          fromName: charge.billingEntityName,
          toKey: `office:${officeId}`,
          by: adminUid,
          at: FieldValue.serverTimestamp(),
          reason: reason || 'Re-keyed to office billing',
        },
      });
      return { chargeId, moved: true, fromKey: charge.billingEntityKey, toKey: `office:${officeId}` };
    });
    results.push(outcome);
  }
  return results;
}

module.exports = { planOfficeChargeMigration, applyOfficeChargeMigration };
