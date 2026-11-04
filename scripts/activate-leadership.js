#!/usr/bin/env node
/**
 * Grants Leadership Hub access to existing accounts by adding their uids to
 * `officeAdminInfo/{officeId}.leadershipUids`. THIS IS A PRODUCTION WRITE — it has not been run.
 *
 *   node scripts/activate-leadership.js --office <officeId> --email a@x.com --email b@y.com            (dry run)
 *   node scripts/activate-leadership.js --office <officeId> --email a@x.com --email b@y.com --execute (writes)
 *   add --remove to take the same accounts OFF leadershipUids instead.
 *
 * It touches exactly one field on one document. It never creates or edits accounts, passwords, users
 * documents, officeAdminUids, billing or invitations. Each email must already be a Firebase Auth
 * account; an account that already belongs to a DIFFERENT office is refused.
 * Needs Admin credentials (GOOGLE_APPLICATION_CREDENTIALS) for the production Firebase project.
 */
const { initializeApp, applicationDefault, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

function parseArgs(argv) {
  const out = { emails: [], execute: false, remove: false, office: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--office') out.office = argv[++i];
    else if (argv[i] === '--email') out.emails.push(String(argv[++i]).trim().toLowerCase());
    else if (argv[i] === '--execute') out.execute = true;
    else if (argv[i] === '--remove') out.remove = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return out;
}

async function main() {
  const { office, emails, execute, remove } = parseArgs(process.argv.slice(2));
  if (!office || emails.length === 0) throw new Error('Usage: --office <officeId> --email <address> [--email ...] [--execute] [--remove]');

  if (!getApps().length) initializeApp({ credential: applicationDefault() });
  const db = getFirestore();
  const infoRef = db.collection('officeAdminInfo').doc(office);
  const info = await infoRef.get();
  if (!info.exists) throw new Error(`No office ${office}`);
  if (info.data().status !== 'active') throw new Error(`Office ${office} is not active`);

  console.log(`Office: ${info.data().name} (${office})`);
  console.log(`Current leadershipUids: ${JSON.stringify(info.data().leadershipUids || [])}`);

  const uids = [];
  for (const email of emails) {
    const rec = await getAuth().getUserByEmail(email); // throws if the account doesn't exist — we never create one
    const userDoc = await db.collection('users').doc(rec.uid).get();
    const linked = userDoc.exists ? userDoc.data().officeId : null;
    if (linked && linked !== office) throw new Error(`${email} belongs to a different office (${linked}); refusing`);
    if (rec.disabled) throw new Error(`${email} is disabled; refusing`);
    console.log(`  ${email} -> uid ${rec.uid}${linked === office ? ' (office member)' : ' (not an office member — only the Hub is granted)'}`);
    uids.push(rec.uid);
  }

  const op = remove ? 'REMOVE from' : 'ADD to';
  if (!execute) {
    console.log(`\nDRY RUN — would ${op} leadershipUids: ${JSON.stringify(uids)}. Re-run with --execute to write.`);
    return;
  }
  await infoRef.update({
    leadershipUids: remove ? FieldValue.arrayRemove(...uids) : FieldValue.arrayUnion(...uids),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`\nDone: ${remove ? 'removed' : 'added'} ${uids.length} uid(s).`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
