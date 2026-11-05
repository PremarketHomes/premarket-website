import { adminDb } from '../../firebase/adminApp';
import { FieldValue } from 'firebase-admin/firestore';
import { listStagedAgents } from './officeImportService';

/**
 * Office agent directory + canonical professional profiles (`officeAgents`).
 *
 * Model
 *  - `officeAgents/{id}` is an OFFICE-SCOPED professional profile with a stable random id that never
 *    depends on login activation. `linkedUid` is an explicit, optional link to an existing Firebase
 *    Auth uid. Server-only collection (see firestore.rules).
 *  - Nothing here ever creates a Firebase Auth user, sends an email, or changes accountStatus.
 *  - The directory is a read-only merge of existing records; it never invents agents.
 *  - Profile values override the login-linked `users` values only where the office has set them, so
 *    existing photos/details show until someone deliberately replaces them.
 */

export class OfficeAgentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'OfficeAgentError';
    this.status = status;
  }
}

export const PHOTO_HOST_PREFIX = 'https://premarketvideos.b-cdn.net/';
const MAX_NAME = 120;
const MAX_PHONE = 40;
const MAX_EMAIL = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const fullName = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || null;
const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

const toMillis = (t) => {
  if (!t) return null;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  const n = new Date(t).getTime();
  return Number.isNaN(n) ? null : n;
};

/** Which details are missing. "Ready" = photo, name, email and phone all present. */
export function profileCompleteness({ name, email, phone, photoUrl }) {
  const missing = [];
  if (!photoUrl) missing.push('photo');
  if (!name) missing.push('name');
  if (!email) missing.push('email');
  if (!phone) missing.push('phone');
  return { status: missing.length === 0 ? 'ready' : 'needs-details', missing };
}

/**
 * Pure merge. Identity precedence: officeAgents.linkedUid → users.uid → pending invite targetUid →
 * email (case-insensitive). A record is never merged on name alone (ambiguity is surfaced, not guessed).
 */
export function mergeDirectory({ users = [], invites = [], staged = [], profiles = [], teams = [], contacts = {} }) {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const rows = [];
  const byUid = new Map();
  const byEmail = new Map();

  const profByUid = new Map();
  const profByEmail = new Map();
  for (const p of profiles) {
    if (p.linkedUid) profByUid.set(p.linkedUid, p);
    if (p.emailKey) profByEmail.set(p.emailKey, p);
  }
  const usedProfiles = new Set();

  const teamLabel = (teamId, ownerName) => {
    const t = teamId ? teamById.get(teamId) : null;
    if (!t) return null;
    return { id: t.id, name: t.name || (ownerName ? `${ownerName}'s team` : 'Team') };
  };

  const push = (row) => {
    rows.push(row);
    if (row.uid) byUid.set(row.uid, row);
    if (row.email) byEmail.set(normalizeEmail(row.email), row);
  };

  const attachProfile = (row, base) => {
    const p = (row.uid && profByUid.get(row.uid)) || profByEmail.get(normalizeEmail(base.email)) || null;
    if (p) usedProfiles.add(p.id);
    const name = clean(p?.fullName) || base.name;
    const email = clean(p?.contactEmail) || base.email;
    const phone = clean(p?.phone) || base.phone;
    const photoUrl = clean(p?.photoUrl) || base.photoUrl;
    const comp = profileCompleteness({ name, email, phone, photoUrl });
    return {
      ...row,
      profileId: p?.id || null,
      name, email, phone, photoUrl,
      profileStatus: comp.status,
      missing: comp.missing,
    };
  };

  for (const u of users) {
    const owner = fullName(u);
    const loginStatus = u.accountStatus === 'invited' ? 'invited' : 'active';
    const base = { name: owner, email: clean(u.email), phone: clean(u.phone) || clean(contacts[u.uid]?.phone), photoUrl: clean(u.avatar) };
    push(attachProfile({
      key: null, uid: u.uid, loginStatus,
      team: teamLabel(u.teamId, null),
      isOfficeAdmin: !!u.isOfficeAdmin,
      invitedAt: toMillis(u.invitedAt), activatedAt: toMillis(u.activatedAt),
      canResend: loginStatus === 'invited',
    }, base));
  }

  for (const inv of invites) {
    if (inv.targetUid && byUid.has(inv.targetUid)) continue;
    const email = normalizeEmail(inv.targetEmail);
    if (email && byEmail.has(email)) continue;
    push(attachProfile({
      key: null, uid: inv.targetUid || null, loginStatus: 'invited', team: null,
      isOfficeAdmin: false, invitedAt: toMillis(inv.createdAt), activatedAt: null,
      canResend: !!inv.targetUid,
    }, { name: clean(inv.targetName), email: clean(inv.targetEmail), phone: null, photoUrl: null }));
  }

  for (const s of staged) {
    const email = normalizeEmail(s.email);
    if (email && byEmail.has(email)) continue;
    push(attachProfile({
      key: null, uid: null, loginStatus: 'not-activated', team: null,
      isOfficeAdmin: false, invitedAt: null, activatedAt: null, canResend: false,
      stagedStatus: s.status, error: s.error || null,
    }, { name: clean(s.name), email: clean(s.email), phone: null, photoUrl: null }));
  }

  // Office-created profiles for people with no user/invite/staged record (e.g. created by an admin).
  for (const p of profiles) {
    if (usedProfiles.has(p.id)) continue;
    const comp = profileCompleteness({ name: clean(p.fullName), email: clean(p.contactEmail), phone: clean(p.phone), photoUrl: clean(p.photoUrl) });
    push({
      key: null, uid: p.linkedUid || null, profileId: p.id, loginStatus: 'not-activated',
      team: null, isOfficeAdmin: false, invitedAt: null, activatedAt: null, canResend: false,
      name: clean(p.fullName), email: clean(p.contactEmail), phone: clean(p.phone), photoUrl: clean(p.photoUrl),
      profileStatus: comp.status, missing: comp.missing,
    });
  }

  // Stable client-facing key: profile id when one exists, else the uid, else the email.
  for (const r of rows) {
    r.key = r.profileId ? `p:${r.profileId}` : r.uid ? `u:${r.uid}` : `e:${normalizeEmail(r.email)}`;
  }
  rows.sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));
  return rows;
}

