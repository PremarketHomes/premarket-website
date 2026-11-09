/**
 * Teams — agents of ONE verified office who choose to share read-only sight of
 * each other's campaigns. Deliberately tiny and additive:
 *
 *   `teams/{teamId}`           { officeId, createdBy, createdAt, updatedAt }
 *   `teamInvites/{inviteId}`   { fromUid, toUid, toEmail, officeId, teamId|null,
 *                                status, createdAt, ... }
 *   `users/{uid}.teamId`       the ONE-team-per-agent pointer
 *
 * All three are server-only: the rules deny every client read/write of the two
 * collections and exclude `teamId` from every client-writable field list, exactly
 * like `officeId`. Members are NOT stored on the team — they are the users whose
 * `teamId` points at it — so there is a single source of truth to keep consistent.
 *
 * Invariants (all enforced inside Firestore transactions):
 *   - one team per agent: `users/{uid}.teamId` is read and written by every join,
 *     so two concurrent accepts for the same agent conflict and one retries into
 *     the "already in a team" refusal.
 *   - teams never merge: an invitee who already has a team must leave it first.
 *   - same verified office, both active agents, re-checked at invite AND accept.
 *   - every membership change reads and writes the team doc, so a leave/remove
 *     cannot interleave with a join.
 *
 * Team membership never changes ownership, billing attribution (resolved from
 * the property owner's own office, see billingService) or any permission: the
 * only thing it unlocks is the READ-ONLY, redacted report level in
 * propertyAccessService.
 */

import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../../firebase/adminApp';
import { BASE_URL } from './emailTemplates';
import { sendTeamInviteEmail } from './resendService';
import { toOfficeTeamProperty } from './officeTeamService';
import { isEligibleTeamAgent } from './teamAccess';
import { isTestCampaign } from '../../utils/testCampaign';

export const TEAM_INVITE_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_INVITES_PER_DAY = 10;
export const MAX_PENDING_INVITES = 20;
// Every lookup attempt counts (successful or not), so the invite form can't be
// used to probe which colleagues' emails exist. Separate from, and higher
// than, the cap on invitations actually stored.
export const MAX_ATTEMPTS_PER_DAY = 30;
// Every non-error answer is held to at least this long, so a quick "nobody
// eligible" reply can't be told apart from a slower "invite stored + email sent".
const DEFAULT_MIN_RESPONSE_MS = 800;
export const REINVITE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_TEAM_PROPERTIES = 300;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export class TeamError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const ref = (col, id) => adminDb.collection(col).doc(id);
const direct = (r) => r.get();
const inTx = (tx) => (r) => tx.get(r);

const toMillis = (t) => {
  if (!t) return null;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  const n = new Date(t).getTime();
  return Number.isNaN(n) ? null : n;
};
const toIso = (t) => { const m = toMillis(t); return m == null ? null : new Date(m).toISOString(); };

export const isInviteExpired = (invite, now = Date.now()) => {
  const created = toMillis(invite.createdAt);
  return created != null && now - created > TEAM_INVITE_EXPIRY_MS;
};

const displayName = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || null;
const normalizeEmail = (e) => String(e || '').trim().toLowerCase();

/* ───────────────────────────── reads ───────────────────────────── */

/** User + their EFFECTIVE team (a pointer that is stale — team gone or the
 * agent now in another office — counts as no team). */
export async function loadMember(read, uid) {
  const userRef = ref('users', uid);
  const userSnap = await read(userRef);
  if (!userSnap.exists) return { uid, user: null, team: null, userRef };
  const user = userSnap.data();
  let team = null;
  let teamRef = null;
  if (user.teamId) {
    teamRef = ref('teams', user.teamId);
    const t = await read(teamRef);
    if (t.exists && t.data().officeId && t.data().officeId === user.officeId) {
      team = { id: t.id, ...t.data() };
    }
  }
  return { uid, user, userRef, team, teamRef };
}

async function loadOffice(read, officeId) {
  if (!officeId) return null;
  const s = await read(ref('officeAdminInfo', officeId));
  if (!s.exists || s.data().status !== 'active') return null;
  return { id: officeId, ...s.data() };
}

