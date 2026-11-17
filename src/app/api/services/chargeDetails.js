// Per-property billing details, read from the linked property record (the
// source of truth) for the admin Charges / Invoice Run screens and Xero
// invoice lines:
//   - full street address: `formattedAddress` ("1 Greenwich Avenue, Pimpama
//     QLD, Australia"); `address` is often suburb-only, and older charges
//     snapshotted it first
//   - selling agent: the roster-assigned agent (`agentId` → `agentName`, or
//     the agents/{agentId} roster name) when there is one, otherwise the
//     listing owner (`userId`). Never the BSO/uploader of an assigned listing.
//     Same rule as utils/listingAgent.js.
//   - submission date: the campaign's own `createdAt`
//
// Read-only: stored charges, runs, amounts and statuses are never changed.
// Anything not on record stays empty (the stored address text is kept as-is)
// rather than being guessed.

import { adminDb } from '../../firebase/adminApp';

const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function fullPropertyAddress(property) {
  return clean(property?.formattedAddress) || clean(property?.address);
}

function toIso(t) {
  const d = t?.toDate ? t.toDate() : t instanceof Date ? t : typeof t === 'string' || typeof t === 'number' ? new Date(t) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

const fullName = (u) => clean(`${clean(u?.firstName) || ''} ${clean(u?.lastName) || ''}`);

/**
 * Returns a copy of `rows` (each with a `propertyId`) with:
 *   [addressKey]      full street address, when the property has one
 *   sellingAgentName  string | null
 *   submittedAt       ISO string | null
 *   chargeStatus      propertyCharges/{propertyId}.status (only with { withChargeStatus: true })
 */
export async function withChargeDetails(rows, addressKey, { withChargeStatus = false } = {}) {
  const list = rows || [];
  const ids = [...new Set(list.map((r) => r?.propertyId).filter((id) => typeof id === 'string' && id))];
  if (ids.length === 0) return list;

  const memo = new Map();
  const getDoc = (col, id) => {
    const key = `${col}/${id}`;
    if (!memo.has(key)) {
      memo.set(key, adminDb.collection(col).doc(id).get()
        .then((s) => (s.exists ? s.data() : null))
        .catch((err) => { console.warn('Charge detail lookup failed', key, err?.message); return null; }));
    }
    return memo.get(key);
  };

  const sellingAgentNameOf = async (p) => {
    if (p.agentId) {
      return clean(p.agentName) || clean((await getDoc('agents', p.agentId))?.name);
    }
    return p.userId ? fullName(await getDoc('users', p.userId)) : null;
  };

  const details = new Map();
  await Promise.all(ids.map(async (id) => {
    const [p, charge] = await Promise.all([
      getDoc('properties', id),
      withChargeStatus ? getDoc('propertyCharges', id) : null,
    ]);
    details.set(id, {
      address: p ? fullPropertyAddress(p) : null,
      sellingAgentName: p ? await sellingAgentNameOf(p) : null,
      submittedAt: p ? toIso(p.createdAt) : null,
      chargeStatus: clean(charge?.status),
    });
  }));

  return list.map((r) => {
    const d = details.get(r?.propertyId);
    if (!d) return { ...r, sellingAgentName: null, submittedAt: null };
    return {
      ...r,
      ...(d.address ? { [addressKey]: d.address } : {}),
      sellingAgentName: d.sellingAgentName,
      submittedAt: d.submittedAt,
      ...(withChargeStatus ? { chargeStatus: d.chargeStatus } : {}),
    };
  });
}