export function summariseDirectory(rows) {
  return {
    total: rows.length,
    missingPhoto: rows.filter((r) => !r.photoUrl).length,
    needsDetails: rows.filter((r) => r.profileStatus === 'needs-details').length,
    invited: rows.filter((r) => r.loginStatus === 'invited').length,
    notActivated: rows.filter((r) => r.loginStatus === 'not-activated').length,
    active: rows.filter((r) => r.loginStatus === 'active').length,
  };
}

const withId = (d) => ({ id: d.id, ...d.data() });

export async function buildOfficeAgentDirectory(officeId) {
  const [usersSnap, invitesSnap, profilesSnap, teamsSnap, staged] = await Promise.all([
    adminDb.collection('users').where('officeId', '==', officeId).get(),
    adminDb.collection('officeInvites').where('officeId', '==', officeId).where('status', '==', 'pending').get(),
    adminDb.collection('officeAgents').where('officeId', '==', officeId).get(),
    adminDb.collection('teams').where('officeId', '==', officeId).get(),
    listStagedAgents(officeId),
  ]);
  const users = usersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  // Invited agents' office-submitted phone is held server-side until they activate; the office admin
  // supplied it, so showing it to that same office admin is not a disclosure.
  const contactSnaps = await Promise.all(
    users.filter((u) => u.accountStatus === 'invited' && !u.phone)
      .map((u) => adminDb.collection('officeAgentContacts').doc(u.uid).get()),
  );
  const contacts = {};
  for (const c of contactSnaps) if (c.exists) contacts[c.id] = c.data();

  const rows = mergeDirectory({
    users,
    invites: invitesSnap.docs.map((d) => d.data()),
    staged,
    profiles: profilesSnap.docs.map(withId),
    teams: teamsSnap.docs.map(withId),
    contacts,
  });
  return { agents: rows, stats: summariseDirectory(rows) };
}

