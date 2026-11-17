// Full street address for billing displays and Xero line items.
//
// A property's `formattedAddress` holds the full street address
// ("1 Greenwich Avenue, Pimpama QLD, Australia"); its `address` is often
// suburb-level only ("Robina"). Older charges snapshotted `address` first,
// so their propertyAddress can be just the suburb. These helpers read the
// linked property record at display/send time instead. They never write:
// stored charges, runs and amounts are left exactly as they are. When the
// property record has no address at all (or no longer exists), the stored
// value is kept as-is rather than guessed.

import { adminDb } from '../../firebase/adminApp';

const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function fullPropertyAddress(property) {
  return clean(property?.formattedAddress) || clean(property?.address);
}

/**
 * Returns a copy of `rows` with `rows[i][addressKey]` replaced by the
 * linked property's full address, looked up by `rows[i].propertyId`.
 */
export async function withFullPropertyAddresses(rows, addressKey) {
  const ids = [...new Set((rows || []).map((r) => r?.propertyId).filter((id) => typeof id === 'string' && id))];
  if (ids.length === 0) return rows || [];

  const found = new Map();
  await Promise.all(ids.map(async (id) => {
    try {
      const snap = await adminDb.collection('properties').doc(id).get();
      const full = snap.exists ? fullPropertyAddress(snap.data()) : null;
      if (full) found.set(id, full);
    } catch (err) {
      console.warn('Property address lookup failed', id, err?.message);
    }
  }));

  return rows.map((r) => (found.has(r?.propertyId) ? { ...r, [addressKey]: found.get(r.propertyId) } : r));
}
