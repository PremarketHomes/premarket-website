#!/usr/bin/env node
/**
 * Moves ONE older campaign that a BSO uploaded under their OWN account for another agent (e.g. 73 Riverwalk Ave: owner Peta,
 * selling agent Chantal picked from Peta's personal agent list) onto the BSO model:
 *
 *   userId (owner)  : BSO            -> selling agent
 *   managedByUid    : (none)         -> BSO
 *   createdByUid    : (none)         -> BSO          createdByRole: (none) -> 'bso'
 *   agentId / agentName / agentAvatar: roster entry -> null   (the public page then presents the owner = the selling agent)
 *
 * Nothing else changes: same property id and buyer link, same photos, offers, likes, reports and billing charge (the charge
 * stays on the office billing entity it is already on). One record per run.
 *
 *   node scripts/migrate-legacy-bso-campaign.js --property <id> --selling-agent <uid> --manager <uid>             (dry run: read-only)
 *   ... --execute --confirm <id>                                    (writes; saves a rollback file FIRST, then one transaction)
 *   node scripts/migrate-legacy-bso-campaign.js --rollback <backup.json> [--execute --confirm <id>]   (restores the saved values)
 *
 * Credentials: the same as the other production scripts (scripts/activate-leadership.js initFirebase: refuses any project
 * other than premarket-homes). The dry run uses a read-only wrapper: any write throws.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const norm = (n) => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();
const displayName = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim();
const isAgent = (u) => !!(u?.agent || u?.isAgent || u?.roles?.includes?.('agent'));
const usable = (u) => !!u && (!u.accountStatus || ['active', 'invited'].includes(u.accountStatus)) && u.disabled !== true && u.deactivated !== true;
const FIELDS = ['userId', 'agentId', 'agentName', 'agentAvatar', 'managedByUid', 'createdByUid', 'createdByRole'];

/**
 * Pure: decides whether the migration is safe and what it writes. `snap` holds plain data already read from Firestore/Auth.
 * Every check marked blocking must pass before --execute is allowed.
 */
function planMigration(snap) {
  const { propertyId, property, sellerUid, managerUid, seller, sellerAuth, manager, office, officeUsers = [], charge } = snap;
  const checks = [];
  const add = (name, ok, detail = '', blocking = true) => checks.push({ name, ok: !!ok, detail: String(detail), blocking });

  add('campaign exists', !!property, propertyId);
  if (!property) return { checks, ok: false };
  add('campaign is currently owned by the BSO (the uploader)', property.userId === managerUid, `userId=${property.userId}`);
  add('campaign has not been migrated or created through the office already', !property.managedByUid && property.managedCreation !== true && !property.createdByUid,
    `managedByUid=${property.managedByUid || '-'} managedCreation=${property.managedCreation === true} createdByUid=${property.createdByUid || '-'}`);
  add('office is active', office?.status === 'active', office ? `${office.name} (${office.status})` : 'missing');
  add('BSO belongs to that office', manager?.officeId && manager.officeId === office?.id, `officeId=${manager?.officeId || '-'}`);
  // Same rule the public buyer page uses today (publicProfileService.getAssignedAgentProfile): the roster name must equal the
  // name of exactly ONE agent in the owner's office. That person must be the selling agent named on the command line.
  const matches = officeUsers.filter((u) => isAgent(u.data) && norm(displayName(u.data)) === norm(property.agentName));
  add('selling agent on the listing is a roster entry', !!property.agentId && !!norm(property.agentName), `agentName="${property.agentName || ''}"`);
  add('roster name resolves to exactly one office agent, and it is the selling agent given', matches.length === 1 && matches[0].uid === sellerUid,
    `${matches.length} match(es)${matches.length ? `: ${matches.map((m) => m.uid.slice(0, 6) + '…').join(', ')}` : ''}`);
  add('selling agent is an agent in the same office with a usable account', !!seller && isAgent(seller) && seller.officeId === office?.id && usable(seller),
    seller ? `status=${seller.accountStatus || 'active'} officeId=${seller.officeId}` : 'no users document');
  add('selling agent has a Firebase Auth account that is not disabled', !!sellerAuth && !sellerAuth.disabled,
    sellerAuth ? `emailVerified=${!!sellerAuth.emailVerified} hasSignedIn=${!!sellerAuth.lastSignInTime}`
      : snap.sellerAuthError ? `could not verify (${snap.sellerAuthError}); set GOOGLE_CLOUD_QUOTA_PROJECT=premarket-homes for user credentials` : 'no Auth account');
  // Buyer page: the agent's personal details come from the same office profile before and after. Only the owner's agency
  // identity (company name, office branding) switches from the BSO's account to the selling agent's, so both must match.
  const sp = snap.sellerPublic; const mp = snap.managerPublic;
  if (sp && mp) {
    const placeholder = (a) => !a || /Profile_avatar_placeholder/.test(a);
    add('buyer page keeps the same agency identity (office, company name, branding)', sp.officeId === mp.officeId && sp.companyName === mp.companyName && sp.brandColors === mp.brandColors && sp.logoUrl === mp.logoUrl,
      `office ${sp.officeId === mp.officeId ? 'same' : 'DIFFERS'}; company ${sp.companyName === mp.companyName ? 'same' : `"${mp.companyName}" -> "${sp.companyName}"`}; brand colours ${sp.brandColors === mp.brandColors ? 'same' : 'differ'}; logo ${sp.logoUrl === mp.logoUrl ? 'same' : 'differs'}`, false);
    add('buyer page shows the selling agent\'s own name, photo and phone after the move', !!sp.name,
      `name "${sp.name}"; photo ${placeholder(sp.avatar) ? (sp.avatar ? 'placeholder image (shown as the default picture once the agent owns it)' : 'none') : 'real photo'}; phone ${sp.phone ? 'yes' : 'no'}`, false);
  }
  add('BSO currently holds the BSO role in the office (otherwise the migration would remove their access)', Array.isArray(office?.bsoUids) && office.bsoUids.includes(managerUid),
    `bsoUids has BSO: ${Array.isArray(office?.bsoUids) && office.bsoUids.includes(managerUid)}`);
  add('billing charge stays on the office entity (unchanged by this migration)', !charge || charge.billingEntityKey === `office:${office?.id}`,
    charge ? `entity=${charge.billingEntityKey} status=${charge.status} agentUserId=${String(charge.agentUserId || '').slice(0, 6)}…` : 'no charge yet (the sweep attributes it to the owner\'s office, the same office)', false);

  const before = Object.fromEntries(FIELDS.map((f) => [f, property[f] === undefined ? null : property[f]]));
  const after = { userId: sellerUid, agentId: null, agentName: null, agentAvatar: null, managedByUid: managerUid, createdByUid: managerUid, createdByRole: 'bso' };
  return { checks, ok: checks.every((c) => !c.blocking || c.ok), before, after };
}

