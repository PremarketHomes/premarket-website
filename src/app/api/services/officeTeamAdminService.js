import { adminDb } from '../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { loadMember, readMembers, detach, TeamError } from './teamService';
import { buildOfficeAgentDirectory } from './officeAgentService';

/**
 * Office-wide team management for an OFFICE ADMIN, built on the existing team model:
 *   teams/{id}  { officeId, createdBy, name?, createdAt, updatedAt }   (server-only collection)
 *   users/{uid}.teamId                                                   (the single membership pointer)
 * No second membership system and no new role: the existing team CREATOR (`createdBy`) is the team's
 * administrator, and only an office admin can reassign it. Callers MUST have verified the caller with
 * requireOfficeAdmin({ officeId, uid }); every function here additionally re-checks that each team and
 * agent belongs to that office, inside the transaction.
 *
 * Moving/adding/removing only writes `teams` and `users.teamId`. Properties, campaigns, offers, billing,
 * invitations, Auth and profiles are never read or written, so attribution, history and billing are
 * unaffected by membership changes.
 *
 * Existing invariant kept: a team never has fewer than two real members (it dissolves instead).
 */

const MAX_TEAM_NAME = 80;
const cleanName = (n) => {
  const v = String(n ?? '').trim().replace(/\s+/g, ' ');
  if (v.length > MAX_TEAM_NAME) throw new TeamError('Team name is too long.', 400, 'bad-name');
  return v || null;
};
const inTx = (tx) => (r) => tx.get(r);
const teamRef = (id) => adminDb.collection('teams').doc(id);

async function loadOfficeTeam(read, officeId, teamId) {
  const snap = await read(teamRef(teamId));
  if (!snap.exists || snap.data().officeId !== officeId) throw new TeamError('Team not found in this office.', 404, 'team-not-found');
  return { id: snap.id, ref: teamRef(teamId), ...snap.data() };
}

async function loadOfficeAgent(read, officeId, uid) {
  const m = await loadMember(read, uid);
  if (!m.user || m.user.officeId !== officeId) throw new TeamError('Agent not found in this office.', 404, 'agent-not-found');
  return m;
}

function audit(tx, { officeId, actorUid, action, teamId = null, targetUid = null, detail = {} }) {
  tx.set(adminDb.collection('officeTeamAudit').doc(), {
    officeId, actorUid, action, teamId, targetUid, detail, at: FieldValue.serverTimestamp(),
  });
}

/** All teams of the office with their members, plus agents who have no team. */
export async function listOfficeTeams(officeId) {
  const [teamsSnap, { agents }] = await Promise.all([
    adminDb.collection('teams').where('officeId', '==', officeId).get(),
    buildOfficeAgentDirectory(officeId),
  ]);
  const byUid = new Map(agents.filter((a) => a.uid).map((a) => [a.uid, a]));
  const member = (a) => ({ uid: a.uid, key: a.key, name: a.name, email: a.email, photoUrl: a.photoUrl, loginStatus: a.loginStatus });
  const teams = teamsSnap.docs.map((d) => {
    const t = d.data();
    const members = agents.filter((a) => a.uid && a.team?.id === d.id).map(member);
    const admin = byUid.get(t.createdBy);
    return {
      id: d.id,
      name: t.name || null,
      displayName: t.name || (admin?.name ? `${admin.name}'s team` : 'Team'),
      adminUid: t.createdBy || null,
      adminName: admin?.name || null,
      members,
    };
  });
  const unassigned = agents.filter((a) => !a.team).map((a) => ({ ...member(a), canAssign: !!a.uid }));
  return { teams: teams.sort((x, y) => x.displayName.localeCompare(y.displayName)), unassigned };
}

export async function createOfficeTeam({ officeId, actorUid, name, memberUids, adminUid }) {
  const uids = [...new Set(memberUids || [])];
  if (uids.length < 2) throw new TeamError('A team needs at least two agents.', 400, 'too-small');
  if (!uids.includes(adminUid)) throw new TeamError('The team administrator must be one of the members.', 400, 'bad-admin');
  const teamName = cleanName(name);
  return adminDb.runTransaction(async (tx) => {
    const read = inTx(tx);
    const members = [];
    for (const uid of uids) {
      const m = await loadOfficeAgent(read, officeId, uid);
      if (m.team) throw new TeamError('Every agent must be unassigned first. Use Move to change teams.', 409, 'already-in-team');
      members.push(m);
    }
    const ref = adminDb.collection('teams').doc();
    tx.set(ref, { officeId, createdBy: adminUid, ...(teamName ? { name: teamName } : {}), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), createdByOfficeAdmin: actorUid });
    members.forEach((m) => tx.update(m.userRef, { teamId: ref.id }));
    audit(tx, { officeId, actorUid, action: 'team.create', teamId: ref.id, detail: { memberUids: uids, adminUid } });
    return { teamId: ref.id };
  });
}

