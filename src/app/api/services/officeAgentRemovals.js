import { adminDb } from '../../firebase/adminApp';

/**
 * Reversible "removed from the office directory" markers: `officeAgentRemovals/{id}` (server-only, status 'removed').
 * Kept dependency-free so the directory, CSV import and invitation code can all consult it without import cycles.
 * A marker never deletes anything: Auth account, campaigns, registrations, reports and billing are untouched.
 * To reverse a removal set `status` to 'restored' (the record stays as history).
 */

const norm = (e) => String(e || '').trim().toLowerCase();

export async function loadRemovedSet(officeId) {
  const snap = await adminDb.collection('officeAgentRemovals').where('officeId', '==', officeId).where('status', '==', 'removed').get();
  const uids = new Set(); const emails = new Set(); const profileIds = new Set();
  for (const d of snap.docs) {
    const r = d.data();
    if (r.uid) uids.add(r.uid);
    if (r.profileId) profileIds.add(r.profileId);
    for (const e of r.emails || []) if (e) emails.add(norm(e));
  }
  return { uids, emails, profileIds };
}

export const isRemovedEmail = (set, email) => !!email && set.emails.has(norm(email));
export const isRemovedUid = (set, uid) => !!uid && set.uids.has(uid);

/** Drop every directory input that belongs to a removed agent (by uid, profile id or any known email). */
export function excludeRemoved({ users = [], invites = [], staged = [], profiles = [] }, set) {
  if (!set.uids.size && !set.emails.size && !set.profileIds.size) return { users, invites, staged, profiles };
  return {
    users: users.filter((u) => !isRemovedUid(set, u.uid) && !isRemovedEmail(set, u.email)),
    invites: invites.filter((i) => !isRemovedUid(set, i.targetUid) && !isRemovedEmail(set, i.targetEmail)),
    staged: staged.filter((s) => !isRemovedEmail(set, s.email)),
    profiles: profiles.filter((p) => !set.profileIds.has(p.id) && !isRemovedUid(set, p.linkedUid)
      && !isRemovedEmail(set, p.emailKey) && !isRemovedEmail(set, p.contactEmail)),
  };
}
