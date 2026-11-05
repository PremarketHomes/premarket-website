#!/usr/bin/env node
/**
 * READ-ONLY dry run: compares an office's existing users, pending invitations, staged imports and any
 * `officeAgents` profiles, and reports exact matches, missing profiles, ambiguous records and potential
 * duplicates. It has NO write mode — there is no --execute flag and no write call anywhere in this file.
 * Creating officeAgents records for existing agents is a separate migration that needs explicit approval.
 *
 *   node scripts/reconcile-office-agents.js --office <officeId>
 *   add --json for machine-readable output.
 *
 * Credentials and the project guard are shared with scripts/activate-leadership.js (premarket-homes only).
 * Not run as part of development: running it reads PRODUCTION data, so run it deliberately.
 */
const { initFirebase } = require('./activate-leadership');
const { reconcile } = require('./lib/officeAgentReconcile');

function parseArgs(argv) {
  const out = { office: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--office') out.office = argv[++i];
    else if (argv[i] === '--json') out.json = true;
    else throw new Error(`Unknown argument: ${argv[i]} (this script is read-only and takes only --office and --json)`);
  }
  if (!out.office) throw new Error('--office <officeId> is required');
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { initializeApp, applicationDefault, cert, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const { app } = initFirebase(process.env, { initializeApp, applicationDefault, cert, getApps });
  const db = getFirestore(app);
  const rows = async (q) => (await q.get()).docs.map((d) => ({ id: d.id, uid: d.id, ...d.data() }));

  const users = await rows(db.collection('users').where('officeId', '==', args.office));
  const invites = await rows(db.collection('officeInvites').where('officeId', '==', args.office).where('status', '==', 'pending'));
  const profiles = await rows(db.collection('officeAgents').where('officeId', '==', args.office));
  const imports = await rows(db.collection('officeImports').where('officeId', '==', args.office));
  const staged = imports.flatMap((b) => (b.rows || []).filter((r) => !r.commitOutcome || r.commitOutcome === 'failed').map((r) => ({ name: r.name, email: r.email })));
  const listingAgents = [];
  for (let i = 0; i < users.length; i += 10) {
    const ids = users.slice(i, i + 10).map((u) => u.uid);
    listingAgents.push(...(await rows(db.collection('agents').where('userId', 'in', ids))));
  }

  const report = reconcile({ officeId: args.office, users, invites, staged, profiles, listingAgents });
  if (args.json) return console.log(JSON.stringify(report, null, 2));
  console.log(`Office ${args.office}: ${report.counts.people} people (READ-ONLY dry run, nothing written)`);
  for (const k of ['exact', 'missing', 'ambiguous', 'duplicates']) {
    console.log(`\n${k.toUpperCase()}: ${report[k].length}`);
    report[k].forEach((r) => console.log('  - ' + JSON.stringify(r)));
  }
  console.log('\nNOTES'); report.notes.forEach((n) => console.log('  - ' + JSON.stringify(n)));
}

module.exports = { parseArgs };
if (require.main === module) main().catch((err) => { console.error(err.message); process.exit(1); });