/** Pure: the write that restores `before` (fields that did not exist before are deleted). */
function rollbackPatch(before, deleteSentinel) {
  return Object.fromEntries(FIELDS.map((f) => [f, before[f] === null && ['managedByUid', 'createdByUid', 'createdByRole'].includes(f) ? deleteSentinel : before[f]]));
}

function parseArgs(argv) {
  const out = { execute: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--property') out.property = argv[++i];
    else if (k === '--selling-agent') out.seller = argv[++i];
    else if (k === '--manager') out.manager = argv[++i];
    else if (k === '--rollback') out.rollback = argv[++i];
    else if (k === '--confirm') out.confirm = argv[++i];
    else if (k === '--backup-dir') out.backupDir = argv[++i];
    else if (k === '--execute') out.execute = true;
    else throw new Error(`Unknown argument: ${k}`);
  }
  return out;
}

const WRITE_METHODS = ['set', 'update', 'delete', 'add', 'create', 'batch', 'bulkWriter', 'runTransaction', 'recursiveDelete'];
function readOnly(target, label = 'db') {
  return new Proxy(target, {
    get(obj, prop) {
      if (WRITE_METHODS.includes(String(prop))) throw new Error(`read-only dry run: ${label}.${String(prop)}() is not allowed`);
      const v = obj[prop];
      if (typeof v !== 'function') return v;
      return (...a) => { const r = v.apply(obj, a); return r && typeof r === 'object' && typeof r.then !== 'function' ? readOnly(r, label) : r; };
    },
  });
}

