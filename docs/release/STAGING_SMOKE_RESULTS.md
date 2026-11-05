# Staging smoke test results (2026-11-05)

Environment: staging Firebase project `premarket-ows-staging-dbf1` (no billing linked), app run locally against it with preview-mode guards,
Sentry disabled, fake data only. Isolation verified before seeding and before every run (`scripts/verify-staging-isolation.js`).
Result: **29 of 29 checks passed** (run `node scripts/staging-smoke.js <dir>`; screenshots are not committed).

**Real in this run:** browser UI, staging Authentication (email/password), staging Firestore with the rules and the 45 production-equivalent indexes
deployed, the app's real API routes, the agent-led wizard, activation-on-first-login.
**Substitutes (not verified for real):** Google Places (stubbed place data), Bunny (fake upload target, so photo *rendering from a real CDN* is unverified),
Resend (payloads recorded, never sent, so real delivery, spam placement and bounces are unverified).

| Area | Checks | Result |
|---|---|---|
| Office admin sign-in; sidebar (Office, Agents, Teams, Campaigns, Registrations, My Team; no Leadership Hub/Admin); directory (6 agents, invited status, missing photos); only the office admin can use office routes (5 other roles 403, anonymous 401, cross-office 404) | 1.1 to 1.4 | Pass |
| Teams: seeded team and unassigned list; create, rename, change team admin; move out of a 2-person team asks first then dissolves; 4 audit entries; team creator has no office-wide access and sees only their own team | 2.1 to 2.4 | Pass |
| Profiles: complete an invited agent's name, phone, professional email and photo; one `officeAgents` profile; Auth user, login email, activation and user count unchanged; photo shown and "missing photo" count drops; public profile shows edited data and no emails; other roles 403; non-image upload refused | 3.1 to 3.5 | Pass |
| Managed campaigns: office admin for an invited never-logged-in agent; owner = agent, creator/role/terms acceptor = the administrator, `vendorUploaded` false; team creator for their teammate (terms note names the creator); forged owners refused in UI and API and nothing created; plain agent has no selector and the existing wizard still works | 4.1 to 4.5 | Pass |
| Emails (captured): exactly one campaign-link email per managed campaign to the assigned agent's account email (not the professional email), no buyer or price data, no legacy-style email; resend once then rate limited, strangers refused; invited agent's first login shows the campaign as theirs and activates normally | 5.1 to 5.3 | Pass |
| Registrations: assigned agent emailed once with buyer contact details and no opinion amount; office admin sees date-only registrations with no opinion data; team creator, member, plain agent and leadership refused (flag off); My Team does not offer team registrations | 6.1 to 6.3 | Pass |
| Billing (staging only): one charge per campaign on the staging office at $200, keyed by property id, identical shape for managed and agent-led; retried request creates no second campaign or charge | 7.1, 7.2 | Pass |
| Telemetry and isolation: 0 requests to Sentry; 111 Firebase requests all to the staging project, 0 to the live project; no page errors | 8.1 to 8.3 | Pass |

## Defects found by this run and fixed
1. **Agent selector showed login names**, not the professional name Hannah had just set. Now uses the office-managed profile (tested).
2. **`firestore.indexes.json` had 4 of production's 45 composite indexes.** A fresh environment built from the repo failed the dashboard's "my campaigns"
   query ("requires an index"). The file now matches production exactly. **Never deploy indexes to production from an older copy of this file.**

## Production unchanged (read-only comparison with a baseline taken before staging work)
Rules release time, Cloud Function versions, composite index count (45) and document counts (users, properties, charges, teams, audit collections) are identical.

## Still unverified or open
* Real Bunny storage and CDN rendering; real Resend delivery; real Google Places (needs a staging Maps key and billing).
* Staging on Vercel (no Vercel access from this environment); the legacy Cloud Function duplicate email (staging has no Cloud Functions); the mobile app's use of `vendorUploaded`.
* The layout still loads Google Analytics with the production id (blocked in these tests): staging page views would count in production analytics until made configurable.
* Phase D (privacy), counsel review of terms wording.
