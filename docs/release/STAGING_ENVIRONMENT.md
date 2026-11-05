# Staging environment for the Office Workspace

## Status (2026-11-05): staging live and smoke-tested (29/29), third-party services still substituted

| Item | State |
|---|---|
| GCP/Firebase project | `premarket-ows-staging-dbf1` ("Premarket STAGING test only"). **No billing linked** (spend $0). Separate from `premarket-homes` |
| Firestore | australia-southeast1. Repo rules deployed to staging only (includes the 3 new server-only rules). **45 composite indexes**, identical to production, built |
| Authentication | **Active** (email/password; email link off), enabled in the console |
| Service account / web config | Staging-only; stored in `~/.premarket-staging/` (owner-only, outside the repo). No production credential used |
| Isolation | Verified by `scripts/verify-staging-isolation.js` before seeding and before every run; browser traffic: 111 Firebase requests, 0 to the live project |
| Seed | Fake office, 6 fake users, team, billing settings, 1 fake campaign + registration (`scripts/seed-staging.js`); reset with `scripts/reset-staging.js` (staging only) |
| Smoke test | **29 of 29 passed** (`scripts/staging-smoke.js`; results in `STAGING_SMOKE_RESULTS.md`) |
| Sentry | `NEXT_PUBLIC_SENTRY_DISABLED=1` in `staging.env`: 0 requests to Sentry during the run |
| App location | Run **locally** (`~/.premarket-staging/run-local.sh`, port 3200). **No staging URL on Vercel yet** (no Vercel access from this environment) |
| Google Places, Bunny, Resend | **Test substitutes only** (stubbed place data, fake upload target, recorded-not-sent email). Real versions unverified |
| Firebase Storage | Not available (needs billing). Not used by Office Workspace flows |

Open decisions are listed in the report that accompanied this status; the sections below describe the design and runbook.

**Prepared, not created.** No staging project, accounts, keys or Vercel settings have been created. Creating a Firebase/GCP
project links a billing account and issues a service-account key, so it needs explicit approval. Everything below is ready to
run on approval. Companion: `OFFICE_WORKSPACE_RELEASE.md`, `PREVIEW_DEPLOYMENT_PLAN.md`.

## Why staging, and what the preview already protects

A Vercel preview of this repo uses the LIVE Firebase project (browser config is built in; server credentials come from Vercel
env). Verified read-only on 2026-11-05:

* **Billing is live** (`billingActivatedAt` 2026-10-21; automatic invoicing off). A campaign created in production creates a real
  pending charge, so production test campaigns are not an option.
* **The legacy Cloud Function `onVendorPropertyCreated` is deployed and active** (last sent 2026-11-03).
* There is **no staging project** (only `premarket-homes` and an unused default project).

So the code now makes a live-backed preview safe by default (`src/app/api/services/environmentGuard.js`):

| Safeguard | Effect on a preview that points at live data |
|---|---|
| Write block | POST/PATCH/DELETE on `/api/offices/*`, `/api/teams/*`, `/api/properties/managed*`, `/api/properties/{id}/managed`, `/api/properties/{id}/campaign-link/*` return 403. Reads work, so screens can be reviewed against real data |
| Email allowlist | Email is sent only to `EMAIL_ALLOWLIST` (default: nobody). Applies to every sender, including the admin password-reset route |
| Team registrations | Off everywhere unless `TEAM_REGISTRATIONS_ENABLED=1` (office-admin access is unchanged) |

Production (`VERCEL_ENV=production`), local development and the test suite are unaffected by the first two. **Not covered:** direct
browser writes to Firestore by the existing agent wizard and dashboard toggles. Only a separate project or emulators isolate those,
which is why real write tests belong in staging, not on a live-backed preview.