async function readSnapshot(db, auth, { property: propertyId, seller: sellerUid, manager: managerUid }) {
  const [p, s, m] = await Promise.all([db.collection('properties').doc(propertyId).get(), db.collection('users').doc(sellerUid).get(), db.collection('users').doc(managerUid).get()]);
  const property = p.exists ? p.data() : null;
  const manager = m.exists ? m.data() : null;
  const officeId = manager?.officeId || null;
  const [o, usersSnap, charge, draft, offers, likes, emailLogs, sellerOwned] = await Promise.all([
    officeId ? db.collection('officeAdminInfo').doc(officeId).get() : null,
    officeId ? db.collection('users').where('officeId', '==', officeId).get() : { docs: [] },
    db.collection('propertyCharges').doc(propertyId).get(),
    db.collection('draftProperties').doc(propertyId).get(),
    db.collection('offers').where('propertyId', '==', propertyId).get(),
    db.collection('likes').where('propertyId', '==', propertyId).get(),
    Promise.all([db.collection('emailLog').where('propertyId', '==', propertyId).get(), db.collection('emailLog').doc(`interest_notify__${propertyId}`).get()])
      .then(([q, interest]) => ({ docs: [...q.docs, ...(interest.exists ? [interest] : [])] })),
    db.collection('properties').where('userId', '==', sellerUid).get(),
  ]);
  let sellerAuth = null;
  let sellerAuthError = null;
  try { const u = await auth.getUser(sellerUid); sellerAuth = { disabled: u.disabled, emailVerified: u.emailVerified, lastSignInTime: u.metadata?.lastSignInTime || null }; } catch (e) {
    if (e?.code !== 'auth/user-not-found') sellerAuthError = e?.code || 'unknown error';
  }
  // What the buyer page shows, before (roster entry resolved to the office profile) and after (the owner's profile).
  const profileOf = async (uid) => {
    const u = (await db.collection('users').doc(uid).get()).data() || {};
    const profs = (await db.collection('officeAgents').where('officeId', '==', u.officeId || '-').where('linkedUid', '==', uid).get()).docs.map((d) => d.data());
    const prof = profs.length === 1 ? profs[0] : null;
    const name = (prof?.fullName || '').trim() || `${u.firstName || ''} ${u.lastName || ''}`.trim();
    const avatar = (prof?.photoUrl || '').trim() || u.avatar || null;
    return { name, avatar, phone: !!((prof?.phone || '').trim() || u.phone), companyName: u.companyName || null, officeId: u.officeId || null, brandColors: !!u.brandColors, logoUrl: !!u.logoUrl };
  };
  const [sellerPublic, managerPublic] = await Promise.all([profileOf(sellerUid), profileOf(managerUid)]);
  return {
    propertyId, property, sellerUid, managerUid, seller: s.exists ? s.data() : null, sellerAuth, sellerAuthError, manager, sellerPublic, managerPublic,
    office: o?.exists ? { id: officeId, ...o.data() } : null,
    officeUsers: usersSnap.docs.map((d) => ({ uid: d.id, data: d.data() })),
    charge: charge.exists ? charge.data() : null,
    // Dependencies, reported only (counts and ids; no buyer details are printed)
    deps: {
      draft: draft.exists ? { userId: draft.data().userId, agentId: draft.data().agentId || null } : null,
      offers: offers.size, registrations: offers.docs.filter((d) => d.data().serious === true).length, likes: likes.size,
      emailLog: emailLogs.docs.map((d) => `${d.id} (${d.data().status || '-'})`),
      sellerOtherCampaigns: sellerOwned.docs.filter((d) => d.id !== propertyId).length,
    },
  };
}

