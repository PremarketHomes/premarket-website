#!/usr/bin/env node
/**
 * Positive isolation check for a staging deployment. Nothing is seeded or tested unless EVERY check passes.
 *
 *   node scripts/verify-staging-isolation.js --project <staging-id> --url <deployment url> [--service-account <file>] [--web-config <file>]
 *
 * Checks: (1) the server credential is for the staging project; (2) the browser Firebase config is for the staging project;
 * (3) the running deployment's /api/internal/environment reports the SAME staging project for server and client, is not
 * pointing at the live backend, and has the safeguards on. Read-only: it only GETs the status route and reads two local files.
 */
const fs = require('fs');
const LIVE = 'premarket-homes';

function parseArgs(argv) {
  const out = { project: null, url: null, serviceAccount: null, webConfig: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--project') out.project = argv[++i];
    else if (k === '--url') out.url = argv[++i];
    else if (k === '--service-account') out.serviceAccount = argv[++i];
    else if (k === '--web-config') out.webConfig = argv[++i];
    else throw new Error(`Unknown argument: ${k}`);
  }
  return out;
}

/** Pure: returns [{ name, ok, detail }] for the given facts. */
function evaluate({ project, serviceAccountProject, webConfigProject, environment }) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
  add('target is not the live project', project && project !== LIVE, project);
  if (serviceAccountProject !== undefined) add('server credential is for the staging project', serviceAccountProject === project, serviceAccountProject);
  if (webConfigProject !== undefined) add('browser Firebase config is for the staging project', webConfigProject === project, webConfigProject);
  if (environment) {
    add('deployment server project is the staging project', environment.serverProjectId === project, environment.serverProjectId);
    add('deployment browser project equals its server project', environment.clientMatchesServer === true && String(environment.clientProjectId).startsWith(project), environment.clientProjectId);
    add('deployment is not pointing at the live backend', environment.pointsAtLiveBackend === false, String(environment.pointsAtLiveBackend));
    add('team registrations are off', environment.teamRegistrationsEnabled === false, String(environment.teamRegistrationsEnabled));
    add('email guard is active (preview/staging)', environment.emailGuard?.active === true, JSON.stringify(environment.emailGuard));
    add('storage zone is not the live zone', !/^premarketvideos/.test(String(environment.storageZone)), environment.storageZone);
  }
  return checks;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const facts = { project: a.project };
  if (a.serviceAccount) facts.serviceAccountProject = JSON.parse(fs.readFileSync(a.serviceAccount, 'utf8')).project_id;
  if (a.webConfig) facts.webConfigProject = JSON.parse(fs.readFileSync(a.webConfig, 'utf8')).projectId;
  if (a.url) {
    const res = await fetch(`${a.url.replace(/\/$/, '')}/api/internal/environment`, { redirect: 'manual' });
    if (!res.ok) throw new Error(`Could not read the deployment's environment route (HTTP ${res.status}); is it behind login?`);
    facts.environment = await res.json();
  }
  const checks = evaluate(facts);
  checks.forEach((c) => console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  [${c.detail}]`));
  const ok = checks.every((c) => c.ok);
  console.log(ok ? '\nISOLATION CONFIRMED' : '\nISOLATION NOT CONFIRMED: do not seed or test.');
  process.exit(ok ? 0 : 1);
}

module.exports = { evaluate, parseArgs };
if (require.main === module) main().catch((e) => { console.error('STOPPED:', e.message); process.exit(1); });