/** Throws unless this member is an activated agent of an ACTIVE office. */
async function requireActiveAgent(read, member, { who = 'You' } = {}) {
  if (!isEligibleTeamAgent(member.user)) {
    throw new TeamError(
      who === 'You'
        ? 'Teams are available to activated agents who belong to a verified agency office.'
        : 'That agent is not eligible for a team.',
      403,
      'not-eligible',
    );
  }
  const office = await loadOffice(read, member.user.officeId);
  if (!office) throw new TeamError('Your office is not active, so teams are unavailable.', 403, 'office-inactive');
  return office;
}

/* ───────────────────────────── invite ───────────────────────────── */

const inviteId = ({ teamId, fromUid, toUid }) => (teamId ? `t_${teamId}_${toUid}` : `u_${fromUid}_${toUid}`);

async function resolveTargetUid(email) {
  try {
    const rec = await getAuth().getUserByEmail(email);
    return rec.disabled ? null : rec.uid;
  } catch (err) {
    if (err?.code === 'auth/user-not-found') return null;
    throw err;
  }
}

// The ONLY thing a sender ever learns about a valid, well-formed attempt. It is
// identical whether the invite was stored, the person doesn't exist, is in
// another office, is already in a team, was already invited, or declined
// recently — and it deliberately says nothing about email delivery, since a
// delivery report would itself reveal that the recipient was eligible.
const GENERIC_SENT = {
  ok: true,
  message: "If that email belongs to an active agent in your office, they'll receive an invitation. It will also appear on their My Team page.",
};

/** Per-sender daily cap on invitation ATTEMPTS, enforced transactionally on a
 * single tiny server-only doc (`teamInviteAttempts/{uid}`, fixed 24h window). */
async function chargeInviteAttempt(uid) {
  const attemptsRef = ref('teamInviteAttempts', uid);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(attemptsRef);
    const now = Date.now();
    const data = snap.exists ? snap.data() : null;
    const start = toMillis(data?.windowStart);
    if (!data || start == null || now - start >= DAY_MS) {
      tx.set(attemptsRef, { windowStart: FieldValue.serverTimestamp(), count: 1 });
      return;
    }
    if ((data.count || 0) >= MAX_ATTEMPTS_PER_DAY) {
      throw new TeamError('You have tried to send too many invitations today. Please try again tomorrow.', 429, 'rate-limited');
    }
    tx.update(attemptsRef, { count: (data.count || 0) + 1 });
  });
}

