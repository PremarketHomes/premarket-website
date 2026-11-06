import { adminDb } from '../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { OfficeAgentError, resolveDirectoryRow, normalizeEmail } from './officeAgentService';
import { readMembers, detach } from './teamService';
import { requireOfficeAdmin, isOfficeAdminUid } from './officeService';

/**
 * Remove an agent from the office AGENT DIRECTORY (reversible; nothing is deleted).
 *
 * Writes only:
 *   officeAgentRemovals/{id}  the marker (who/when; status 'removed'); the directory, CSV import and invitations honour it
 *   users.teamId / teams       leaves their team (existing detach(): a team under two members dissolves)
 *   officeInvites              a PENDING join invitation is revoked
 *   officeImports rows         a not-yet-sent staged row is marked skipped
 *   officeTeamAudit            audit entry
 * Never touches Firebase Auth, properties/campaigns, offers/registrations, reports or billing.
 *
 * Refused (409, with a plain-language reason): the agent still owns live campaigns; they are an office administrator;
 * they administer a team (pick another administrator first); removing them would dissolve their team.
 * Callers MUST have verified the actor with requireOfficeAdmin({ officeId, uid }).
 */

const idFor = (officeId, row) => `${officeId}_${row.uid ? `u_${row.uid}` : `e_${normalizeEmail(row.email) || row.key}`}`.replace(/\//g, '_');

export async function removeAgentFromDirectory({ officeId, key, actorUid }) {
  const office = await requireOfficeAdmin({ officeId, uid: actorUid });
  const row = await resolveDirectoryRow(officeId, key);
  const label = row.name || row.email || 'This agent';

  if (row.uid && row.uid === actorUid) throw new OfficeAgentError('You cannot remove yourself from the office.', 409);
  if (row.isOfficeAdmin || (row.uid && isOfficeAdminUid(office, row.uid))) {
    throw new OfficeAgentError(`${label} is an office administrator. Remove their administrator access first.`, 409);
  }

  const emails = [...new Set([row.loginEmail, row.email].map(normalizeEmail).filter(Boolean))];
  const removalRef = adminDb.collection('officeAgentRemovals').doc(idFor(officeId, row));

  const result = await adminDb.runTransaction(async (tx) => {
    let teamInfo = { left: null, dissolved: false };
    let teamPlan = null;
    if (row.uid) {
      // Live campaigns: removing the owner must not strand a campaign.
      const props = await tx.get(adminDb.collection('properties').where('userId', '==', row.uid));
      const live = props.docs.filter((d) => d.data().archived !== true).length;
      if (live > 0) {
        throw new OfficeAgentError(`${label} still has ${live} active campaign${live === 1 ? '' : 's'}. Archive ${live === 1 ? 'it' : 'them'} or ask the agent to, then try again.`, 409);
      }
      const userSnap = await tx.get(adminDb.collection('users').doc(row.uid));
      const user = userSnap.exists ? userSnap.data() : null;
      if (user?.officeId === officeId && user.teamId) {
        const teamRef = adminDb.collection('teams').doc(user.teamId);
        const teamSnap = await tx.get(teamRef);
        if (teamSnap.exists && teamSnap.data().officeId === officeId) {
          const team = { id: teamSnap.id, ...teamSnap.data() };
          if (team.createdBy === row.uid) {
            throw new OfficeAgentError(`${label} is the administrator of ${team.name || 'their team'}. Choose another team administrator in Teams first.`, 409);
          }
          const members = await readMembers(tx, team);
          if (members.length - 1 < 2) {
            throw new OfficeAgentError(`${label} is in a two-person team, and removing them would dissolve it. Remove or move them in Teams first.`, 409);
          }
          teamPlan = { team, teamRef, members };
        }
      }
    }
    const inv = row.uid ? adminDb.collection('officeInvites').doc(`${officeId}_${row.uid}`) : null;
    const invSnap = inv ? await tx.get(inv) : null;
    const batches = emails.length ? await tx.get(adminDb.collection('officeImports').where('officeId', '==', officeId)) : { docs: [] };

    // ---- all reads done; writes below ----
    if (teamPlan) {
      const { dissolved } = detach(tx, { ...teamPlan, targetUid: row.uid });
      teamInfo = { left: teamPlan.team.id, dissolved };
    }
    // Revoke a pending join invitation, if any.
    if (invSnap?.exists && invSnap.data().status === 'pending') {
      tx.update(inv, { status: 'revoked', revokedAt: FieldValue.serverTimestamp(), revokedBy: actorUid });
    }
    // A staged-but-unsent CSV row is marked skipped so "Send all" can never invite them.
    {
      for (const b of batches.docs) {
        const rows = b.data().rows || [];
        let changed = false;
        const next = rows.map((r) => {
          if (!emails.includes(normalizeEmail(r.email)) || (r.commitOutcome && r.commitOutcome !== 'failed')) return r;
          changed = true;
          return { ...r, commitOutcome: 'skipped', commitError: 'Removed from the office directory' };
        });
        if (changed) tx.update(b.ref, { rows: next });
      }
    }

    tx.set(removalRef, {
      officeId, status: 'removed', uid: row.uid || null, profileId: row.profileId || null,
      emails, name: row.name || null, wasLogin: row.loginStatus || null,
      removedBy: actorUid, removedAt: FieldValue.serverTimestamp(),
      leftTeamId: teamInfo.left, teamDissolved: teamInfo.dissolved,
    });
    tx.set(adminDb.collection('officeTeamAudit').doc(), {
      officeId, actorUid, action: 'agent.remove', teamId: teamInfo.left, targetUid: row.uid || null,
      detail: { name: row.name || null, loginStatus: row.loginStatus || null, dissolved: teamInfo.dissolved }, at: FieldValue.serverTimestamp(),
    });
    return teamInfo;
  });

  return { removed: true, key: row.key, name: row.name || null, leftTeam: !!result.left };
}