/** Validate + normalise the editable professional fields. Only keys that are present are returned. */
export function validateProfilePatch(input) {
  const out = {};
  if (input == null || typeof input !== 'object') throw new OfficeAgentError('Invalid request');
  if ('fullName' in input) {
    const v = String(input.fullName ?? '').trim();
    if (!v) throw new OfficeAgentError('Full name is required');
    if (v.length > MAX_NAME) throw new OfficeAgentError('Name is too long');
    out.fullName = v;
  }
  if ('phone' in input) {
    const v = String(input.phone ?? '').trim();
    if (v.length > MAX_PHONE || (v && !/^[0-9+()\-.\s]{6,}$/.test(v))) throw new OfficeAgentError('Enter a valid phone number');
    out.phone = v || null;
  }
  if ('contactEmail' in input) {
    const v = normalizeEmail(input.contactEmail);
    if (v && (v.length > MAX_EMAIL || !EMAIL_RE.test(v))) throw new OfficeAgentError('Enter a valid email address');
    out.contactEmail = v || null;
  }
  if ('photoUrl' in input) {
    const v = String(input.photoUrl ?? '').trim();
    if (!v.startsWith(PHOTO_HOST_PREFIX) || v.length > 500 || /[\s"'<>]/.test(v)) {
      throw new OfficeAgentError('Photo must be uploaded through the office photo uploader');
    }
    out.photoUrl = v;
  }
  if (Object.keys(out).length === 0) throw new OfficeAgentError('Nothing to update');
  return out;
}

/**
 * Resolve a directory key to a row INSIDE this office. Keys from another office or unknown keys → 404,
 * so an office admin can never address another office's agent.
 */
export async function resolveDirectoryRow(officeId, key) {
  const { agents } = await buildOfficeAgentDirectory(officeId);
  const row = agents.find((r) => r.key === String(key || ''));
  if (!row) throw new OfficeAgentError('Agent not found in this office', 404);
  return row;
}

/**
 * Update a professional profile. Creates the officeAgents record lazily (once — found by linkedUid or
 * emailKey inside a transaction so two requests can't create duplicates). Never touches Firebase Auth,
 * accountStatus, invitations, or any login field. The ONLY `users` write is mirroring `avatar` so the
 * photo appears in existing dashboards/profile views.
 */
export async function updateAgentProfile({ officeId, key, patch, actorUid }) {
  const clean_ = validateProfilePatch(patch);
  const row = await resolveDirectoryRow(officeId, key);
  const emailKey = normalizeEmail(row.email) || null;

  const result = await adminDb.runTransaction(async (tx) => {
    let profileRef = null;
    let existing = null;
    if (row.profileId) {
      profileRef = adminDb.collection('officeAgents').doc(row.profileId);
      const s = await tx.get(profileRef);
      if (s.exists && s.data().officeId === officeId) existing = s.data();
      else profileRef = null;
    }
    if (!profileRef && row.uid) {
      const q = await tx.get(adminDb.collection('officeAgents').where('officeId', '==', officeId).where('linkedUid', '==', row.uid));
      if (q.docs.length) { profileRef = q.docs[0].ref; existing = q.docs[0].data(); }
    }
    if (!profileRef && emailKey) {
      const q = await tx.get(adminDb.collection('officeAgents').where('officeId', '==', officeId).where('emailKey', '==', emailKey));
      if (q.docs.length) { profileRef = q.docs[0].ref; existing = q.docs[0].data(); }
    }

    const changed = Object.keys(clean_);
    const data = { ...clean_, updatedAt: FieldValue.serverTimestamp(), updatedBy: actorUid };
    if (clean_.contactEmail !== undefined) data.emailKey = normalizeEmail(clean_.contactEmail) || emailKey;
    let created = false;
    if (!profileRef) {
      created = true;
      profileRef = adminDb.collection('officeAgents').doc();
      // Seed from what is already known so a partial edit doesn't hide existing details.
      tx.set(profileRef, {
        officeId,
        linkedUid: row.uid || null,
        emailKey: data.emailKey || emailKey,
        fullName: row.name || null,
        contactEmail: row.email || null,
        phone: row.phone || null,
        photoUrl: row.photoUrl || null,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: actorUid,
        ...data,
      });
    } else {
      if (!existing.linkedUid && row.uid) data.linkedUid = row.uid;
      tx.update(profileRef, data);
    }
    tx.set(profileRef.collection('audit').doc(), {
      actorUid, at: FieldValue.serverTimestamp(), changed, created, officeId,
    });
    return { id: profileRef.id, created };
  });

  // Compatibility: show the photo wherever the existing app reads the login-linked avatar.
  if (clean_.photoUrl && row.uid) {
    const userRef = adminDb.collection('users').doc(row.uid);
    const u = await userRef.get();
    if (u.exists && u.data().officeId === officeId) {
      await userRef.update({ avatar: clean_.photoUrl });
    }
  }
  return { profileId: result.id, created: result.created };
}

/** Identify an image by its magic bytes (never trust the client-supplied type or filename). */
export function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  return null;
}