Check what any deployment is really using: `GET /<deployment>/api/internal/environment` (non-secret). Expect, for a live-backed preview:
`deploymentEnv: "preview"`, `pointsAtLiveBackend: true`, `previewWritesBlocked: true`, `emailGuard.active: true`,
`teamRegistrationsEnabled: false`. For staging: `serverProjectId` = the staging project, `clientMatchesServer: true`,
`pointsAtLiveBackend: false`.

## Create staging (after approval)

1. **Project.** Firebase project `premarket-staging` (name your choice), Firestore in `australia-southeast1` (same as live), Authentication
   email/password enabled. Storage is optional (only the existing wizard's video/photo path uses it).
2. **Rules and indexes from this branch** (staging only): `firebase deploy --only firestore:rules,firestore:indexes --project premarket-staging`.
   This also tests the three new server-only rules before they are ever deployed to live.
3. **Service account** for staging (Firebase Admin). Store it only in Vercel (below). Never reuse the live key.
4. **Web app config:** register a web app in the staging project; note its 7 config values.
5. **Bunny:** create a separate storage zone and pull zone for staging, e.g. `premarket-staging`.
6. **Resend:** reuse the sending domain; no separate key is required because `EMAIL_ALLOWLIST` limits recipients in code. A separate
   key is still cleaner for revocation.
7. **Test mailbox:** one real inbox you control, e.g. `qa@premarket.homes`; all test accounts use plus-addresses of it.
8. **Seed fake data** (dry run first):
   ```
   FIREBASE_SERVICE_ACCOUNT="$(cat staging-sa.json)" node scripts/seed-staging.js --project premarket-staging --qa-email qa@premarket.homes
   ... --execute
   ```
   Creates one fake office, 6 fake users (office admin, team creator, member, invited-never-logged-in, plain agent, leader), a team, billing
   settings of its own, one fake campaign and one fake registration. It refuses the live project, mismatched credentials and live-pointing
   environment variables. No HPH data is read or copied. Passwords are printed once.

## Vercel configuration for staging

Use a long-lived branch (e.g. `staging`) so staging variables apply only to its deployments; every other preview keeps the live-backed,
guarded defaults. In Vercel: Project > Settings > Environment Variables > Preview, "Git branch: staging".

Server: `FIREBASE_SERVICE_ACCOUNT` (staging), `RESEND_API_KEY`, `EMAIL_ALLOWLIST` (e.g. `@premarket.homes` or the exact `qa+...` addresses),
`BUNNY_STORAGE_ACCESS_KEY` (staging zone), `BUNNY_STORAGE_ZONE`, `BUNNY_CDN_BASE` (e.g. `https://premarket-staging.b-cdn.net/`),
`CRON_SECRET`, `NEXT_PUBLIC_BASE_URL` (the staging URL). Leave unset: `TEAM_REGISTRATIONS_ENABLED`, all `XERO_*`, `NEWSLETTER_SEND_ENABLED`.

Build-time (browser): `NEXT_PUBLIC_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID`, `_APP_ID`,
`_MEASUREMENT_ID` (staging web app) and `NEXT_PUBLIC_EXTRA_IMAGE_HOST` (the staging CDN hostname).

Because staging is a Vercel "preview", the write block lifts automatically ONLY when the server credentials are not the live project; if
someone mis-sets the staging key to the live one the block stays on. Writes are not blocked, and the email allowlist still applies.

Known limits of staging: the Google Maps key is hardcoded and referrer-restricted (allow the staging domain, or test Places only after merge
on the production domain); video upload and the image-compress job still target the production CDN (not used by the Office Workspace flows).

## What to test in staging (all with fake agents, no HPH data)

Run `OFFICE_WORKSPACE_RELEASE.md` section 2 in order against staging: legacy duplicate-email check (now expected to be a single email), real Bunny
upload to the staging zone, real Resend delivery to the QA inbox, wizard for office admin and team creator, forged-request refusals, billing
attribution (staging has its own `settings/invoicing`, so charges are real documents in staging only), registration email. Then enable
`TEAM_REGISTRATIONS_ENABLED=1` on staging only if you want to test team-creator registrations.
