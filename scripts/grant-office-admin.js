#!/usr/bin/env node
/**
 * Makes ONE existing, activated HPH member an HPH office administrator (HPH only: never a platform super-admin), or reverts it.
 * THIS IS A PRODUCTION WRITE when --execute is given. It has not been run. Dry run is the default.
 *
 *   node scripts/grant-office-admin.js --office-name "Harcourts Property Hub" --email person@hph.example             (dry run: prints the plan)
 *   node scripts/grant-office-admin.js --office-name "Harcourts Property Hub" --email person@hph.example --execute   (writes)
 *   add --revoke to take the same account OFF the administrator list again (never the last administrator).
 *
 * Exactly two fields change (the office's `officeAdminUids` gains the uid; that user's `isOfficeAdmin` becomes true) plus one audit record.
 * The existing administrator account is untouched. No Firebase Auth user is created or changed, no password is set, no email is sent.
 * It refuses: a Premarket address, a super-admin, an account not yet activated, a non-agent account, an ambiguous or missing match.
 * Credentials and the project guard are shared with scripts/activate-leadership.js (premarket-homes only).
 */
const { initFirebase } = require('./activate-leadership');
const { resolveOffice } = require('./reconcile-office-agents');
const { planGrant, applyGrant, applyRevoke } = require('./lib/officeAdminGrant');

function parseArgs(argv) {
  const out = { officeName: null, office: null, email: null, execute: false, revoke: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--office-name') out.officeName = argv[++i];
    else if (k === '--office') out.office = argv[++i];
    else if (k === '--email') out.email = String(argv[++i] || '').trim().toLowerCase();
    else if (k === '--execute') out.execute = true;
    else if (k === '--revoke') out.revoke = true;
    else throw new Error(`Unknown argument: ${k}`);
  }
  if (!out.email) throw new Error('--email is required');
  if (!out.office && !out.officeName) throw new Error('--office <id> or --office-name "<exact name>" is required');
  return out;
}

async function run({ db, FieldValue, args }) {
  const office = await resolveOffice(db, args);
  if (args.revoke) {
    if (!args.execute) return { mode: 'revoke-dry-run', office };
    return { mode: 'revoked', office, ...(await applyRevoke({ db, FieldValue, officeId: office.id, email: args.email })) };
  }
  const plan = await planGrant({ db, officeId: office.id, email: args.email });
  if (!args.execute) return { mode: 'dry-run', office, plan };
  return { mode: 'granted', office, ...(await applyGrant({ db, FieldValue, officeId: office.id, email: args.email })) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { initializeApp, applicationDefault, cert, getApps } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const { app } = initFirebase(process.env, { initializeApp, applicationDefault, cert, getApps });
  const r = await run({ db: getFirestore(app), FieldValue, args });
  console.log(`Office: ${r.office.name} (${r.office.id})  mode: ${r.mode}`);
  if (r.plan) {
    console.log(`Target: ${r.plan.target ? JSON.stringify(r.plan.target) : '(none)'} | administrators now: ${r.plan.adminCountBefore}`);
    console.log(r.plan.ok ? (r.plan.target.alreadyAdmin ? 'Already an administrator: nothing to do.' : 'OK to grant. Re-run with --execute to apply (2 fields + 1 audit record).') : 'NOT OK: ' + r.plan.reasons.join('; '));
  } else console.log(JSON.stringify(r));
  if (r.plan && !r.plan.ok) process.exit(2);
}

module.exports = { parseArgs, run };
if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