export async function updateOfficeTeam({ officeId, actorUid, teamId, name, adminUid }) {
  if (name === undefined && adminUid === undefined) throw new TeamError('Nothing to update.', 400, 'empty');
  const teamName = name === undefined ? undefined : cleanName(name);
  return adminDb.runTransaction(async (tx) => {
    const read = inTx(tx);
    const team = await loadOfficeTeam(read, officeId, teamId);
    const patch = { updatedAt: FieldValue.serverTimestamp() };
    const detail = {};
    if (teamName !== undefined) { patch.name = teamName || FieldValue.delete(); detail.name = teamName; }
    if (adminUid !== undefined) {
      const m = await loadOfficeAgent(read, officeId, adminUid);
      if (m.team?.id !== teamId) throw new TeamError('The team administrator must be a current member of the team.', 400, 'bad-admin');
      patch.createdBy = adminUid; detail.adminUid = adminUid; detail.previousAdminUid = team.createdBy;
    }
    tx.update(team.ref, patch);
    audit(tx, { officeId, actorUid, action: 'team.update', teamId, detail });
    return { teamId };
  });
}

export async function addOfficeTeamMember({ officeId, actorUid, teamId, uid }) {
  return adminDb.runTransaction(async (tx) => {
    const read = inTx(tx);
    const team = await loadOfficeTeam(read, officeId, teamId);
    const m = await loadOfficeAgent(read, officeId, uid);
    if (m.team) throw new TeamError('That agent is already in a team. Use Move instead.', 409, 'already-in-team');
    tx.update(m.userRef, { teamId });
    tx.update(team.ref, { updatedAt: FieldValue.serverTimestamp() });
    audit(tx, { officeId, actorUid, action: 'team.addMember', teamId, targetUid: uid });
    return { teamId };
  });
}

export async function removeOfficeTeamMember({ officeId, actorUid, uid, confirmDissolve = false }) {
  return adminDb.runTransaction(async (tx) => {
    const read = inTx(tx);
    const m = await loadOfficeAgent(read, officeId, uid);
    if (!m.team || m.team.officeId !== officeId) throw new TeamError("That agent isn't in a team.", 404, 'not-member');
    const members = await readMembers(tx, m.team);
    if (members.length - 1 < 2 && !confirmDissolve) {
      throw new TeamError('Removing this agent would leave the team with fewer than two members, which dissolves it.', 409, 'would-dissolve');
    }
    const { dissolved } = detach(tx, { team: m.team, teamRef: m.teamRef, members, targetUid: uid });
    audit(tx, { officeId, actorUid, action: 'team.removeMember', teamId: m.team.id, targetUid: uid, detail: { dissolved } });
    return { removed: true, dissolved };
  });
}

export async function moveOfficeTeamMember({ officeId, actorUid, uid, toTeamId, confirmDissolve = false }) {
  return adminDb.runTransaction(async (tx) => {
    const read = inTx(tx);
    const to = await loadOfficeTeam(read, officeId, toTeamId);
    const m = await loadOfficeAgent(read, officeId, uid);
    if (m.team?.id === toTeamId) throw new TeamError('That agent is already in this team.', 409, 'same-team');
    let dissolvedFrom = null;
    if (m.team) {
      if (m.team.officeId !== officeId) throw new TeamError('Agent not found in this office.', 404, 'agent-not-found');
      const members = await readMembers(tx, m.team);
      if (members.length - 1 < 2 && !confirmDissolve) {
        throw new TeamError('Moving this agent would leave their current team with fewer than two members, which dissolves it.', 409, 'would-dissolve');
      }
      const { dissolved } = detach(tx, { team: m.team, teamRef: m.teamRef, members, targetUid: uid });
      if (dissolved) dissolvedFrom = m.team.id;
    }
    // detach() cleared teamId on the agent; set the new pointer in the same transaction (last write wins).
    tx.update(m.userRef, { teamId: toTeamId });
    tx.update(to.ref, { updatedAt: FieldValue.serverTimestamp() });
    audit(tx, { officeId, actorUid, action: 'team.moveMember', teamId: toTeamId, targetUid: uid, detail: { fromTeamId: m.team?.id || null, dissolvedFrom } });
    return { moved: true, dissolvedFrom };
  });
}
