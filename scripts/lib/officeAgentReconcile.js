/**
 * Pure classification for the officeAgents reconciliation DRY RUN. No Firebase imports and no writes:
 * it only looks at already-loaded records and reports what a future migration WOULD have to deal with.
 *
 * Categories (per office user / invitation / staged agent):
 *   exact          — an officeAgents profile already links to this uid (nothing to do)
 *   missing        — no profile exists; a migration would create one, seeded from existing data
 *   ambiguous      — cannot be matched safely; flagged for human review, never guessed
 *   duplicates     — separate records that look like the same person (same email, or same name)
 * Matching is by uid or exact normalised email ONLY — never by name alone.
 */
const norm = (e) => String(e || '').trim().toLowerCase();
const nameOf = (u) => `${u.firstName || ''} ${u.lastName || ''}`.trim().toLowerCase();

function reconcile({ officeId, users = [], invites = [], staged = [], profiles = [], listingAgents = [] }) {
  const report = { officeId, counts: {}, exact: [], missing: [], ambiguous: [], duplicates: [], notes: [] };
  const profByUid = new Map();
  const profByEmail = new Map();
  for (const p of profiles) {
    if (p.linkedUid) profByUid.set(p.linkedUid, [...(profByUid.get(p.linkedUid) || []), p]);
    if (p.emailKey) profByEmail.set(p.emailKey, [...(profByEmail.get(p.emailKey) || []), p]);
  }

  const people = [
    ...users.map((u) => ({ source: 'user', uid: u.uid, email: norm(u.email), name: nameOf(u), hasPhoto: !!u.avatar, loginStatus: u.accountStatus === 'invited' ? 'invited' : 'active' })),
    ...invites.map((i) => ({ source: 'invite', uid: i.targetUid || null, email: norm(i.targetEmail), name: String(i.targetName || '').trim().toLowerCase(), hasPhoto: false, loginStatus: 'invited' })),
    ...staged.map((s) => ({ source: 'staged', uid: null, email: norm(s.email), name: String(s.name || '').trim().toLowerCase(), hasPhoto: false, loginStatus: 'not-activated' })),
  ];

  // Same person appearing in more than one source with the same uid/email is ONE person, not a duplicate.
  const seen = new Map();
  const unique = [];
  for (const p of people) {
    const k = p.uid ? `u:${p.uid}` : `e:${p.email}`;
    const emailHit = p.email && seen.get(`e:${p.email}`);
    const uidHit = p.uid && seen.get(`u:${p.uid}`);
    const hit = uidHit || emailHit;
    if (hit) {
      if (p.uid && hit.uid && p.uid !== hit.uid) {
        report.duplicates.push({ reason: 'same email, different accounts', email: p.email, uids: [hit.uid, p.uid] });
      }
      continue;
    }
    seen.set(k, p);
    if (p.email) seen.set(`e:${p.email}`, p);
    unique.push(p);
  }

  const usedProfiles = new Set();
  for (const p of unique) {
    const byUid = p.uid ? profByUid.get(p.uid) || [] : [];
    const byEmail = p.email ? profByEmail.get(p.email) || [] : [];
    const row = { uid: p.uid, email: p.email || null, name: p.name || null, source: p.source, loginStatus: p.loginStatus };
    byUid.forEach((x) => usedProfiles.add(x.id));
    byEmail.forEach((x) => usedProfiles.add(x.id));

    if (byUid.length > 1 || (byUid.length === 0 && byEmail.length > 1)) {
      report.ambiguous.push({ ...row, reason: 'more than one profile matches', profileIds: [...byUid, ...byEmail].map((x) => x.id) });
    } else if (byUid.length === 1) {
      const conflict = byEmail.find((x) => x.id !== byUid[0].id);
      if (conflict) report.ambiguous.push({ ...row, reason: 'uid matches one profile but email matches a different profile', profileIds: [byUid[0].id, conflict.id] });
      else report.exact.push({ ...row, profileId: byUid[0].id });
    } else if (byEmail.length === 1) {
      const prof = byEmail[0];
      if (prof.linkedUid && p.uid && prof.linkedUid !== p.uid) {
        report.ambiguous.push({ ...row, reason: 'email matches a profile linked to a different account', profileIds: [prof.id] });
      } else report.exact.push({ ...row, profileId: prof.id, note: 'matched by email; would link uid' });
    } else {
      report.missing.push({ ...row, wouldSeed: { photo: p.hasPhoto, email: !!p.email, name: !!p.name } });
    }
  }

  for (const prof of profiles) {
    if (!usedProfiles.has(prof.id)) report.notes.push({ profileId: prof.id, note: 'officeAgents profile with no matching user/invite/staged record (office-created)' });
  }

  // Same display name across different identities: possible duplicate, never merged automatically.
  const byName = new Map();
  for (const p of unique) if (p.name) byName.set(p.name, [...(byName.get(p.name) || []), p]);
  for (const [name, list] of byName) {
    if (list.length > 1) report.duplicates.push({ reason: 'same name, different identities (review manually)', name, emails: list.map((x) => x.email), uids: list.map((x) => x.uid) });
  }

  // Listing-agent profiles (`agents`) are NOT migrated or merged; counted for context only.
  const listingByUser = new Map();
  for (const a of listingAgents) listingByUser.set(a.userId, (listingByUser.get(a.userId) || 0) + 1);
  report.notes.push({ note: `${listingAgents.length} listing-agent profile(s) in the existing "agents" collection across ${listingByUser.size} office user(s); left untouched` });

  report.counts = {
    people: unique.length,
    exact: report.exact.length,
    missing: report.missing.length,
    ambiguous: report.ambiguous.length,
    duplicates: report.duplicates.length,
  };
  return report;
}

