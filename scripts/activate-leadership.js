#!/usr/bin/env node
/**
 * Grants Leadership Hub access to existing accounts by adding their uids to
 * `officeAdminInfo/{officeId}.leadershipUids`. THIS IS A PRODUCTION WRITE — it has not been run.
 *
 *   node scripts/activate-leadership.js --office <officeId> --email a@x.com --email b@y.com            (dry run)
 *   node scripts/activate-leadership.js --office <officeId> --email a@x.com --email b@y.com --execute (writes)
 *   add --remove to take the same accounts OFF leadershipUids instead.
 *
 * Dry run is the default; only --execute writes. It touches exactly one field on one document. It never
 * creates or edits accounts, passwords, users documents, roles, officeAdminUids, billing or invitations.
 *
 * Every email is checked BEFORE anything is written, and the batch is all-or-nothing: if any account is
 * ineligible, nothing is written, even with --execute. An account is ELIGIBLE (to be added) only when it:
 *   - exists in Firebase Auth and is not disabled
 *   - has a matching `users/{uid}` document (the Hub reads the leader's profile from it)
 *   - has the agent role (/dashboard and /dashboard/leadership send buyer-only accounts elsewhere)
 *   - does not belong to a DIFFERENT office
 * (--remove only needs the account to exist, so access can always be taken away.)
 *
 * Needs Admin credentials (GOOGLE_APPLICATION_CREDENTIALS) for the production Firebase project.
 */

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

// Same rules as src/app/utils/roles.js.
const isAgent = (u) => !!(u?.agent || u?.isAgent || u?.roles?.includes?.('agent'));
const isBuyer = (u) => !!(u?.isBuyer || u?.roles?.includes?.('buyer'));
const describeRole = (u) => (isAgent(u) ? (isBuyer(u) ? 'agent + buyer' : 'agent') : isBuyer(u) ? 'buyer only' : 'no agent role');

/**
 * Looks at one email and says whether it may be added. Read-only. `deps` supplies
 * { getAuthUserByEmail(email), getUserDoc(uid) } so this can be tested without Firebase.
 */
async function evaluateAccount(email, { officeId, remove = false }, deps) {
  const row = { email, uid: null, role: '—', office: '—', eligible: false, reason: null };
  let rec;
  try {
    rec = await deps.getAuthUserByEmail(email); // never creates an account
  } catch (err) {
    row.reason = `no Firebase Auth account for this email (${err.message})`;
    return row;
  }
  row.uid = rec.uid;

  const user = await deps.getUserDoc(rec.uid); // null when there is no users document
  row.role = user ? describeRole(user) : 'no users document';
  row.office = !user ? '—' : !user.officeId ? 'none' : user.officeId === officeId ? 'this office (member)' : `DIFFERENT office (${user.officeId})`;

  if (remove) { row.eligible = true; return row; }
  if (rec.disabled) row.reason = 'the account is disabled';
  else if (!user) row.reason = 'there is no matching users document, so the Hub could not load their profile; they must sign in to Premarket once to create it';
  else if (user.officeId && user.officeId !== officeId) row.reason = `they belong to a different office (${user.officeId}); leadership is only for this office`;
  else if (!isAgent(user)) row.reason = isBuyer(user)
    ? 'this is a buyer-only account; /dashboard and /dashboard/leadership redirect buyer-only accounts to the buyer dashboard. Use an agent account'
    : 'the account has no agent role, which /dashboard/leadership requires';
  else row.eligible = true;
  return row;
}

const pad = (s, n) => String(s).padEnd(n);
function formatReport(rows) {
  const w = (k) => Math.max(k.length, ...rows.map((r) => String(r[k] ?? '').length));
  const cols = [['email', 'EMAIL'], ['uid', 'UID'], ['role', 'ROLE'], ['office', 'OFFICE']];
  const widths = cols.map(([k]) => w(k));
  const lines = [cols.map(([, h], i) => pad(h, widths[i])).join('  ') + '  ELIGIBLE'];
  for (const r of rows) {
    lines.push(cols.map(([k], i) => pad(r[k] ?? '—', widths[i])).join('  ') + `  ${r.eligible ? 'YES' : 'NO'}`);
    if (!r.eligible && r.reason) lines.push(`    -> ${r.reason}`);
  }
  return lines.join('\n');
}

/**
 * Plans (and with `execute`, applies) the change. All accounts are evaluated first; nothing is written
 * unless every one is eligible AND `execute` is true. `deps` also supplies
 * { getOffice(id), writeLeadership({ officeId, uids, remove }) }.
 */
async function activateLeadership({ officeId, emails, execute = false, remove = false }, deps) {
  const office = await deps.getOffice(officeId);
  if (!office) throw new Error(`No office ${officeId}`);
  if (office.status !== 'active') throw new Error(`Office ${officeId} is not active`);

  const rows = [];
  for (const email of emails) rows.push(await evaluateAccount(email, { officeId, remove }, deps));
  const ineligible = rows.filter((r) => !r.eligible);
  const uids = rows.map((r) => r.uid);
  const already = new Set(office.leadershipUids || []);
  const result = { office, rows, uids, written: false, ok: ineligible.length === 0 };

  if (ineligible.length) return result; // all-or-nothing: no partial writes, with or without --execute
  if (!execute) return result;
  await deps.writeLeadership({ officeId, uids, remove });
  result.written = true;
  result.noChange = remove ? uids.every((u) => !already.has(u)) : uids.every((u) => already.has(u));
  return result;
}

async function main() {
  const { office: officeId, emails, execute, remove } = parseArgs(process.argv.slice(2));
  if (!officeId || emails.length === 0) throw new Error('Usage: --office <officeId> --email <address> [--email ...] [--execute] [--remove]');

  const { initializeApp, applicationDefault, getApps } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  if (!getApps().length) initializeApp({ credential: applicationDefault() });
  const db = getFirestore();
  const infoRef = (id) => db.collection('officeAdminInfo').doc(id);

  const result = await activateLeadership({ officeId, emails, execute, remove }, {
    async getOffice(id) { const s = await infoRef(id).get(); return s.exists ? s.data() : null; },
    getAuthUserByEmail: (email) => getAuth().getUserByEmail(email),
    async getUserDoc(uid) { const s = await db.collection('users').doc(uid).get(); return s.exists ? s.data() : null; },
    async writeLeadership({ officeId: id, uids, remove: rm }) {
      await infoRef(id).update({
        leadershipUids: rm ? FieldValue.arrayRemove(...uids) : FieldValue.arrayUnion(...uids),
        updatedAt: FieldValue.serverTimestamp(),
      });
    },
  });

  console.log(`Office: ${result.office.name} (${officeId})`);
  console.log(`Current leadershipUids: ${JSON.stringify(result.office.leadershipUids || [])}\n`);
  console.log(formatReport(result.rows));

  if (!result.ok) {
    console.log(`\nNOT ELIGIBLE — nothing was written${execute ? ' (--execute ignored)' : ''}. Fix the accounts above and run again.`);
    process.exit(1);
  }
  const verb = remove ? 'REMOVE from' : 'ADD to';
  if (!result.written) {
    console.log(`\nDRY RUN — all ${result.rows.length} account(s) eligible. Would ${verb} leadershipUids: ${JSON.stringify(result.uids)}. Nothing was written. Re-run with --execute to apply.`);
    return;
  }
  console.log(`\nDone: ${remove ? 'removed' : 'added'} ${result.uids.length} uid(s)${result.noChange ? ' (no change — already in that state)' : ''}.`);
}

module.exports = { parseArgs, isAgent, evaluateAccount, formatReport, activateLeadership };

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