function printPlan(snap, plan) {
  const mask = (u) => (u ? `${String(u).slice(0, 6)}…` : '-');
  console.log(`\nCampaign ${snap.propertyId}: "${snap.property?.formattedAddress || snap.property?.address || '?'}"`);
  console.log(`  selling agent ${displayName(snap.seller) || '?'} (${mask(snap.sellerUid)})   BSO ${displayName(snap.manager) || '?'} (${mask(snap.managerUid)})`);
  for (const c of plan.checks) console.log(`  ${c.ok ? 'PASS' : c.blocking ? 'FAIL' : 'NOTE'}  ${c.name}  [${c.detail}]`);
  if (snap.deps) {
    console.log('  Dependencies (unchanged by this migration unless stated):');
    console.log(`    draftProperties copy: ${snap.deps.draft ? `yes (userId ${mask(snap.deps.draft.userId)}; updated with the same fields)` : 'none'}`);
    console.log(`    offers: ${snap.deps.offers} (registrations: ${snap.deps.registrations}); likes: ${snap.deps.likes}  — kept, keyed by property id`);
    console.log(`    emailLog entries for this campaign: ${snap.deps.emailLog.length ? snap.deps.emailLog.join(', ') : 'none'}`);
    console.log(`    other campaigns the selling agent owns: ${snap.deps.sellerOtherCampaigns}`);
    console.log(`    registration emails: today to the owner (${mask(snap.property?.userId)}); after migration to the selling agent (${mask(snap.sellerUid)})`);
  }
  if (plan.before) {
    console.log('  Write (properties and draftProperties):');
    for (const f of FIELDS) console.log(`    ${f.padEnd(13)} ${JSON.stringify(plan.before[f])} -> ${JSON.stringify(plan.after[f])}`);
  }
  console.log(plan.ok ? '\nREADY: every blocking check passes.' : '\nNOT READY: fix the FAIL lines first. Nothing was written.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { initializeApp, applicationDefault, cert, getApps } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const { getAuth } = require('firebase-admin/auth');
  const { initFirebase } = require('./activate-leadership');
  const { app } = initFirebase(process.env, { initializeApp, applicationDefault, cert, getApps });
  const rawDb = getFirestore(app);
  const auth = getAuth(app);
  const writing = args.execute === true;
  const db = writing ? rawDb : readOnly(rawDb);
  const backupDir = args.backupDir || path.join(os.homedir(), '.premarket-migrations');

  if (args.rollback) {
    const backup = JSON.parse(fs.readFileSync(args.rollback, 'utf8'));
    const ref = db.collection('properties').doc(backup.propertyId);
    const cur = (await ref.get()).data() || {};
    const still = Object.entries(backup.after).every(([k, v]) => (cur[k] === undefined ? null : cur[k]) === v);
    console.log(`Rollback of ${backup.propertyId}: current record ${still ? 'matches' : 'DOES NOT match'} the migrated values.`);
    for (const f of FIELDS) console.log(`  ${f.padEnd(13)} ${JSON.stringify(cur[f] === undefined ? null : cur[f])} -> ${JSON.stringify(backup.before[f])}`);
    if (!still) throw new Error('The record changed after the migration; restore it by hand after review.');
    if (!writing) return console.log('\nDry run only. Add --execute --confirm <propertyId> to restore.');
    if (args.confirm !== backup.propertyId) throw new Error('--confirm must repeat the property id');
    const patch = rollbackPatch(backup.before, FieldValue.delete());
    await rawDb.runTransaction(async (tx) => {
      tx.update(ref, patch);
      if (backup.draftExisted) tx.set(rawDb.collection('draftProperties').doc(backup.propertyId), patch, { merge: true });
      tx.set(rawDb.collection('officeCampaignAudit').doc(), { action: 'campaign.migrateToBso.rollback', propertyId: backup.propertyId, before: backup.after, after: backup.before, actor: 'scripts/migrate-legacy-bso-campaign.js', at: FieldValue.serverTimestamp() });
    });
    return console.log('Restored.');
  }

  if (!args.property || !args.seller || !args.manager) throw new Error('Usage: --property <id> --selling-agent <uid> --manager <uid> [--execute --confirm <id>]');
  const snap = await readSnapshot(db, auth, args);
  const plan = planMigration(snap);
  printPlan(snap, plan);
  if (!writing) return console.log('Dry run only (read-only). Nothing was written.');
  if (!plan.ok) throw new Error('Refusing to write: blocking checks failed.');
  if (args.confirm !== args.property) throw new Error('--confirm must repeat the property id');

  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const file = path.join(backupDir, `migrate-${args.property}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ propertyId: args.property, before: plan.before, after: plan.after, draftExisted: !!snap.deps.draft, savedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  console.log(`Rollback file saved: ${file}`);
  const ref = rawDb.collection('properties').doc(args.property);
  await rawDb.runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data();
    if (!cur || cur.userId !== plan.before.userId || (cur.agentId || null) !== plan.before.agentId || cur.managedByUid) throw new Error('The record changed since the dry run; nothing written.');
    tx.update(ref, plan.after);
    if (snap.deps.draft) tx.set(rawDb.collection('draftProperties').doc(args.property), plan.after, { merge: true });
    tx.set(rawDb.collection('officeCampaignAudit').doc(), { action: 'campaign.migrateToBso', propertyId: args.property, ownerUid: plan.after.userId, actorUid: null, actorRole: 'script', officeId: snap.office.id, before: plan.before, after: plan.after, actor: 'scripts/migrate-legacy-bso-campaign.js', at: FieldValue.serverTimestamp() });
  });
  console.log('Migrated. To undo: node scripts/migrate-legacy-bso-campaign.js --rollback ' + file);
}

if (require.main === module) main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });

module.exports = { planMigration, rollbackPatch, parseArgs, readOnly, FIELDS };
