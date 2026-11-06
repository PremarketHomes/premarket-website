#!/usr/bin/env node
/**
 * READ-ONLY check of ONE real managed campaign right after it is created (the supervised first campaign).
 * Nothing is written, nothing is sent, nothing is charged.
 *
 *   node scripts/verify-managed-campaign.js <propertyId>              production (same credential rules as the other scripts)
 *   node scripts/verify-managed-campaign.js <propertyId> --staging    the staging project in ~/.premarket-staging
 *
 * Checks: identities (selling agent = owner, managing BSO, creator), photos are reachable on the CDN, what the buyer page
 * presents (the owner's office profile, never the manager), the campaign-link email (sent once, to the owner), and billing
 * (exactly one pending charge on the office entity at the configured price).
 */
const os = require('os');
const path = require('path');

async function main() {
  const [propertyId, flag] = process.argv.slice(2);
  if (!propertyId) throw new Error('Usage: node scripts/verify-managed-campaign.js <propertyId> [--staging]');
  const { initializeApp, applicationDefault, cert, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  let app;
  if (flag === '--staging') {
    const sa = require(path.join(os.homedir(), '.premarket-staging/staging-sa.json'));
    if (sa.project_id === 'premarket-homes') throw new Error('not a staging credential');
    app = initializeApp({ credential: cert(sa), projectId: sa.project_id });
  } else {
    ({ app } = require('./activate-leadership').initFirebase(process.env, { initializeApp, applicationDefault, cert, getApps }));
  }
  const db = getFirestore(app);
  const results = [];
  const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`); };
  const name = (u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim() || '?';

  const p = (await db.collection('properties').doc(propertyId).get()).data();
  if (!p) throw new Error('campaign not found');
  const [owner, manager, creator] = await Promise.all([p.userId, p.managedByUid, p.createdByUid].map(async (uid) => (uid ? (await db.collection('users').doc(uid).get()).data() : null)));
  const office = owner?.officeId ? (await db.collection('officeAdminInfo').doc(owner.officeId).get()).data() : null;
  console.log(`Campaign ${propertyId}: "${p.formattedAddress || p.address}"`);
  console.log(`  selling agent ${name(owner)} | managed by ${name(manager)} | created by ${name(creator)} (${p.createdByRole})`);

  check('selling agent owns it; no listing-agent override', !!owner && p.agentId == null, `userId ${String(p.userId).slice(0, 6)}…`);
  check('manager is a current BSO or office admin of the selling agent\'s office', !!office && ((office.bsoUids || []).includes(p.managedByUid) || (office.officeAdminUids || []).includes(p.managedByUid)));
  check('creator recorded and accepted the terms', !!p.createdByUid && p.termsAcceptedBy === p.createdByUid && !!p.termsAcceptedAt);
  check('legacy "vendorUploaded" flag off (no old-style duplicate email)', p.vendorUploaded === false);

  const urls = Array.isArray(p.imageUrls) ? p.imageUrls : [];
  const heads = await Promise.all(urls.map(async (u) => { try { return (await fetch(u, { method: 'HEAD' })).status; } catch { return 0; } }));
  check('photos uploaded and reachable on the CDN', urls.length > 0 && heads.every((s) => s === 200), `${urls.length} photo(s): ${heads.join(',') || 'none'}`);

  const profs = owner?.officeId ? (await db.collection('officeAgents').where('officeId', '==', owner.officeId).where('linkedUid', '==', p.userId).get()).docs.map((d) => d.data()) : [];
  const prof = profs.length === 1 ? profs[0] : null;
  const shown = { name: (prof?.fullName || '').trim() || name(owner), photo: !!((prof?.photoUrl || '').trim() || (owner?.avatar && !/Profile_avatar_placeholder/.test(owner.avatar))), phone: !!((prof?.phone || '').trim() || owner?.phone) };
  check('buyer page presents the selling agent (office profile), not the manager', shown.name !== name(manager) || p.userId === p.managedByUid, `name "${shown.name}", photo ${shown.photo ? 'yes' : 'no'}, phone ${shown.phone ? 'yes' : 'no'}`);

  const logs = (await db.collection('emailLog').where('propertyId', '==', propertyId).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const link = logs.filter((l) => l.type === 'campaign_link');
  check('campaign-link email sent once, to the selling agent', link.filter((l) => l.seq === 1).length === 1 && link.every((l) => l.recipientUid === p.userId) && link.some((l) => l.seq === 1 && l.status === 'sent'),
    link.map((l) => `seq ${l.seq}: ${l.status}${l.reason ? ` (${l.reason})` : ''}`).join('; ') || 'no emailLog entry');

  const charges = await db.collection('propertyCharges').doc(propertyId).get();
  const inv = (await db.collection('settings').doc('invoicing').get()).data() || {};
  const c = charges.exists ? charges.data() : null;
  check('exactly one pending charge, on the office entity, at the configured price', !!c && c.billingEntityKey === `office:${owner?.officeId}` && c.status === 'pending' && Number(c.pricePerListing) === Number(inv.pricePerListing),
    c ? `${c.billingEntityKey} ${c.status} $${c.pricePerListing}` : 'no charge');

  console.log(results.every(Boolean) ? '\nALL CHECKS PASSED' : '\nSOME CHECKS FAILED (see above)');
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
