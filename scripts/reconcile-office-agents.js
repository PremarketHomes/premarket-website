#!/usr/bin/env node
/**
 * READ-ONLY dry run: compares one office's existing users, pending invitations, staged imports and any
 * `officeAgents` profiles, and reports exact matches, missing profiles, ambiguous records and potential
 * duplicates. There is NO write mode: no --execute flag, and the Firestore handle is wrapped so any write
 * method throws (see readOnlyDb). It sends no email or notification (it imports no service code), reads no
 * buyer, offer, property or billing data, and prints only opaque ids, MASKED emails, login status and the
 * reconciliation category (no names, phone numbers or photo URLs).
 *
 *   node scripts/reconcile-office-agents.js --office <officeId>
 *   node scripts/reconcile-office-agents.js --office-name "Exact Office Name"   (must match exactly ONE active office)
 *   default output is a SUMMARY (counts, login-status breakdown, and rows only for ambiguous/duplicate cases);
 *   add --list to print every row, --json for machine-readable output (same masked fields).
 *
 * Credentials and the project guard are shared with scripts/activate-leadership.js: premarket-homes only,
 * via FIREBASE_SERVICE_ACCOUNT / FIREBASE_* env or Google Application Default Credentials. If anything about
 * the target is ambiguous it stops before reading agent data.
 * Creating officeAgents records for existing agents is a separate migration that needs explicit approval.
 */
const { initFirebase } = require('./activate-leadership');
const { reconcile, stagedAgentsFromImports, redactReport, readOnlyDb } = require('./lib/officeAgentReconcile');

function parseArgs(argv) {
  const out = { office: null, officeName: null, json: false, list: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--office') out.office = argv[++i];
    else if (argv[i] === '--office-name') out.officeName = argv[++i];
    else if (argv[i] === '--json') out.json = true;
    else if (argv[i] === '--list') out.list = true;
    else throw new Error(`Unknown argument: ${argv[i]} (this script is read-only and takes only --office, --office-name, --json and --list)`);
  }
  if (!out.office && !out.officeName) throw new Error('--office <officeId> or --office-name "<exact name>" is required');
  if (out.office && out.officeName) throw new Error('Use either --office or --office-name, not both');
  return out;
}

const norm = (n) => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Resolves the target office. Stops unless exactly one active office matches. Reads officeAdminInfo only. */
async function resolveOffice(db, args) {
  if (args.office) {
    const s = await db.collection('officeAdminInfo').doc(args.office).get();
    if (!s.exists) throw new Error(`No office with id ${args.office}`);
    return { id: args.office, name: s.data().name || '', status: s.data().status };
  }
  const snap = await db.collection('officeAdminInfo').where('status', '==', 'active').get();
  const matches = snap.docs.filter((d) => norm(d.data().name) === norm(args.officeName));
  if (matches.length !== 1) throw new Error(`Expected exactly one active office named "${args.officeName}" but found ${matches.length}. Stopping; pass --office <id> instead.`);
  return { id: matches[0].id, name: matches[0].data().name, status: 'active' };
}

async function run(rawDb, args) {
  const db = readOnlyDb(rawDb);
  const office = await resolveOffice(db, args);
  const rows = async (q) => (await q.get()).docs.map((d) => ({ id: d.id, uid: d.id, ...d.data() }));
  const users = await rows(db.collection('users').where('officeId', '==', office.id));
  const invites = await rows(db.collection('officeInvites').where('officeId', '==', office.id).where('status', '==', 'pending'));
  const profiles = await rows(db.collection('officeAgents').where('officeId', '==', office.id));
  const imports = await rows(db.collection('officeImports').where('officeId', '==', office.id));
  const staged = stagedAgentsFromImports(imports); // exactly the rows the production directory treats as staged
  const listingAgents = [];
  for (let i = 0; i < users.length; i += 10) {
    const ids = users.slice(i, i + 10).map((u) => u.uid);
    listingAgents.push(...(await rows(db.collection('agents').where('userId', 'in', ids))));
  }
  const report = redactReport(reconcile({ officeId: office.id, users, invites, staged, profiles, listingAgents }));
  return { office: { id: office.id, name: office.name }, report };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { initializeApp, applicationDefault, cert, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const { app } = initFirebase(process.env, { initializeApp, applicationDefault, cert, getApps });
  const { office, report } = await run(getFirestore(app), args);
  if (args.json) return console.log(JSON.stringify({ office, report }, null, 2));
  const by = (rows, key) => rows.reduce((m, r) => ((m[r[key] || 'unknown'] = (m[r[key] || 'unknown'] || 0) + 1), m), {});
  const seeds = report.missing.filter((r) => r.wouldSeed);
  console.log(`Office: ${office.name} (${office.id})  READ-ONLY dry run, nothing written, no notifications, masked output`);
  console.log(`People: ${report.counts.people} | exact ${report.counts.exact} | missing ${report.counts.missing} | ambiguous ${report.counts.ambiguous} | duplicates ${report.counts.duplicates}`);
  console.log(`Missing profiles by login status: ${JSON.stringify(by(report.missing, 'loginStatus'))} | by source: ${JSON.stringify(by(report.missing, 'source'))}`);
  console.log(`Real photo on the login record (placeholder image excluded): ${seeds.filter((r) => r.wouldSeed.photo).length} of ${seeds.length} (never overwritten by a migration)`);
  const listed = args.list ? ['exact', 'missing', 'ambiguous', 'duplicates'] : ['ambiguous', 'duplicates'];
  for (const k of listed) {
    console.log(`\n${k.toUpperCase()}: ${report[k].length}`);
    report[k].forEach((r) => console.log('  - ' + JSON.stringify(r)));
  }
  console.log('\nNOTES'); report.notes.forEach((n) => console.log('  - ' + JSON.stringify(n)));
}

module.exports = { parseArgs, resolveOffice, run };
if (require.main === module) main().catch((err) => { console.error(err.message); process.exit(1); });
