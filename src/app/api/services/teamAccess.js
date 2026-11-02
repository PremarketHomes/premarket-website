import { isAgent } from '../../utils/roles';

/**
 * Team membership is `users.teamId` (server-only, never client-writable —
 * see firestore.rules) pointing at a `teams/{teamId}` doc. That pointer alone
 * is NEVER trusted: it only counts while ALL of the following hold, re-read
 * live on every call, so access ends the instant any of them stops being true:
 *
 *   - the team doc exists and belongs to the user's CURRENT office
 *   - the user is a real, activated agent with an office
 *   - that office is active
 *
 * A stale `teamId` (team dissolved, agent moved/removed from the office)
 * therefore grants nothing and is simply overwritten on the next join.
 */
export const isEligibleTeamAgent = (u) =>
  !!u && isAgent(u) && !!u.officeId && u.accountStatus !== 'invited';

/**
 * True when `requester` and `owner` are currently in the SAME team of the
 * SAME active office. Pure reads via the injected `db` (Admin SDK).
 */
export async function areActiveTeamPeers(db, { requesterUid, requester, ownerUid, owner }) {
  if (!requesterUid || !ownerUid || requesterUid === ownerUid) return false;
  if (!isEligibleTeamAgent(requester) || !isEligibleTeamAgent(owner)) return false;
  if (!requester.teamId || requester.teamId !== owner.teamId) return false;
  if (requester.officeId !== owner.officeId) return false;

  const [teamSnap, officeSnap] = await Promise.all([
    db.collection('teams').doc(requester.teamId).get(),
    db.collection('officeAdminInfo').doc(requester.officeId).get(),
  ]);
  if (!teamSnap.exists || teamSnap.data().officeId !== requester.officeId) return false;
  return officeSnap.exists && officeSnap.data().status === 'active';
}