/* ───────────── output minimisation + read-only guarantees ───────────── */

/** j***@domain.com — enough to recognise a record, not enough to contact anyone. */
function maskEmail(e) {
  const v = String(e || '');
  const at = v.indexOf('@');
  if (at < 1) return v ? '***' : null;
  return `${v[0]}***${v.slice(at)}`;
}
/** "Jo Smith" -> "J. S." */
const maskName = (n) => (n ? String(n).split(/\s+/).filter(Boolean).map((w) => `${w[0].toUpperCase()}.`).join(' ') : null);

/**
 * What may be printed: opaque ids, masked emails, login status, category and reason. No names, no phone
 * numbers, no photo URLs, no buyer data (buyers are never read at all).
 */
function redactReport(report) {
  const row = (r) => ({
    uid: r.uid || null, email: maskEmail(r.email), source: r.source, loginStatus: r.loginStatus,
    ...(r.reason ? { reason: r.reason } : {}), ...(r.profileId ? { profileId: r.profileId } : {}), ...(r.profileIds ? { profileIds: r.profileIds } : {}),
    ...(r.note ? { note: r.note } : {}), ...(r.wouldSeed ? { wouldSeed: r.wouldSeed } : {}),
  });
  return {
    officeId: report.officeId,
    counts: report.counts,
    exact: report.exact.map(row),
    missing: report.missing.map(row),
    ambiguous: report.ambiguous.map(row),
    duplicates: report.duplicates.map((d) => ({
      reason: d.reason,
      ...(d.email ? { email: maskEmail(d.email) } : {}),
      ...(d.name ? { name: maskName(d.name) } : {}),
      ...(d.emails ? { emails: d.emails.map(maskEmail) } : {}),
      ...(d.uids ? { uids: d.uids } : {}),
    })),
    notes: report.notes,
  };
}

const READ_COLLECTIONS = ['users', 'officeInvites', 'officeAgents', 'officeImports', 'agents', 'officeAdminInfo'];
const WRITE_METHODS = ['set', 'update', 'delete', 'add', 'create', 'batch', 'bulkWriter', 'runTransaction', 'recursiveDelete', 'listCollections'];

/**
 * Wraps a Firestore handle so ONLY reads of an allowlist of collections are possible. Any write-like method,
 * or any other collection, throws — so this script cannot write even if the code were later edited carelessly.
 */
function readOnlyDb(db) {
  const guard = (target, label) => new Proxy(target, {
    get(obj, prop) {
      if (WRITE_METHODS.includes(String(prop))) throw new Error(`read-only script: ${label}.${String(prop)}() is not allowed`);
      const v = obj[prop];
      if (typeof v !== 'function') return v;
      return (...args) => {
        const out = v.apply(obj, args);
        return out && typeof out === 'object' && typeof out.then !== 'function' ? guard(out, label) : out;
      };
    },
  });
  return {
    collection(name) {
      if (!READ_COLLECTIONS.includes(name)) throw new Error(`read-only script: collection "${name}" is outside the allowlist`);
      return guard(db.collection(name), name);
    },
  };
}

module.exports = { reconcile, redactReport, maskEmail, maskName, readOnlyDb, READ_COLLECTIONS };
