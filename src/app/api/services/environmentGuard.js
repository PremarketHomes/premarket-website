/**
 * Environment safety for preview and staging deployments. Pure functions of an env object, so they are unit-tested
 * and shared by the API auth gate, the email sender and the environment status route.
 *
 * Why this exists: the browser Firebase config is hardcoded to the LIVE project and a Vercel preview normally carries
 * live server credentials, so a preview is NOT isolated from production data. These guards make a preview safe by
 * default without anyone having to remember a setting:
 *
 *   1. A preview deployment that points at the live backend refuses writes on the office, team and managed-campaign
 *      routes (reads still work, so the screens can be reviewed against real data).
 *   2. A preview deployment sends email ONLY to addresses on EMAIL_ALLOWLIST (default: nobody).
 *   3. Team-creator access to identifiable buyer registrations is off unless TEAM_REGISTRATIONS_ENABLED=1.
 *
 * Production (VERCEL_ENV=production), local development and the test suite are unaffected by 1 and 2.
 * Direct browser writes to Firestore (the existing agent wizard, dashboard toggles) are NOT covered; only a separate
 * staging project or emulators isolate those.
 */

export const LIVE_PROJECT_ID = 'premarket-homes';

export function deploymentEnv(env = process.env) {
  return env.VERCEL_ENV || (env.NODE_ENV === 'production' ? 'production' : 'development');
}

/** The Firebase project the SERVER talks to (mirrors adminApp.js: service account, then FIREBASE_PROJECT_ID, then live). */
export function backendProjectId(env = process.env) {
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    try { return JSON.parse(env.FIREBASE_SERVICE_ACCOUNT).project_id || 'unknown'; } catch { return 'unknown'; }
  }
  if (env.FIREBASE_PROJECT_ID) return env.FIREBASE_PROJECT_ID;
  return LIVE_PROJECT_ID;
}

export const usingEmulators = (env = process.env) => !!(env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST);

/** True when the server would touch live data. An unreadable credential is treated as live (fail safe). */
export function pointsAtLiveBackend(env = process.env) {
  if (usingEmulators(env)) return false;
  const id = backendProjectId(env);
  return id === LIVE_PROJECT_ID || id === 'unknown';
}

export const previewWritesBlocked = (env = process.env) => deploymentEnv(env) === 'preview' && pointsAtLiveBackend(env);

// API paths made by this release's workspace. Reads are never blocked.
const PROTECTED_WRITE_PATHS = [
  /^\/api\/offices(\/|$)/,
  /^\/api\/teams(\/|$)/,
  /^\/api\/properties\/managed(\/|$)/,
  /^\/api\/properties\/[^/]+\/(managed|campaign-link)(\/|$)/,
];

export function isBlockedPreviewWrite({ method, pathname }, env = process.env) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(method || 'GET').toUpperCase())) return false;
  return previewWritesBlocked(env) && PROTECTED_WRITE_PATHS.some((re) => re.test(pathname || ''));
}

export const PREVIEW_READ_ONLY_MESSAGE =
  'This preview is connected to live data, so changes are switched off here. Use the staging environment to test changes.';

/* ───────────── outbound email ───────────── */

export const emailGuardActive = (env = process.env) => deploymentEnv(env) === 'preview';

export function parseEmailAllowlist(env = process.env) {
  return String(env.EMAIL_ALLOWLIST || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

const bareAddress = (a) => { const m = String(a || '').match(/<([^>]+)>/); return (m ? m[1] : String(a || '')).trim().toLowerCase(); };

/** Entries are full addresses ("qa@premarket.homes") or whole domains ("@premarket.homes"). */
export function filterRecipients(to, env = process.env) {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!emailGuardActive(env)) return { allowed: list, blocked: [] };
  const rules = parseEmailAllowlist(env);
  const ok = (addr) => { const a = bareAddress(addr); return rules.some((r) => (r.startsWith('@') ? a.endsWith(r) : a === r)); };
  return { allowed: list.filter(ok), blocked: list.filter((x) => !ok(x)) };
}

/* ───────────── buyer registrations ───────────── */

/** Team-creator access to identifiable buyer registrations: OFF unless explicitly enabled (privacy decision, Phase D). */
export const teamRegistrationsEnabled = (env = process.env) => env.TEAM_REGISTRATIONS_ENABLED === '1';

/** Safe, non-secret summary for the environment status route. */
export function describeEnvironment(env = process.env) {
  return {
    deploymentEnv: deploymentEnv(env),
    serverProjectId: backendProjectId(env),
    usingEmulators: usingEmulators(env),
    pointsAtLiveBackend: pointsAtLiveBackend(env),
    previewWritesBlocked: previewWritesBlocked(env),
    emailGuard: { active: emailGuardActive(env), allowlistEntries: emailGuardActive(env) ? parseEmailAllowlist(env).length : null },
    teamRegistrationsEnabled: teamRegistrationsEnabled(env),
    storageZone: env.BUNNY_STORAGE_ZONE || 'premarketvideos (default)',
  };
}
