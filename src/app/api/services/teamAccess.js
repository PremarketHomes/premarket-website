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

/* ───────────────────────────── team managers ───────────────────────────── */

const normName = (n) => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();
const fullName = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`;

/**
 * Team managers: members listed in the team's server-only `teams/{teamId}.managerUids` (firestore.rules deny every
 * client read/write of `teams`; set by Premarket). A manager helps run EVERY campaign of their own team, i.e. a campaign
 *   - owned by a member of the team (whoever uploaded it), or
 *   - whose roster-assigned selling agent (unique same-office name match, the same rule as the team theme) is a member.
 * Evaluated live on every call, so it ends the moment any of these stops being true: the manager is an ACTIVATED agent
 * (an invited account gets nothing until its owner activates it), still in that team, listed on it, in the team's
 * office, which is active, and the campaign's owner is in that same office. Never any other team or office.
 *
 * Returns the team ({ id, ...data }) when `actor` manages it, else null. `actor` is the users/{actorUid} data.
 */
export async function managedTeamOf(db, { actorUid, actor }) {
  if (!actorUid || !isEligibleTeamAgent(actor) || !actor.teamId) return null;
  const [teamSnap, officeSnap] = await Promise.all([
    db.collection('teams').doc(actor.teamId).get(),
    db.collection('officeAdminInfo').doc(actor.officeId).get(),
  ]);
  if (!teamSnap.exists) return null;
  const team = teamSnap.data();
  if (team.officeId !== actor.officeId) return null;
  if (!Array.isArray(team.managerUids) || !team.managerUids.includes(actorUid)) return null;
  if (!officeSnap.exists || officeSnap.data().status !== 'active') return null;
  return { id: teamSnap.id, ...team };
}

/** True when `property` is a campaign of `team` (see managedTeamOf). `owner` is users/{property.userId} data. */
export async function isTeamCampaign(db, { team, property, owner }) {
  if (!team || !property?.userId || !owner || owner.officeId !== team.officeId) return false;
  if (owner.teamId === team.id && isAgent(owner)) return true;
  if (!property.agentId || !normName(property.agentName)) return false;
  const people = await db.collection('users').where('officeId', '==', team.officeId).get();
  const matches = people.docs.filter((d) => isAgent(d.data()) && normName(fullName(d.data())) === normName(property.agentName));
  return matches.length === 1 && matches[0].data().teamId === team.id;
}

/** True when `actorUid` is a manager of the team this campaign belongs to. */
export async function isTeamManagerFor(db, { actorUid, actor, property, owner }) {
  if (!actorUid || !property?.userId || property.userId === actorUid) return false;
  const team = await managedTeamOf(db, { actorUid, actor });
  return !!team && isTeamCampaign(db, { team, property, owner });
}

/**
 * The campaign's selling agent as { uid, user }: the owner, or for a roster-assigned listing the unique agent in the
 * owner's office with that name (same rule as the team theme). null when it can't be resolved unambiguously.
 */
export async function sellingAgentOfProperty(db, { property, owner }) {
  if (!property?.userId || !owner) return null;
  if (!property.agentId) return { uid: property.userId, user: owner };
  if (!normName(property.agentName) || !owner.officeId) return null;
  const people = await db.collection('users').where('officeId', '==', owner.officeId).get();
  const matches = people.docs.filter((d) => isAgent(d.data()) && normName(fullName(d.data())) === normName(property.agentName));
  return matches.length === 1 ? { uid: matches[0].id, user: matches[0].data() } : null;
}
