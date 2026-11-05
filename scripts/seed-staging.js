#!/usr/bin/env node
/**
 * Seeds a STAGING Firebase project with a small FAKE office for testing the Office Workspace. Never touches the live
 * project (refuses by project id and by credential), reads no existing data, copies no HPH data.
 *
 *   node scripts/seed-staging.js --project <staging-project-id> --qa-email qa@yourdomain.com           (dry run: prints the plan)
 *   node scripts/seed-staging.js --project <staging-project-id> --qa-email qa@yourdomain.com --execute (writes)
 *
 * Credentials: FIREBASE_SERVICE_ACCOUNT (JSON for the STAGING project) in the environment. Passwords are generated and
 * printed once to this terminal; test mail all lands in one mailbox via plus-addressing (qa+tag@...).
 */
const crypto = require('crypto');
const { assertStagingTarget, buildSeedPlan } = require('./lib/stagingSeed');

function parseArgs(argv) {
  const out = { project: null, qaEmail: null, execute: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') out.project = argv[++i];
    else if (argv[i] === '--qa-email') out.qaEmail = argv[++i];
    else if (argv[i] === '--execute') out.execute = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let saProject = null;
  if (process.env.FIREBASE_SERVICE_ACCOUNT) { try { saProject = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT).project_id; } catch { throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON'); } }
  assertStagingTarget({ projectId: args.project, serviceAccountProjectId: saProject, env: process.env });
  const plan = buildSeedPlan({ qaEmail: args.qaEmail });

  console.log(`Target project: ${args.project} (staging)  |  ${args.execute ? 'EXECUTE' : 'DRY RUN'}`);
  console.log(`Office: ${plan.office.info.name} | users: ${plan.users.length} | teams: ${plan.teams.length} | properties: ${plan.properties.length} | offers: ${plan.offers.length}`);
  plan.users.forEach((u) => console.log(`  - ${u.uid}  ${u.email}  ${u.isOfficeAdmin ? '[office admin] ' : ''}${u.accountStatus}`));
  if (!args.execute) return console.log('\nDry run only. Add --execute to write.');
  if (!saProject) throw new Error('--execute needs FIREBASE_SERVICE_ACCOUNT for the staging project');

  const { initializeApp, cert } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const app = initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)), projectId: args.project });
  if (app.options.projectId === 'premarket-homes') throw new Error('Refusing: initialised for the live project');
  const auth = getAuth(app); const db = getFirestore(app);
  const now = new Date();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => (v === 'NOW' ? now : v));

  await db.collection('offices').doc(plan.office.id).set(plan.office.public);
  await db.collection('officeAdminInfo').doc(plan.office.id).set(fix(plan.office.info));
  for (const t of plan.teams) await db.collection('teams').doc(t.id).set({ ...t, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  for (const [k, v] of Object.entries(plan.settings)) await db.collection('settings').doc(k).set(fix(v));
  const creds = [];
  for (const u of plan.users) {
    const password = crypto.randomBytes(9).toString('base64url');
    try { await auth.createUser({ uid: u.uid, email: u.email, password, emailVerified: true }); creds.push(`${u.email}  ${password}`); }
    catch (err) { if (err.code !== 'auth/uid-already-exists' && err.code !== 'auth/email-already-exists') throw err; creds.push(`${u.email}  (already existed, password unchanged)`); }
    const { uid, ...doc } = u;
    await db.collection('users').doc(uid).set(doc, { merge: true });
  }
  for (const p of plan.properties) await db.collection('properties').doc(p.id).set({ ...p, createdAt: FieldValue.serverTimestamp(), stats: { views: 0 } });
  for (const o of plan.offers) await db.collection('offers').doc(o.id).set({ ...o, createdAt: FieldValue.serverTimestamp() });
  console.log('\nSeeded. Test logins (shown once):'); creds.forEach((c) => console.log('  ' + c));
}

module.exports = { parseArgs };
if (require.main === module) main().catch((err) => { console.error(err.message); process.exit(1); });
