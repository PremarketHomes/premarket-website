# Office Workspace: launch (read this one)

Branch `feat/office-workspace`, all checks green: 1,934 unit tests, 504 rules tests, build, 29/29 staging scenarios, and a clean merge with
`feature/platform-remediation` (tests, lint, build). Production was verified read-only and is unchanged.

## Genuine blockers (3, each needs you or someone outside engineering)
1. **Legal: who accepts the terms.** `docs/release/LEGAL_REVIEW_TERMS.md` is ready to send. Key fact for counsel: until Hannah has her own login, the HPH
   admin is `accounts@premarket.homes`, a Premarket-controlled account, so acceptances would be recorded against Premarket, not HPH. Counsel's answer decides
   whether Hannah's own login (or a wording change) is required before managed campaign creation is used. **Directory, profiles, photos and teams do not
   involve terms and can be used meanwhile.**
2. **One real photo and email test.** Needs three things only you can supply: a Resend API key, a Bunny storage zone + key (staging), and a mailbox you control.
   Put them in `~/.premarket-staging/real-services.env`, tell me the mailbox, and I run `scripts/real-services-smoke.js` (about 5 minutes, one photo, one email).
3. **Approvals to ship** (below).

## Not a blocker, and why
* **Buyer opinion/registration privacy (Phase D).** It cannot be fixed inside this release: a registration and an opinion share one stored document read by reports,
  the registration email, CRM and leadership metrics, so separating them is a data migration owned by the remediation branch (still "pending approval"). The
  Workspace adds **no new buyer-data exposure**: the office-wide Registrations overview and team-creator access are both **off at launch** (`OFFICE_REGISTRATIONS_ENABLED`,
  `TEAM_REGISTRATIONS_ENABLED`, unset in production), and office admins keep exactly the per-property reports they have today. The platform must not be described as
  guaranteeing anonymity until Phase D ships. To switch the overview on later: set the one variable in Vercel Production and redeploy.
* **Production permissions (read-only check).** HPH has exactly one office admin, `accounts@premarket.homes` (flagged admin, active, agent role, also a platform
  super-admin); leadership is a separate non-admin account. Nothing here changes any role.
* **Billing (read-only check).** Billing is active since 2026-10-21; invoicing is off (no invoice has ever been issued; 2 charges pending). A campaign made through
  the Workspace creates the same single `office:HPH` charge at the same $200 wholesale price as an agent-made one (shown to HPH agents as $349 retail); a retry
  never doubles it. **Hannah's first real campaign is a real charge** (existing behaviour).
* **Indexes.** The new queries need no new index; staging ran with production's exact 45.

## Smallest safe merge and deploy (nothing below has been done)
1. Approve. I open the PR `feat/office-workspace` to `main` (link: https://github.com/PremarketHomes/premarket-website/pull/new/feat/office-workspace).
2. Production environment changes needed: **none.** Every new switch defaults to the safe state when unset.
3. Merge; Vercel deploys to production automatically. No Cloud Function, rules, index or data change; no migration; profiles are created on first edit.
4. Within 10 minutes, read-only: sign in as `accounts@premarket.homes`, confirm Office, Agents, Teams, Campaigns appear (Registrations does not), the directory shows 94 agents
   with 86 needing photos, and `/api/internal/environment` shows `deploymentEnv: "production"`. Writes happen first when Hannah uploads her first photo.
5. Watch Vercel logs for `/api/offices/*` and `/api/properties/managed*` and Resend for the first campaign email.
6. Then merge `main` into `feature/platform-remediation` and re-run its tests (verified clean, in either order).

## Rollback
Vercel Instant Rollback to the previous production deployment (seconds; no data change needed). New data is additive and ignored by the old code. The only edit to an
existing record is the photo mirrored to an agent's `users.avatar` (the previous value is not kept); an uploaded photo is therefore the one change to be careful about.

## Everything else
Optional work (staging on Vercel, real Google Places key, GA/Sentry configuration, Phase D itself) is deliberately not on the path to launch.