export async function sendTeamInvite(params) {
  const started = Date.now();
  const result = await sendTeamInviteInner(params);
  // Only successful (generic) answers are padded; refusals about the sender
  // themself (bad email, rate limit, ...) reveal nothing about anyone else.
  const floor = Number(process.env.TEAM_INVITE_MIN_RESPONSE_MS ?? DEFAULT_MIN_RESPONSE_MS);
  const wait = floor - (Date.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  return result;
}

async function sendTeamInviteInner({ actorUid, actorEmail, email }) {
  const target = normalizeEmail(email);
  if (!EMAIL_RE.test(target)) throw new TeamError('Enter a valid email address.', 400, 'bad-email');

  const actor = await loadMember(direct, actorUid);
  await requireActiveAgent(direct, actor);

  if (target === normalizeEmail(actorEmail) || target === normalizeEmail(actor.user.email)) {
    throw new TeamError("You can't invite yourself.", 400, 'self-invite');
  }

  // Attempt limit first: it must apply to lookups that end up storing nothing.
  await chargeInviteAttempt(actorUid);

  // Stored-invite limits (per sender, durable across serverless instances).
  // Soft by design: a race can overshoot by a few.
  const mine = (await adminDb.collection('teamInvites').where('fromUid', '==', actorUid).get()).docs.map((d) => d.data());
  const now = Date.now();
  if (mine.filter((i) => (toMillis(i.createdAt) ?? 0) > now - DAY_MS).length >= MAX_INVITES_PER_DAY) {
    throw new TeamError('You have sent a lot of invitations today. Please try again tomorrow.', 429, 'rate-limited');
  }
  if (mine.filter((i) => i.status === 'pending' && !isInviteExpired(i, now)).length >= MAX_PENDING_INVITES) {
    throw new TeamError('You have too many pending invitations. Cancel some before sending more.', 429, 'too-many-pending');
  }

  // Resolve the recipient SERVER-side. Anything that stops them being an
  // eligible agent of the SAME office returns the identical generic answer, so
  // this cannot be used to discover which emails have Premarket accounts.
  const toUid = await resolveTargetUid(target);
  if (!toUid) return GENERIC_SENT;
  if (toUid === actorUid) throw new TeamError("You can't invite yourself.", 400, 'self-invite');

  const prelim = await loadMember(direct, toUid);
  if (!isEligibleTeamAgent(prelim.user) || prelim.user.officeId !== actor.user.officeId) return GENERIC_SENT;

  const result = await adminDb.runTransaction(async (tx) => {
    const read = inTx(tx);
    const a = await loadMember(read, actorUid);
    const t = await loadMember(read, toUid);
    const off = await requireActiveAgent(read, a);
    if (!isEligibleTeamAgent(t.user) || t.user.officeId !== a.user.officeId) return { generic: true };

    // The sender must never be able to tell whether the recipient is already in
    // a team — not from an error, and not from the invite quietly not appearing
    // in their "pending" list. So an in-team colleague is invited exactly like
    // anyone else; it is the RECIPIENT who is told to leave their current team
    // first, on their own My Team page and if they try to accept (teams never
    // merge — see respondToInvite). The one exception is someone already on the
    // sender's OWN team, which the sender can see in their member list anyway.
    if (t.team && a.team && a.team.id === t.team.id) return { generic: true };

    const id = inviteId({ teamId: a.team?.id || null, fromUid: actorUid, toUid });
    const inviteRef = ref('teamInvites', id);
    const existing = await read(inviteRef);
    if (existing.exists) {
      const e = existing.data();
      // A duplicate (or a recent decline) stores nothing and sends NO email, and
      // looks exactly like any other generic answer to the sender.
      if (e.status === 'pending' && !isInviteExpired(e)) return { generic: true };
      const respondedMs = toMillis(e.respondedAt);
      if (e.status === 'declined' && respondedMs != null && Date.now() - respondedMs < REINVITE_COOLDOWN_MS) return { generic: true };
    }

    tx.set(inviteRef, {
      fromUid: actorUid,
      fromName: displayName(a.user),
      toUid,
      toEmail: target,
      toName: displayName(t.user),
      officeId: a.user.officeId,
      officeName: off.name || '',
      teamId: a.team?.id || null,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });
    return { id, inviterName: displayName(a.user) || 'A colleague', officeName: off.name || '', toFirstName: t.user.firstName || '' };
  });

  if (result.generic) return GENERIC_SENT;

  // Only reached when THIS call stored a new invitation, so a repeated or
  // concurrent request can never send a second email. A delivery failure never
  // undoes the invitation: it already shows on the recipient's My Team page and
  // can be accepted from there. It is logged and recorded on the invite
  // (`emailStatus`) for support — not reported to the sender, which would reveal
  // that the recipient was eligible.
  let emailStatus = 'sent';
  try {
    await sendTeamInviteEmail(target, result.toFirstName, result.inviterName, result.officeName, `${BASE_URL}/dashboard/team`);
  } catch (err) {
    emailStatus = 'failed';
    console.error('Team invite email failed for invite', result.id, '-', err.message);
  }
  try {
    await ref('teamInvites', result.id).update({ emailStatus, emailAttemptedAt: FieldValue.serverTimestamp() });
  } catch (err) {
    console.error('Could not record team invite email status for', result.id, '-', err.message);
  }
  return GENERIC_SENT;
}

/* ───────────────────────── respond / cancel ───────────────────────── */

export async function respondToInvite({ inviteId: id, actorUid, action }) {
  if (!['accept', 'decline', 'cancel'].includes(action)) throw new TeamError('Unknown action.', 400, 'bad-action');

  return adminDb.runTransaction(async (tx) => {
    const read = inTx(tx);
    const inviteRef = ref('teamInvites', id);
    const snap = await read(inviteRef);
    if (!snap.exists) throw new TeamError('This invitation could not be found.', 404, 'not-found');
    const invite = snap.data();

    if (action === 'cancel') {
      const a = await loadMember(read, actorUid);
      const sameTeam = invite.teamId && a.team?.id === invite.teamId;
      if (invite.fromUid !== actorUid && !sameTeam) throw new TeamError('You cannot cancel this invitation.', 403, 'forbidden');
      if (invite.status !== 'pending') throw new TeamError('This invitation is no longer pending.', 409, 'not-pending');
      tx.update(inviteRef, { status: 'cancelled', respondedAt: FieldValue.serverTimestamp(), respondedBy: actorUid });
      return { status: 'cancelled' };
    }

    // accept / decline are the recipient's alone
    if (invite.toUid !== actorUid) throw new TeamError("This invitation isn't for your account.", 403, 'forbidden');

    if (action === 'decline') {
      if (invite.status !== 'pending') throw new TeamError('This invitation is no longer pending.', 409, 'not-pending');
      tx.update(inviteRef, { status: 'declined', respondedAt: FieldValue.serverTimestamp(), respondedBy: actorUid });
      return { status: 'declined' };
    }

    // ── accept ──
    if (invite.status === 'accepted') return { status: 'accepted', alreadyAccepted: true };
    if (invite.status !== 'pending') throw new TeamError('This invitation is no longer valid.', 410, 'gone');
    if (isInviteExpired(invite)) throw new TeamError('This invitation has expired. Ask them to send a new one.', 410, 'expired');

    const me = await loadMember(read, actorUid);
    const inviter = await loadMember(read, invite.fromUid);
    await requireActiveAgent(read, me);

    if (me.user.officeId !== invite.officeId) {
      throw new TeamError('This invitation is for a different office, so it cannot be accepted.', 409, 'office-mismatch');
    }
    if (!isEligibleTeamAgent(inviter.user) || inviter.user.officeId !== invite.officeId) {
      throw new TeamError('The agent who invited you is no longer in your office. This invitation is no longer valid.', 410, 'inviter-gone');
    }
    if (me.team) {
      throw new TeamError("You're already in a team. Leave your current team before joining another.", 409, 'already-in-team');
    }
    // The invite is only good while the inviter is still where they were when
    // they sent it (still in that same team, or still without one).
    const inviterTeamId = inviter.team?.id || null;
    if (inviterTeamId !== (invite.teamId || null)) {
      throw new TeamError('This invitation is no longer valid. Ask them to send a new one.', 410, 'inviter-moved');
    }

    if (inviter.team) {
      tx.update(inviter.teamRef, { updatedAt: FieldValue.serverTimestamp() });
      tx.update(me.userRef, { teamId: inviter.team.id });
      tx.update(inviteRef, { status: 'accepted', respondedAt: FieldValue.serverTimestamp(), respondedBy: actorUid });
      return { status: 'accepted', teamId: inviter.team.id };
    }

    const teamRef = adminDb.collection('teams').doc();
    tx.set(teamRef, {
      officeId: invite.officeId,
      createdBy: invite.fromUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(inviter.userRef, { teamId: teamRef.id });
    tx.update(me.userRef, { teamId: teamRef.id });
    tx.update(inviteRef, { status: 'accepted', respondedAt: FieldValue.serverTimestamp(), respondedBy: actorUid });
    return { status: 'accepted', teamId: teamRef.id, createdTeam: true };
  });
}

/* ─────────────────────── leave / remove members ─────────────────────── */

/** Real members of a team: pointer set AND still in the team's office. */
export async function readMembers(tx, team) {
  const snap = await tx.get(adminDb.collection('users').where('teamId', '==', team.id));
  return snap.docs.filter((d) => d.data().officeId === team.officeId);
}

/**
 * Detach `targetUid` from `team` inside a transaction the caller already
 * opened. A team of fewer than two real members is dissolved, so no one is
 * ever left in a team of one. If the creator goes, the role passes on.
 */
export function detach(tx, { team, teamRef, members, targetUid }) {
  const remaining = members.filter((d) => d.id !== targetUid);
  tx.update(adminDb.collection('users').doc(targetUid), { teamId: FieldValue.delete() });
  if (remaining.length < 2) {
    remaining.forEach((d) => tx.update(d.ref || adminDb.collection('users').doc(d.id), { teamId: FieldValue.delete() }));
    tx.delete(teamRef);
    return { dissolved: true };
  }
  const patch = { updatedAt: FieldValue.serverTimestamp() };
  if (team.createdBy === targetUid) patch.createdBy = remaining[0].id;
  tx.update(teamRef, patch);
  return { dissolved: false };
}

export async function leaveTeam({ actorUid }) {
  return adminDb.runTransaction(async (tx) => {
    const me = await loadMember(inTx(tx), actorUid);
    if (!me.user?.teamId) throw new TeamError("You're not in a team.", 404, 'no-team');
    if (!me.team) {
      // Stale pointer (team gone / office changed): just clear it.
      tx.update(me.userRef, { teamId: FieldValue.delete() });
      return { left: true, dissolved: false };
    }
    const members = await readMembers(tx, me.team);
    const { dissolved } = detach(tx, { team: me.team, teamRef: me.teamRef, members, targetUid: actorUid });
    return { left: true, dissolved };
  });
}

export async function removeTeamMember({ actorUid, targetUid }) {
  if (actorUid === targetUid) throw new TeamError('Use "Leave team" to leave your own team.', 400, 'use-leave');
  return adminDb.runTransaction(async (tx) => {
    const read = inTx(tx);
    const target = await loadMember(read, targetUid);
    if (!target.team) throw new TeamError("That agent isn't in a team.", 404, 'not-member');
    const actor = await loadMember(read, actorUid);
    const office = await read(ref('officeAdminInfo', target.team.officeId));

    const isCreator = actor.team?.id === target.team.id && target.team.createdBy === actorUid;
    const isOfficeAdmin = office.exists
      && office.data().status === 'active'
      && Array.isArray(office.data().officeAdminUids)
      && office.data().officeAdminUids.includes(actorUid)
      && actor.user?.officeId === target.team.officeId;
    if (!isCreator && !isOfficeAdmin) {
      throw new TeamError('Only the team creator or an office administrator can remove members.', 403, 'forbidden');
    }

    const members = await readMembers(tx, target.team);
    const { dissolved } = detach(tx, { team: target.team, teamRef: target.teamRef, members, targetUid });
    return { removed: true, dissolved };
  });
}

/* ───────────────────────────── overview ───────────────────────────── */

async function activeTeamMembers(team) {
  const snap = await adminDb.collection('users').where('teamId', '==', team.id).get();
  return snap.docs
    .filter((d) => d.data().officeId === team.officeId && isEligibleTeamAgent(d.data()))
    .map((d) => ({ uid: d.id, ...d.data() }));
}

export async function getTeamOverview(uid) {
  const me = await loadMember(direct, uid);
  if (!me.user) throw new TeamError('Account not found.', 404, 'not-found');
  const office = isEligibleTeamAgent(me.user) ? await loadOffice(direct, me.user.officeId) : null;
  if (!office) return { eligible: false, office: null, team: null, incoming: [], outgoing: [] };

  const now = Date.now();
  const adminUids = Array.isArray(office.officeAdminUids) ? office.officeAdminUids : [];
  const iAmOfficeAdmin = adminUids.includes(uid);

  let team = null;
  let outgoing = [];
  if (me.team) {
    const members = await activeTeamMembers(me.team);
    const mayRemove = me.team.createdBy === uid || iAmOfficeAdmin;
    team = {
      id: me.team.id,
      createdBy: me.team.createdBy,
      members: members
        .map((m) => ({
          uid: m.uid,
          name: displayName(m),
          email: m.email || null,
          isYou: m.uid === uid,
          isCreator: m.uid === me.team.createdBy,
          canRemove: mayRemove && m.uid !== uid,
        }))
        .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || '')),
    };
    const snap = await adminDb.collection('teamInvites').where('teamId', '==', me.team.id).get();
    outgoing = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } else {
    const snap = await adminDb.collection('teamInvites').where('fromUid', '==', uid).get();
    outgoing = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((i) => !i.teamId);
  }
  outgoing = outgoing
    .filter((i) => i.status === 'pending' && !isInviteExpired(i, now))
    .map((i) => ({ id: i.id, toEmail: i.toEmail, toName: i.toName || null, fromName: i.fromName || null, createdAt: toIso(i.createdAt), expiresAt: new Date((toMillis(i.createdAt) ?? now) + TEAM_INVITE_EXPIRY_MS).toISOString() }));

  const inSnap = await adminDb.collection('teamInvites').where('toUid', '==', uid).get();
  const incoming = inSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((i) => i.status === 'pending' && !isInviteExpired(i, now) && i.officeId === me.user.officeId)
    .map((i) => ({
      id: i.id,
      fromName: i.fromName || null,
      officeName: i.officeName || office.name || '',
      createdAt: toIso(i.createdAt),
      expiresAt: new Date((toMillis(i.createdAt) ?? now) + TEAM_INVITE_EXPIRY_MS).toISOString(),
      // Teams never merge: with a team already, they must leave it first.
      blocked: !!me.team,
    }));

  return { eligible: true, office: { id: office.id, name: office.name || '' }, team, incoming, outgoing };
}

/* ─────────────────────────── team properties ─────────────────────────── */

/**
 * Buyer-opinion counts for a set of properties, computed server-side because
 * `offers` is not client-readable for anyone but the property's own agent.
 * Only a COUNT per property is returned (type === 'opinion', the same rule the
 * agent's own dashboard uses) — never an offer, amount or buyer detail.
 */
async function countOpinionsByProperty(propertyIds) {
  const counts = Object.fromEntries(propertyIds.map((id) => [id, 0]));
  for (let i = 0; i < propertyIds.length; i += 30) {
    const batch = propertyIds.slice(i, i + 30);
    const snap = await adminDb.collection('offers').where('propertyId', 'in', batch).get();
    for (const d of snap.docs) {
      const o = d.data();
      if (o.type === 'opinion' && counts[o.propertyId] !== undefined) counts[o.propertyId] += 1;
    }
  }
  return counts;
}

/**
 * The listings of the caller's teammates (not their own), as minimal read-only
 * rows: no offers, buyer data, phone numbers or billing — only the anonymous
 * `opinions` count. Properties an owner has removed from their own view
 * (`hidden`) are not shared. Membership and office status are re-read on every
 * call, so leaving a team ends visibility immediately.
 */
export async function listTeamProperties(uid) {
  const me = await loadMember(direct, uid);
  if (!isEligibleTeamAgent(me.user) || !me.team) throw new TeamError("You're not in a team.", 403, 'no-team');
  if (!(await loadOffice(direct, me.user.officeId))) throw new TeamError('Your office is not active.', 403, 'office-inactive');

  const mates = (await activeTeamMembers(me.team)).filter((m) => m.uid !== uid);
  const lists = await Promise.all(
    mates.map(async (m) => {
      const snap = await adminDb.collection('properties').where('userId', '==', m.uid).get();
      return snap.docs
        .filter((d) => d.data().hidden !== true && !isTestCampaign(d.data())) // test campaigns are not shared or counted
        .map((d) => ({
          ...toOfficeTeamProperty(d.id, d.data()),
          owner: { uid: m.uid, name: displayName(m) || m.email || 'Teammate' },
        }));
    }),
  );
  const properties = lists.flat().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, MAX_TEAM_PROPERTIES);
  const opinionCounts = properties.length ? await countOpinionsByProperty(properties.map((p) => p.id)) : {};
  for (const p of properties) p.opinions = opinionCounts[p.id] || 0;
  const counts = properties.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {});
  return { properties, counts, total: properties.length };
}
